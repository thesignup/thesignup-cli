import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { runAnalytics } from './analytics.ts';
import { createCommandFixture, type CommandFixture } from '../../test/command-fixture.ts';

let fx: CommandFixture;

beforeEach(async () => {
  fx = await createCommandFixture();
  fx.server.seedSignup({
    id: 'su_a',
    slug: 'analytics-event',
    status: 'active',
    title: 'E',
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
  });
});
afterEach(async () => {
  await fx.cleanup();
});

describe('runAnalytics', () => {
  test('GETs analytics and returns numbers', async () => {
    fx.server.setAnalytics('su_a', {
      signup_id: 'su_a',
      total_participants: 12,
      capacity: 20,
      fill_rate: 0.6,
      views: 153,
    });
    const code = await runAnalytics(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        signup: 'analytics-event',
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
    expect(fx.server.recordedRequests().at(-1)?.path).toBe('/v1/signups/analytics-event/analytics');
  });

  test('falls back to derived count when server has no analytics row', async () => {
    fx.server.seedParticipant({
      id: 'pa_1',
      signup_id: 'su_a',
      name: 'X',
      created_at: '2026-05-02T00:00:00Z',
    });
    const code = await runAnalytics(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        signup: 'analytics-event',
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
  });
});
