import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { runRegister } from './register.ts';
import { createCommandFixture, type CommandFixture } from '../../test/command-fixture.ts';
import { extractSignupRef } from './util/slug.ts';

let fx: CommandFixture;

beforeEach(async () => {
  fx = await createCommandFixture();
  fx.server.seedSignup({
    id: 'su_r',
    slug: 'rsvp',
    status: 'active',
    title: 'E',
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
  });
});
afterEach(async () => {
  await fx.cleanup();
});

describe('extractSignupRef', () => {
  test('returns raw slug or id unchanged', () => {
    expect(extractSignupRef('rsvp')).toBe('rsvp');
    expect(extractSignupRef('su_abc')).toBe('su_abc');
  });
  test('pulls the last path segment from a URL', () => {
    expect(extractSignupRef('https://thesignup.app/s/rsvp')).toBe('rsvp');
    expect(extractSignupRef('https://thesignup.app/s/rsvp/')).toBe('rsvp');
  });
  test('rejects empty input', () => {
    expect(() => extractSignupRef('  ')).toThrow();
  });
});

describe('runRegister', () => {
  test('POSTs to /register with provided slot/items', async () => {
    const code = await runRegister(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        target: 'rsvp',
        slot: 1,
        items: 'drinks',
        name: 'Gabe',
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
    const last = fx.server.recordedRequests().at(-1);
    expect(last?.method).toBe('POST');
    expect(last?.path).toBe('/v1/signups/rsvp/register');
    const body = last?.body as { name: string; slot: number; items: string };
    expect(body.slot).toBe(1);
    expect(body.items).toBe('drinks');
    expect(body.name).toBe('Gabe');
  });

  test('accepts a full URL target and extracts the slug', async () => {
    const code = await runRegister(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        target: 'https://example.com/s/rsvp',
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
    expect(fx.server.recordedRequests().at(-1)?.path).toBe('/v1/signups/rsvp/register');
  });
});
