import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { runAnalytics } from './analytics.ts';
import {
  captureOutput,
  createCommandFixture,
  type CommandFixture,
} from '../../test/command-fixture.ts';
import { analyticsFixture, participantFixture, signupFixture } from '../../test/api-fixtures.ts';

let fx: CommandFixture;

beforeEach(async () => {
  fx = await createCommandFixture();
  fx.server.seedSignup(
    signupFixture({
      id: 'su_a',
      slug: 'analytics-event',
      status: 'published',
      title: 'E',
      createdAt: '2026-05-01T00:00:00Z',
      updatedAt: '2026-05-01T00:00:00Z',
    }),
  );
});
afterEach(async () => {
  await fx.cleanup();
});

describe('runAnalytics', () => {
  test('renders participant count, capacity, ratio, and slot registrations', async () => {
    fx.server.setAnalytics(
      'su_a',
      analyticsFixture({
        eventId: 'su_a',
        participantCount: 12,
        fillRate: { capacity: 20, ratio: 0.6 },
        slots: [{ id: 'slot_1', title: 'Morning', capacity: 10, registered: 6, ratio: 0.6 }],
      }),
    );
    const { code, stdout } = await captureOutput(() =>
      runAnalytics(
        { profile: fx.profile, apiBase: fx.server.url, signup: 'analytics-event' },
        { storeFactory: fx.storeFactory },
      ),
    );
    expect(code).toBe(0);
    expect(stdout).toContain('participants: 12');
    expect(stdout).toContain('capacity:     20');
    expect(stdout).toContain('fill rate:    60.0%');
    expect(stdout).toContain('Morning: 6/10');
  });
  test('GETs analytics and returns numbers', async () => {
    fx.server.setAnalytics(
      'su_a',
      analyticsFixture({
        eventId: 'su_a',
        participantCount: 12,
        fillRate: { capacity: 20, ratio: 0.6 },
      }),
    );
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
    expect(fx.server.recordedRequests().at(-1)?.path).toBe(
      '/api/v1/signups/analytics-event/analytics',
    );
  });

  test('falls back to derived count when server has no analytics row', async () => {
    fx.server.seedParticipant(
      participantFixture({
        id: 'pa_1',
        eventId: 'su_a',
        name: 'X',
        createdAt: '2026-05-02T00:00:00Z',
      }),
    );
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
