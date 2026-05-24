import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { runSignupsList } from '../signups/index.ts';
import { runParticipantsList } from '../participants/index.ts';
import { createCommandFixture, type CommandFixture } from '../../../test/command-fixture.ts';
import type { WebhookEvent } from '../../api/types.ts';

const SIGNUP_UUID = '00000000-0000-4000-8000-000000000071';
const OTHER_SIGNUP_UUID = '00000000-0000-4000-8000-000000000072';

let fx: CommandFixture;

beforeEach(async () => {
  fx = await createCommandFixture();
  fx.server.seedSignup({
    id: SIGNUP_UUID,
    slug: 'pizza',
    status: 'active',
    title: 'Pizza',
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
  });
});

afterEach(async () => {
  await fx.cleanup();
});

function makeEnvelope(
  type: string,
  data: Record<string, unknown> = {},
  organizationId = 'org_1',
): WebhookEvent {
  return {
    id: `evt_${type}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    created: 1700000000,
    organizationId,
    data,
  };
}

describe('runSignupsList --watch', () => {
  test('aborts cleanly with exit code 0 when the signal fires', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 60);
    const code = await runSignupsList(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        watch: true,
        signal: controller.signal,
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
  });

  test('pretty mode re-fetches the signups list on each matching event', async () => {
    const controller = new AbortController();
    const publishTimer = setTimeout(
      () => fx.server.publishWebhookEvent(makeEnvelope('signup.created')),
      80,
    );
    const code = await runSignupsList(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        // Pretty mode triggers the clear-and-redraw branch per the
        // --watch spec. JSON mode is asserted separately below.
        watch: true,
        signal: controller.signal,
      },
      {
        storeFactory: fx.storeFactory,
        onWatchEvent: () => {
          // Give the re-render a turn before tearing down so the
          // second list request lands on the recorded set.
          setTimeout(() => controller.abort(), 25);
        },
      },
    );
    clearTimeout(publishTimer);
    expect(code).toBe(0);
    const listReqs = fx.server
      .recordedRequests()
      .filter(
        (r) =>
          r.method === 'GET' && (r.path === '/v1/signups' || r.path.startsWith('/v1/signups?')),
      );
    // Initial GET + re-fetch after the event.
    expect(listReqs.length).toBe(2);
  });

  test('JSON mode emits each envelope as NDJSON without re-fetching', async () => {
    const controller = new AbortController();
    let seen = 0;
    const publishTimer = setTimeout(
      () => fx.server.publishWebhookEvent(makeEnvelope('signup.updated')),
      80,
    );
    const code = await runSignupsList(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        watch: true,
        signal: controller.signal,
      },
      {
        storeFactory: fx.storeFactory,
        onWatchEvent: () => {
          seen += 1;
          controller.abort();
        },
      },
    );
    clearTimeout(publishTimer);
    expect(code).toBe(0);
    expect(seen).toBe(1);
    // JSON mode is a tail — only the initial render hits the list endpoint.
    const listReqs = fx.server
      .recordedRequests()
      .filter(
        (r) =>
          r.method === 'GET' && (r.path === '/v1/signups' || r.path.startsWith('/v1/signups?')),
      );
    expect(listReqs.length).toBe(1);
  });
});

describe('runParticipantsList --watch', () => {
  test('pretty mode only re-fetches for events on the watched signup', async () => {
    const controller = new AbortController();
    let matchedFires = 0;
    const wave1 = setTimeout(
      () =>
        fx.server.publishWebhookEvent(
          makeEnvelope('participant.registered', { eventId: OTHER_SIGNUP_UUID }),
        ),
      80,
    );
    const wave2 = setTimeout(
      () =>
        fx.server.publishWebhookEvent(
          makeEnvelope('participant.registered', { eventId: SIGNUP_UUID }),
        ),
      160,
    );
    const code = await runParticipantsList(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        // Pretty mode so the re-render hits the participants endpoint
        // (JSON mode would just stream the NDJSON envelope).
        signup: SIGNUP_UUID,
        watch: true,
        signal: controller.signal,
      },
      {
        storeFactory: fx.storeFactory,
        onWatchEvent: () => {
          matchedFires += 1;
          setTimeout(() => controller.abort(), 25);
        },
      },
    );
    clearTimeout(wave1);
    clearTimeout(wave2);
    expect(code).toBe(0);
    // The first wave (other signup) is dropped by shouldHandle so
    // onWatchEvent fires exactly once for the second wave.
    expect(matchedFires).toBe(1);
    const participantReqs = fx.server
      .recordedRequests()
      .filter((r) => r.method === 'GET' && r.path === `/v1/signups/${SIGNUP_UUID}/participants`);
    // Initial render + one re-fetch after the matching event.
    expect(participantReqs.length).toBe(2);
  });

  test('aborts cleanly when no events ever arrive', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 60);
    const code = await runParticipantsList(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        signup: SIGNUP_UUID,
        watch: true,
        signal: controller.signal,
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
  });
});
