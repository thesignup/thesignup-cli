import type { AuthenticatedClient } from './client.ts';

// Shared SSE consumer (THE-127). Wraps the auth-aware client.fetch with
// EventSource semantics: opens a long-lived `text/event-stream`
// connection, parses the wire format into discrete frames, and invokes
// `onEvent` for each. Reconnects with exponential backoff on transient
// errors; surrenders after `maxRetries`.
//
// Built around the same primitives `webhooks listen` already uses;
// `--watch` on list commands re-uses this so the parsing + reconnect
// logic lives in one place.

export interface SseEvent {
  id?: string;
  event?: string;
  data: string;
}

export interface StreamSseOptions {
  client: AuthenticatedClient;
  path: string;
  onEvent: (event: SseEvent) => void | Promise<void>;
  // Test seam — defaults to the global fetch reachable through the
  // authenticated client. Lets tests inject Bun.serve fixtures.
  fetchImpl?: typeof fetch;
  // Aborting this signal closes the stream cleanly and stops retry.
  signal?: AbortSignal;
  // Retry tuning. Defaults: 5 attempts, 500ms initial backoff, capped
  // at 30s. Each attempt doubles the delay.
  maxRetries?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  // Test seam for the backoff sleep.
  sleep?: (ms: number) => Promise<void>;
  // Optional callback fired before each reconnect attempt. Used by
  // `webhooks listen` to print a reconnect line in pretty mode.
  onReconnect?: (attempt: number, delayMs: number, err: unknown) => void;
}

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_INITIAL_BACKOFF_MS = 500;
const DEFAULT_MAX_BACKOFF_MS = 30_000;

// Long-running. Returns when the caller's signal aborts (resolved
// normally) or when the retry budget is exhausted (rejected with the
// last error). The server closing the stream cleanly counts as an
// error path so the caller can decide whether to reconnect — that
// behavior is identical to EventSource's auto-reconnect.
export async function streamSse(opts: StreamSseOptions): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const initialBackoffMs = opts.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
  const maxBackoffMs = opts.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;

  let attempt = 0;
  while (true) {
    if (opts.signal?.aborted) return;
    try {
      await openAndStream({
        client: opts.client,
        path: opts.path,
        fetchImpl,
        onEvent: opts.onEvent,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      // Server closed cleanly. Either we were asked to stop (exit) or
      // we treat this as a transient disconnect and reconnect.
      if (opts.signal?.aborted) return;
      attempt = 0;
    } catch (err) {
      if (opts.signal?.aborted) return;
      attempt += 1;
      if (attempt > maxRetries) throw err;
      const delay = Math.min(maxBackoffMs, initialBackoffMs * 2 ** (attempt - 1));
      opts.onReconnect?.(attempt, delay, err);
      await sleep(delay);
    }
  }
}

interface OpenAndStreamArgs {
  client: AuthenticatedClient;
  path: string;
  fetchImpl: typeof fetch;
  onEvent: (event: SseEvent) => void | Promise<void>;
  signal?: AbortSignal;
}

async function openAndStream(args: OpenAndStreamArgs): Promise<void> {
  const headers = new Headers({ accept: 'text/event-stream' });
  const init: RequestInit = { headers };
  if (args.signal) init.signal = args.signal;
  void args.fetchImpl;
  const res = await args.client.fetch(args.path, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`SSE ${args.path}: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  if (!res.body) throw new Error(`SSE ${args.path}: response had no body`);
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
        if (event) await args.onEvent(event);
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

// SSE wire format per html.spec.whatwg.org/multipage/server-sent-events
// — strip leading colon (comment), split each line on first colon,
// trim one leading space off the value. Server heartbeats are
// `: heartbeat` comments — skipped (no data field, returns null).
export function parseSseEvent(block: string): SseEvent | null {
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

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
