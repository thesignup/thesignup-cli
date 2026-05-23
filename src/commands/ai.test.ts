import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { runAiDraft } from './ai.ts';
import { createCommandFixture, type CommandFixture } from '../../test/command-fixture.ts';

let fx: CommandFixture;

beforeEach(async () => {
  fx = await createCommandFixture();
});
afterEach(async () => {
  await fx.cleanup();
});

describe('runAiDraft', () => {
  test('POSTs the description and returns the AI-drafted signup', async () => {
    fx.server.setAiDraft({
      title: 'Pizza night',
      status: 'draft',
      description: 'Casual pizza meetup',
    });
    const code = await runAiDraft(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        description: 'Pizza meetup for the team',
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
    const last = fx.server.recordedRequests().at(-1);
    expect(last?.method).toBe('POST');
    expect(last?.path).toBe('/v1/signups/from-description');
    expect((last?.body as { description: string }).description).toBe('Pizza meetup for the team');
  });

  test('empty description errors before hitting the API', async () => {
    const code = await runAiDraft(
      { profile: fx.profile, apiBase: fx.server.url, json: true, description: '' },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(1);
    expect(
      fx.server.recordedRequests().some((r) => r.path === '/v1/signups/from-description'),
    ).toBe(false);
  });
});
