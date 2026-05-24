import type { WebhookEvent } from '../../api/types.ts';
import { emit, emitError, makeOutput } from '../../util/output.ts';
import { buildClient, failWithError, type ClientDeps, type CommonOptions } from '../util/api.ts';
import { streamSse } from '../../http/sse-stream.ts';

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

    await streamSse({
      client,
      path: `/v1/webhooks/events${qs}`,
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
      maxRetries,
      onReconnect: (attempt, delay, err) => {
        if (ctx.format !== 'pretty') return;
        const msg = err instanceof Error ? err.message : String(err);
        ctx.stderr.write(
          `connection error (${msg}); reconnecting in ${delay}ms (attempt ${attempt}/${maxRetries})\n`,
        );
      },
      onEvent: async (sse) => {
        const parsed = safeParseEvent(sse.data);
        if (!parsed) return;
        deps.onEvent?.(parsed);
        await forwardEvent(fetchImpl, forwardUrl, parsed, ctx);
      },
    });
    return 0;
  } catch (err) {
    return failWithError(ctx, err);
  }
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
  // SSE-streamed envelopes don't carry a signature — signing is per-
  // endpoint at HTTP delivery time. Receivers that need to verify
  // signatures should register a real webhook endpoint (POST
  // /v1/webhooks) instead of consuming the live stream.
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'thesignup-event-id': event.id,
    'thesignup-event-type': event.type,
  };
  let status = 0;
  let errMsg: string | undefined;
  try {
    const res = await fetchImpl(forwardUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(event.data),
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

// Exposed for tests
export const __internals = {
  normalizeForwardUrl,
};
