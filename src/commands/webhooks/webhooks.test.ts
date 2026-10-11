import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { runWebhooksList, runWebhooksCreate } from './index.ts';
import {
  captureOutput,
  createCommandFixture,
  type CommandFixture,
} from '../../../test/command-fixture.ts';
import { webhookFixture } from '../../../test/api-fixtures.ts';

let fx: CommandFixture;

beforeEach(async () => {
  fx = await createCommandFixture();
});
afterEach(async () => {
  await fx.cleanup();
});

describe('runWebhooksList', () => {
  test('renders event types and paused state from data', async () => {
    fx.server.seedWebhook(
      webhookFixture({
        id: 'whk_paused',
        url: 'https://example.com/hooks',
        eventTypes: ['signup.created'],
        paused: true,
      }),
    );
    const { code, stdout } = await captureOutput(() =>
      runWebhooksList(
        { profile: fx.profile, apiBase: fx.server.url },
        { storeFactory: fx.storeFactory },
      ),
    );
    expect(code).toBe(0);
    expect(stdout).toContain('paused');
    expect(stdout).toContain('signup.created');
  });
  test('empty list exits 0', async () => {
    const code = await runWebhooksList(
      { profile: fx.profile, apiBase: fx.server.url, json: true },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
  });

  test('returns seeded webhooks', async () => {
    fx.server.seedWebhook(
      webhookFixture({
        id: 'whk_1',
        url: 'https://example.com/hook',
        eventTypes: ['signup.created'],
        paused: false,
        createdAt: '2026-05-01T00:00:00Z',
      }),
    );
    const code = await runWebhooksList(
      { profile: fx.profile, apiBase: fx.server.url, json: true },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
    const last = fx.server.recordedRequests().at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/api/v1/webhooks');
  });
});

describe('runWebhooksCreate', () => {
  test('renders endpoint metadata and the one-time signing secret', async () => {
    const { code, stdout } = await captureOutput(() =>
      runWebhooksCreate(
        {
          profile: fx.profile,
          apiBase: fx.server.url,
          url: 'https://example.com/hooks',
          events: 'signup.created',
        },
        { storeFactory: fx.storeFactory },
      ),
    );
    expect(code).toBe(0);
    expect(stdout).toContain('whsec_example');
    expect(stdout).toContain('https://example.com/hooks');
  });
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
    expect(last?.path).toBe('/api/v1/webhooks');
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
