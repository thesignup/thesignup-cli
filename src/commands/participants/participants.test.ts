import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { runParticipantsList, runParticipantsAdd, runParticipantsRemove } from './index.ts';
import { createCommandFixture, type CommandFixture } from '../../../test/command-fixture.ts';

const SIGNUP_UUID = '00000000-0000-4000-8000-00000000000a';
const SLOT_UUID = '00000000-0000-4000-8000-00000000a001';

let fx: CommandFixture;

beforeEach(async () => {
  fx = await createCommandFixture();
  fx.server.seedSignup({
    id: SIGNUP_UUID,
    slug: 'event',
    status: 'active',
    title: 'E',
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
  });
  fx.server.seedSlot({
    id: SLOT_UUID,
    eventId: SIGNUP_UUID,
    startTime: '2026-05-10T18:00:00Z',
    endTime: '2026-05-10T19:00:00Z',
    maxParticipants: 5,
    title: 'Saturday',
    description: null,
    location: null,
  });
});

afterEach(async () => {
  await fx.cleanup();
});

describe('participants list', () => {
  test('lists seeded participants', async () => {
    fx.server.seedParticipant({
      id: 'pa_1',
      signup_id: SIGNUP_UUID,
      name: 'Ada',
      created_at: '2026-05-02T00:00:00Z',
    });
    const code = await runParticipantsList(
      { profile: fx.profile, apiBase: fx.server.url, json: true, signup: SIGNUP_UUID },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
    const last = fx.server.recordedRequests().at(-1);
    expect(last?.path).toBe(`/v1/signups/${SIGNUP_UUID}/participants`);
    expect(last?.method).toBe('GET');
  });

  test('empty list still exits 0', async () => {
    const code = await runParticipantsList(
      { profile: fx.profile, apiBase: fx.server.url, json: true, signup: SIGNUP_UUID },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
  });
});

describe('participants add', () => {
  test('delegates to register and POSTs the resolved selections', async () => {
    const code = await runParticipantsAdd(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        signup: SIGNUP_UUID,
        name: 'Bob',
        email: 'bob@example.com',
        slot: 'Saturday',
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
    const post = fx.server.recordedRequests().find((r) => r.path.endsWith('/participants'));
    expect(post?.method).toBe('POST');
    const body = post?.body as {
      name: string;
      email: string;
      selections: { type: string; id: string; quantity: number }[];
    };
    expect(body.name).toBe('Bob');
    expect(body.email).toBe('bob@example.com');
    expect(body.selections).toEqual([{ type: 'slot', id: SLOT_UUID, quantity: 1 }]);
    expect(fx.server.listParticipants(SIGNUP_UUID).length).toBe(1);
  });

  test('errors if --name is missing', async () => {
    const code = await runParticipantsAdd(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        signup: SIGNUP_UUID,
        name: '',
        email: 'bob@example.com',
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
      signup_id: SIGNUP_UUID,
      name: 'Ada',
      created_at: '2026-05-02T00:00:00Z',
    });
    const code = await runParticipantsRemove(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        signup: SIGNUP_UUID,
        participantId: 'pa_42',
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
    expect(fx.server.listParticipants(SIGNUP_UUID).length).toBe(0);
    const last = fx.server.recordedRequests().at(-1);
    expect(last?.method).toBe('DELETE');
    expect(last?.path).toBe(`/v1/signups/${SIGNUP_UUID}/participants/pa_42`);
  });

  test('404 → exit 1', async () => {
    const code = await runParticipantsRemove(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        signup: SIGNUP_UUID,
        participantId: 'pa_missing',
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(1);
  });
});
