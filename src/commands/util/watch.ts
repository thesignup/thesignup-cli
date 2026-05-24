import type { AuthenticatedClient } from '../../http/client.ts';
import { streamSse, type SseEvent } from '../../http/sse-stream.ts';
import { emit, emitError, type OutputContext } from '../../util/output.ts';

// Shared `--watch` helper for list commands (THE-127). Drives the
// initial render, opens the GET /v1/webhooks/events SSE stream
// filtered for the relevant event types, and re-renders on each
// matching event.
//
// Render conventions per the ticket:
// * pretty mode — clear the screen and redraw the table on each event
// * json mode  — emit one NDJSON object per event (no clearing)
//
// SIGINT exits with code 0. Disconnects bubble up to streamSse's
// exponential backoff; once that's exhausted we surface the error.

const CLEAR_SCREEN = '[2J[0;0H';

export interface WatchOptions {
  client: AuthenticatedClient;
  ctx: OutputContext;
  // Webhook event types whose arrival should trigger a re-render.
  // Non-matching events on the same stream are ignored.
  events: readonly string[];
  // Initial render, plus every re-render after a matching event.
  // Returns when the table has been written.
  render: () => Promise<void>;
  // Optional client-side gate. Lets callers narrow to events on a
  // specific resource (e.g. participants list scoped to one signup)
  // without needing a server-side filter for that dimension.
  shouldHandle?: (envelope: WatchEnvelope) => boolean;
  signal?: AbortSignal;
  // Test seams.
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  // Receives every envelope passed through shouldHandle — used by
  // tests to synchronize on a known event.
  onEvent?: (envelope: WatchEnvelope) => void;
}

// The envelope wire format from GET /v1/webhooks/events. Kept local so
// the watch helper isn't coupled to the wider api/types.ts shape — if
// the server adds new envelope fields, only this declaration changes.
export interface WatchEnvelope {
  id: string;
  type: string;
  created: number;
  organizationId: string;
  data: Record<string, unknown>;
}

export async function runWatch(opts: WatchOptions): Promise<number> {
  // Initial paint.
  await opts.render();

  if (opts.signal?.aborted) return 0;

  const qs = opts.events.length > 0 ? `?events=${encodeURIComponent(opts.events.join(','))}` : '';

  try {
    await streamSse({
      client: opts.client,
      path: `/v1/webhooks/events${qs}`,
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts.sleep ? { sleep: opts.sleep } : {}),
      onEvent: async (sse: SseEvent) => {
        const envelope = safeParseEnvelope(sse.data);
        if (!envelope) return;
        if (opts.shouldHandle && !opts.shouldHandle(envelope)) return;
        opts.onEvent?.(envelope);
        if (opts.ctx.format === 'json') {
          // NDJSON: one envelope per line, no clearing. Lets the
          // caller pipe through jq/etc. without table noise.
          opts.ctx.stdout.write(`${JSON.stringify(envelope)}\n`);
          return;
        }
        // Pretty: clear screen, redraw table from the latest server state.
        opts.ctx.stdout.write(CLEAR_SCREEN);
        try {
          await opts.render();
        } catch (err) {
          // A failed re-render shouldn't kill the watch loop — surface
          // and keep waiting for the next event. The user will see a
          // stale table but the stream continues.
          const msg = err instanceof Error ? err.message : String(err);
          emitError(opts.ctx, `re-render failed: ${msg}`);
        }
      },
    });
    return 0;
  } catch (err) {
    if (opts.signal?.aborted) return 0;
    emit(opts.ctx, { error: 'watch_failed', message: errorMessage(err) }, []);
    emitError(opts.ctx, `watch stream failed: ${errorMessage(err)}`);
    return 1;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function safeParseEnvelope(json: string): WatchEnvelope | null {
  try {
    const parsed = JSON.parse(json) as WatchEnvelope;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.id !== 'string' || typeof parsed.type !== 'string') return null;
    if (typeof parsed.organizationId !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}
