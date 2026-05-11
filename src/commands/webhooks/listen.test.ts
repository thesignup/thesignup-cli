import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { runWebhooksListen, __internals } from './listen.ts';
import { createCommandFixture, type CommandFixture } from '../../../test/command-fixture.ts';
import type { WebhookEvent } from '../../api/types.ts';

interface ForwarderHandle {
  url: string;
  received: Array<{ headers: Record<string, string>; body: unknown }>;
  stop: () => Promise<void>;
}

function startForwarder(responseStatus = 200): ForwarderHandle {
  const received: ForwarderHandle['received'] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const text = await req.text();
      const headers: Record<string, string> = {};
      for (const [k, v] of req.headers) headers[k] = v;
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        // keep as text
      }
      received.push({ headers, body });
      return new Response(null, { status: responseStatus });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/hook`,
    received,
    async stop() {
      await server.stop(true);
    },
  };
}

describe('listen internals', () => {
  test('parseSseEvent handles standard event blocks', () => {
    const ev = __internals.parseSseEvent('id: 1\nevent: ping\ndata: {"a":1}');
    expect(ev?.id).toBe('1');
    expect(ev?.event).toBe('ping');
    expect(ev?.data).toBe('{"a":1}');
  });

  test('parseSseEvent joins multi-line data', () => {
    const ev = __internals.parseSseEvent('data: line1\ndata: line2');
    expect(ev?.data).toBe('line1\nline2');
  });

  test('parseSseEvent returns null for blocks with no data', () => {
    expect(__internals.parseSseEvent(': heartbeat')).toBeNull();
    expect(__internals.parseSseEvent('id: 1')).toBeNull();
  });

  test('normalizeForwardUrl prefixes http and localhost as needed', () => {
    expect(__internals.normalizeForwardUrl('localhost:3000/webhooks')).toBe(
      'http://localhost:3000/webhooks',
    );
    expect(__internals.normalizeForwardUrl('/webhooks')).toBe('http://localhost/webhooks');
    expect(__internals.normalizeForwardUrl('https://example.com/hook')).toBe(
      'https://example.com/hook',
    );
  });
});

describe('runWebhooksListen (integration)', () => {
  let fx: CommandFixture;
  let forwarder: ForwarderHandle;

  beforeEach(async () => {
    fx = await createCommandFixture();
    forwarder = startForwarder(200);
  });

  afterEach(async () => {
    await forwarder.stop();
    await fx.cleanup();
  });

  test('forwards a streamed event to --forward-to with signature headers', async () => {
    const controller = new AbortController();
    const event: WebhookEvent = {
      id: 'evt_1',
      type: 'signup.created',
      payload: { id: 'su_1', title: 'Picnic' },
      signature: 't=1700000000,v1=abc123',
      delivered_at: '2026-05-11T00:00:00Z',
    };

    // Publish the event after a beat so the stream is open before the broadcast.
    const publishTimer = setTimeout(() => fx.server.publishWebhookEvent(event), 100);

    const seen: WebhookEvent[] = [];
    const runPromise = runWebhooksListen(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        forwardTo: forwarder.url,
        signal: controller.signal,
      },
      {
        storeFactory: fx.storeFactory,
        onEvent: (e) => {
          seen.push(e);
          if (seen.length === 1) controller.abort();
        },
      },
    );

    const code = await runPromise;
    clearTimeout(publishTimer);
    expect(code).toBe(0);
    expect(seen.length).toBe(1);
    expect(forwarder.received.length).toBe(1);
    const got = forwarder.received[0];
    expect(got).toBeDefined();
    expect(got?.headers['thesignup-event-id']).toBe('evt_1');
    expect(got?.headers['thesignup-event-type']).toBe('signup.created');
    expect(got?.headers['thesignup-signature']).toBe('t=1700000000,v1=abc123');
    expect((got?.body as { id: string }).id).toBe('su_1');
  });

  test('uses event.signature_header_name when provided', async () => {
    const controller = new AbortController();
    const event: WebhookEvent = {
      id: 'evt_2',
      type: 'signup.updated',
      payload: { id: 'su_2' },
      signature: 'sig-xyz',
      signature_header_name: 'x-custom-signature',
      delivered_at: '2026-05-11T00:00:01Z',
    };
    const publishTimer = setTimeout(() => fx.server.publishWebhookEvent(event), 100);

    const code = await runWebhooksListen(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        forwardTo: forwarder.url,
        signal: controller.signal,
      },
      {
        storeFactory: fx.storeFactory,
        onEvent: () => controller.abort(),
      },
    );
    clearTimeout(publishTimer);
    expect(code).toBe(0);
    expect(forwarder.received[0]?.headers['x-custom-signature']).toBe('sig-xyz');
    expect(forwarder.received[0]?.headers['thesignup-signature']).toBeUndefined();
  });

  test('signal-abort exits cleanly without forwarding anything', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const code = await runWebhooksListen(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        forwardTo: forwarder.url,
        signal: controller.signal,
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
    expect(forwarder.received.length).toBe(0);
  });

  test('reconnects after server closes the stream', async () => {
    const controller = new AbortController();
    let attempts = 0;
    const sleep = async (): Promise<void> => {
      // no-op so reconnect is immediate
    };

    const seen: WebhookEvent[] = [];
    const onEvent = (e: WebhookEvent): void => {
      seen.push(e);
      if (seen.length === 2) controller.abort();
    };

    // First wave: publish then close the streams (forcing reconnect).
    const wave1 = setTimeout(() => {
      fx.server.publishWebhookEvent({
        id: 'evt_a',
        type: 'signup.created',
        payload: {},
        signature: 's1',
        delivered_at: '2026-05-11T00:00:00Z',
      });
      setTimeout(() => fx.server.closeEventStreams(), 30);
    }, 50);
    // Second wave: publish a second event after the reconnect should have happened.
    const wave2 = setTimeout(() => {
      fx.server.publishWebhookEvent({
        id: 'evt_b',
        type: 'signup.updated',
        payload: {},
        signature: 's2',
        delivered_at: '2026-05-11T00:00:01Z',
      });
    }, 250);

    const code = await runWebhooksListen(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        forwardTo: forwarder.url,
        signal: controller.signal,
        maxRetries: 3,
      },
      { storeFactory: fx.storeFactory, sleep, onEvent },
    );
    clearTimeout(wave1);
    clearTimeout(wave2);
    void attempts;
    expect(code).toBe(0);
    expect(seen.length).toBe(2);
    expect(forwarder.received.length).toBe(2);
  });

  test('rejects missing --forward-to', async () => {
    const code = await runWebhooksListen(
      { profile: fx.profile, apiBase: fx.server.url, json: true, forwardTo: '' },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(1);
  });
});
