import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { runRegister, __internals } from './register.ts';
import { createCommandFixture, type CommandFixture } from '../../test/command-fixture.ts';

const SIGNUP_UUID = '00000000-0000-4000-8000-000000000001';
const SLOT_UUID = '00000000-0000-4000-8000-0000000000a1';
const ITEM_UUID = '00000000-0000-4000-8000-0000000000b1';

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
  fx.server.seedSlot({
    id: SLOT_UUID,
    eventId: SIGNUP_UUID,
    startTime: '2026-05-10T18:00:00Z',
    endTime: '2026-05-10T19:00:00Z',
    maxParticipants: 10,
    title: 'Saturday evening',
    description: null,
    location: null,
  });
  fx.server.seedItem({
    id: ITEM_UUID,
    eventId: SIGNUP_UUID,
    name: 'Drinks',
    description: null,
    quantityNeeded: 5,
    maxContributors: 5,
  });
});

afterEach(async () => {
  await fx.cleanup();
});

describe('runRegister', () => {
  test('requires a UUID target', async () => {
    const code = await runRegister(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        target: 'pizza',
        name: 'G',
        email: 'g@e.com',
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(1);
    expect(fx.server.recordedRequests().some((r) => r.path.includes('/participants'))).toBe(false);
  });

  test('rejects missing --email', async () => {
    const code = await runRegister(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        target: SIGNUP_UUID,
        name: 'G',
        email: '',
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(1);
    expect(fx.server.recordedRequests().some((r) => r.path.includes('/participants'))).toBe(false);
  });

  test('POSTs to /participants with name + email and empty selections', async () => {
    const code = await runRegister(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        target: SIGNUP_UUID,
        name: 'Gabe',
        email: 'gabe@example.com',
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
    const last = fx.server.recordedRequests().at(-1);
    expect(last?.method).toBe('POST');
    expect(last?.path).toBe(`/v1/signups/${SIGNUP_UUID}/participants`);
    const body = last?.body as {
      name: string;
      email: string;
      selections: unknown[];
    };
    expect(body.name).toBe('Gabe');
    expect(body.email).toBe('gabe@example.com');
    expect(body.selections).toEqual([]);
  });

  test('resolves --slot by title (case-insensitive)', async () => {
    const code = await runRegister(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        target: SIGNUP_UUID,
        name: 'Gabe',
        email: 'gabe@example.com',
        slot: 'saturday evening',
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
    const post = fx.server.recordedRequests().find((r) => r.path.endsWith('/participants'));
    const body = post?.body as { selections: { type: string; id: string; quantity: number }[] };
    expect(body.selections).toEqual([{ type: 'slot', id: SLOT_UUID, quantity: 1 }]);
  });

  test('resolves --slot by #1 index', async () => {
    const code = await runRegister(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        target: SIGNUP_UUID,
        name: 'Gabe',
        email: 'gabe@example.com',
        slot: '#1',
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
    const post = fx.server.recordedRequests().find((r) => r.path.endsWith('/participants'));
    const body = post?.body as { selections: { id: string }[] };
    expect(body.selections[0]?.id).toBe(SLOT_UUID);
  });

  test('resolves --slot by UUID directly', async () => {
    const code = await runRegister(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        target: SIGNUP_UUID,
        name: 'Gabe',
        email: 'gabe@example.com',
        slot: SLOT_UUID,
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
  });

  test('rejects unknown --slot before hitting POST', async () => {
    const code = await runRegister(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        target: SIGNUP_UUID,
        name: 'Gabe',
        email: 'gabe@example.com',
        slot: 'nonexistent',
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(1);
    expect(
      fx.server
        .recordedRequests()
        .some((r) => r.method === 'POST' && r.path.endsWith('/participants')),
    ).toBe(false);
  });

  test('resolves repeated --item flags with quantities', async () => {
    const code = await runRegister(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        target: SIGNUP_UUID,
        name: 'Gabe',
        email: 'gabe@example.com',
        item: ['drinks:2'],
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
    const post = fx.server.recordedRequests().find((r) => r.path.endsWith('/participants'));
    const body = post?.body as { selections: { type: string; id: string; quantity: number }[] };
    expect(body.selections).toEqual([{ type: 'item', id: ITEM_UUID, quantity: 2 }]);
  });

  test('rejects --item without ":qty"', async () => {
    const code = await runRegister(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        target: SIGNUP_UUID,
        name: 'Gabe',
        email: 'gabe@example.com',
        item: ['drinks'],
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(1);
  });

  test('passes --phone and --note through to the body', async () => {
    const code = await runRegister(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        target: SIGNUP_UUID,
        name: 'Gabe',
        email: 'gabe@example.com',
        phone: '+15551234567',
        note: 'dietary: vegan',
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
    const post = fx.server.recordedRequests().find((r) => r.path.endsWith('/participants'));
    const body = post?.body as { phone: string; eventCustomFieldResponse: string };
    expect(body.phone).toBe('+15551234567');
    expect(body.eventCustomFieldResponse).toBe('dietary: vegan');
  });
});

describe('parseItemSpec', () => {
  test('parses name:qty', () => {
    expect(__internals.parseItemSpec('drinks:2')).toEqual({ ref: 'drinks', quantity: 2 });
  });
  test('parses UUID:qty by using the last colon', () => {
    const spec = `${ITEM_UUID}:3`;
    expect(__internals.parseItemSpec(spec)).toEqual({ ref: ITEM_UUID, quantity: 3 });
  });
  test('rejects missing colon', () => {
    expect(() => __internals.parseItemSpec('drinks')).toThrow();
  });
  test('rejects non-positive quantity', () => {
    expect(() => __internals.parseItemSpec('drinks:0')).toThrow();
    expect(() => __internals.parseItemSpec('drinks:-1')).toThrow();
    expect(() => __internals.parseItemSpec('drinks:abc')).toThrow();
  });
});
