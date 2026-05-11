import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { runParticipantsList, runParticipantsAdd, runParticipantsRemove } from './index.ts';
import { createCommandFixture, type CommandFixture } from '../../../test/command-fixture.ts';

let fx: CommandFixture;

beforeEach(async () => {
  fx = await createCommandFixture();
  fx.server.seedSignup({
    id: 'su_p',
    slug: 'event',
    status: 'active',
    title: 'E',
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
  });
});

afterEach(async () => {
  await fx.cleanup();
});

describe('participants list', () => {
  test('lists seeded participants', async () => {
    fx.server.seedParticipant({
      id: 'pa_1',
      signup_id: 'su_p',
      name: 'Ada',
      created_at: '2026-05-02T00:00:00Z',
    });
    const code = await runParticipantsList(
      { profile: fx.profile, apiBase: fx.server.url, json: true, signup: 'event' },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
    const last = fx.server.recordedRequests().at(-1);
    expect(last?.path).toBe('/v1/signups/event/participants');
    expect(last?.method).toBe('GET');
  });

  test('empty list still exits 0', async () => {
    const code = await runParticipantsList(
      { profile: fx.profile, apiBase: fx.server.url, json: true, signup: 'event' },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
  });
});

describe('participants add', () => {
  test('POSTs name + slot + items', async () => {
    const code = await runParticipantsAdd(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        signup: 'event',
        name: 'Bob',
        slot: 1,
        items: 'salad',
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
    const last = fx.server.recordedRequests().at(-1);
    expect(last?.method).toBe('POST');
    expect(last?.path).toBe('/v1/signups/event/participants');
    const body = last?.body as { name: string; slot: number; items: string };
    expect(body.name).toBe('Bob');
    expect(body.slot).toBe(1);
    expect(body.items).toBe('salad');
    expect(fx.server.listParticipants('su_p').length).toBe(1);
  });

  test('errors if --name is missing', async () => {
    const code = await runParticipantsAdd(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        signup: 'event',
        name: '',
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(1);
  });
});

describe('participants remove', () => {
  test('DELETEs the participant', async () => {
    fx.server.seedParticipant({
      id: 'pa_42',
      signup_id: 'su_p',
      name: 'Ada',
      created_at: '2026-05-02T00:00:00Z',
    });
    const code = await runParticipantsRemove(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        signup: 'event',
        participantId: 'pa_42',
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
    expect(fx.server.listParticipants('su_p').length).toBe(0);
    const last = fx.server.recordedRequests().at(-1);
    expect(last?.method).toBe('DELETE');
    expect(last?.path).toBe('/v1/signups/event/participants/pa_42');
  });

  test('404 → exit 1', async () => {
    const code = await runParticipantsRemove(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        signup: 'event',
        participantId: 'pa_missing',
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(1);
  });
});
