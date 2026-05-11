import type { WebhookEvent } from '../../api/types.ts';
import { emit, emitError, makeOutput } from '../../util/output.ts';
import { buildClient, failWithError, type ClientDeps, type CommonOptions } from '../util/api.ts';
import type { AuthenticatedClient } from '../../http/client.ts';

const DEFAULT_SIGNATURE_HEADER = 'thesignup-signature';
const MAX_RETRY_BACKOFF_MS = 30_000;

export interface WebhooksListenOptions extends CommonOptions {
  forwardTo: string;
  events?: string;
  maxRetries?: number;
  // Test hooks
  signal?: AbortSignal;
}

export interface WebhooksListenDeps extends ClientDeps {
  fetchImpl?: typeof fetch;
  // For tests — return the next retry delay synchronously instead of awaiting setTimeout
  sleep?: (ms: number) => Promise<void>;
  // Receives every event the loop processes — used by tests for synchronization
  onEvent?: (event: WebhookEvent) => void;
}

export async function runWebhooksListen(
  opts: WebhooksListenOptions,
  deps: WebhooksListenDeps = {},
): Promise<number> {
  const ctx = makeOutput({ json: opts.json });
  try {
    if (!opts.forwardTo) throw new Error('--forward-to is required');
    const forwardUrl = normalizeForwardUrl(opts.forwardTo);
    const { client } = buildClient(opts, deps);
    const fetchImpl = deps.fetchImpl ?? fetch;
    const sleep = deps.sleep ?? defaultSleep;
    const maxRetries = opts.maxRetries ?? 5;

    const events = (opts.events ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const qs = events.length > 0 ? `?events=${encodeURIComponent(events.join(','))}` : '';

    if (ctx.format === 'pretty') {
      ctx.stdout.write(
        `Listening for webhook events. Forwarding to ${forwardUrl} — Ctrl-C to stop.\n`,
      );
    }

    let attempt = 0;
    while (true) {
      if (opts.signal?.aborted) return 0;
      try {
        await streamEvents({
          client,
          path: `/v1/webhooks/events${qs}`,
          fetchImpl,
          forwardUrl,
          ctx,
          signal: opts.signal,
          onEvent: deps.onEvent,
        });
        // Server closed cleanly — exit if we've been asked to stop, else reconnect
        if (opts.signal?.aborted) return 0;
        attempt = 0;
      } catch (err) {
        if (opts.signal?.aborted) return 0;
        attempt++;
        if (attempt > maxRetries) throw err;
        const delay = Math.min(MAX_RETRY_BACKOFF_MS, 500 * 2 ** (attempt - 1));
        const msg = err instanceof Error ? err.message : String(err);
        if (ctx.format === 'pretty') {
          ctx.stderr.write(
            `connection error (${msg}); reconnecting in ${delay}ms (attempt ${attempt}/${maxRetries})\n`,
          );
        }
        await sleep(delay);
      }
    }
  } catch (err) {
    return failWithError(ctx, err);
  }
}

interface StreamEventsArgs {
  client: AuthenticatedClient;
  path: string;
  fetchImpl: typeof fetch;
  forwardUrl: string;
  ctx: ReturnType<typeof makeOutput>;
  signal?: AbortSignal | undefined;
  onEvent?: ((event: WebhookEvent) => void) | undefined;
}

async function streamEvents(args: StreamEventsArgs): Promise<void> {
  const headers = new Headers({ accept: 'text/event-stream' });
  const init: RequestInit = { headers };
  if (args.signal) init.signal = args.signal;
  const res = await args.client.fetch(args.path, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`event stream returned HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.body) throw new Error('event stream response had no body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = parseSseEvent(block);
        if (!event) continue;
        const parsed = safeParseEvent(event.data);
        if (!parsed) continue;
        args.onEvent?.(parsed);
        await forwardEvent(args.fetchImpl, args.forwardUrl, parsed, args.ctx);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

interface SseEvent {
  id?: string;
  event?: string;
  data: string;
}

function parseSseEvent(block: string): SseEvent | null {
  const lines = block.split('\n');
  const dataParts: string[] = [];
  let id: string | undefined;
  let event: string | undefined;
  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    const idx = line.indexOf(':');
    const field = idx === -1 ? line : line.slice(0, idx);
    const value = idx === -1 ? '' : line.slice(idx + 1).replace(/^\s/, '');
    if (field === 'data') dataParts.push(value);
    else if (field === 'id') id = value;
    else if (field === 'event') event = value;
  }
  if (dataParts.length === 0) return null;
  const out: SseEvent = { data: dataParts.join('\n') };
  if (id !== undefined) out.id = id;
  if (event !== undefined) out.event = event;
  return out;
}

function safeParseEvent(json: string): WebhookEvent | null {
  try {
    return JSON.parse(json) as WebhookEvent;
  } catch {
    return null;
  }
}

async function forwardEvent(
  fetchImpl: typeof fetch,
  forwardUrl: string,
  event: WebhookEvent,
  ctx: ReturnType<typeof makeOutput>,
): Promise<void> {
  const sigHeader = event.signature_header_name ?? DEFAULT_SIGNATURE_HEADER;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'thesignup-event-id': event.id,
    'thesignup-event-type': event.type,
    [sigHeader]: event.signature,
  };
  let status = 0;
  let errMsg: string | undefined;
  try {
    const res = await fetchImpl(forwardUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(event.payload),
    });
    status = res.status;
  } catch (err) {
    errMsg = err instanceof Error ? err.message : String(err);
  }
  if (ctx.format === 'json') {
    emit(
      ctx,
      {
        ok: !errMsg && status >= 200 && status < 300,
        event,
        forwarded_to: forwardUrl,
        ...(status ? { response_status: status } : {}),
        ...(errMsg ? { error: errMsg } : {}),
      },
      [],
    );
  } else {
    if (errMsg) {
      emitError(ctx, `forward to ${forwardUrl} failed: ${errMsg}`);
    } else {
      const ok = status >= 200 && status < 300;
      ctx.stdout.write(
        `${new Date().toISOString()}  ${event.type}  ${event.id}  → ${forwardUrl}  ${status}${ok ? '' : '  ✗'}\n`,
      );
    }
  }
}

function normalizeForwardUrl(target: string): string {
  if (target.startsWith('http://') || target.startsWith('https://')) return target;
  if (target.startsWith('/')) return `http://localhost${target}`;
  return `http://${target}`;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Exposed for tests
export const __internals = {
  parseSseEvent,
  normalizeForwardUrl,
};
