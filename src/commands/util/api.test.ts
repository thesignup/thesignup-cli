import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { runAnalytics } from '../analytics.ts';
import { createCommandFixture, type CommandFixture } from '../../../test/command-fixture.ts';

let fx: CommandFixture;
beforeEach(async () => {
  fx = await createCommandFixture();
});
afterEach(async () => {
  await fx.cleanup();
});

describe('insufficient API scope', () => {
  for (const json of [false, true]) {
    test(`${json ? 'JSON' : 'pretty'} output requests a new login instead of reporting forbidden`, async () => {
      fx.server.denyScope('GET', '/v1/signups/example/analytics', 'analytics:read');
      const stderr = spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        const code = await runAnalytics(
          { profile: fx.profile, apiBase: fx.server.url, signup: 'example', json },
          { storeFactory: fx.storeFactory },
        );
        expect(code).toBe(1);
        const text = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
        expect(text).toContain('thesignup auth login');
        expect(text).toContain('analytics:read');
        expect(text).not.toContain('HTTP 403');
        if (json) expect(JSON.parse(text).error).toBe('insufficient_scope');
      } finally {
        stderr.mockRestore();
      }
    });
  }

  test('does not treat a forbidden body without a scope challenge as insufficient_scope', async () => {
    fx.server.denyScope('GET', '/v1/signups/example/analytics', 'analytics:read', false);
    const stderr = spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const code = await runAnalytics(
        { profile: fx.profile, apiBase: fx.server.url, signup: 'example', json: true },
        { storeFactory: fx.storeFactory },
      );
      expect(code).toBe(1);
      const error = JSON.parse(stderr.mock.calls.map(([chunk]) => String(chunk)).join('')) as {
        error: string;
        message: string;
      };
      expect(error.error).toBe('forbidden');
      expect(error.message).toBe('Insufficient scope');
      expect(error.message).not.toContain('thesignup auth login');
    } finally {
      stderr.mockRestore();
    }
  });
});
