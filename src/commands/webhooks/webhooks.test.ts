import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { runWebhooksList, runWebhooksCreate } from './index.ts';
import { createCommandFixture, type CommandFixture } from '../../../test/command-fixture.ts';

let fx: CommandFixture;

beforeEach(async () => {
  fx = await createCommandFixture();
});
afterEach(async () => {
  await fx.cleanup();
});

describe('runWebhooksList', () => {
  test('empty list exits 0', async () => {
    const code = await runWebhooksList(
      { profile: fx.profile, apiBase: fx.server.url, json: true },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
  });

  test('returns seeded webhooks', async () => {
    fx.server.seedWebhook({
      id: 'whk_1',
      url: 'https://example.com/hook',
      events: ['signup.*'],
      status: 'active',
      created_at: '2026-05-01T00:00:00Z',
    });
    const code = await runWebhooksList(
      { profile: fx.profile, apiBase: fx.server.url, json: true },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
    const last = fx.server.recordedRequests().at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v1/webhooks');
  });
});

describe('runWebhooksCreate', () => {
  test('parses comma-separated --events and POSTs', async () => {
    const code = await runWebhooksCreate(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        url: 'https://example.com/hook',
        events: 'signup.*, participant.created',
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
    const last = fx.server.recordedRequests().at(-1);
    expect(last?.method).toBe('POST');
    expect(last?.path).toBe('/v1/webhooks');
    const body = last?.body as { url: string; events: string[] };
    expect(body.url).toBe('https://example.com/hook');
    expect(body.events).toEqual(['signup.*', 'participant.created']);
    expect(fx.server.listWebhooks().length).toBe(1);
  });

  test('rejects empty --events', async () => {
    const code = await runWebhooksCreate(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        url: 'https://example.com/hook',
        events: '',
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(1);
    expect(fx.server.listWebhooks().length).toBe(0);
  });

  test('rejects missing --url', async () => {
    const code = await runWebhooksCreate(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        url: '',
        events: 'signup.created',
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(1);
  });
});
