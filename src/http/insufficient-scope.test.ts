import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { matchInsufficientScope } from './insufficient-scope.ts';
import { runAnalytics } from '../commands/analytics.ts';
import { runAiDraft } from '../commands/ai.ts';
import { runWebhooksListen } from '../commands/webhooks/listen.ts';
import { createCommandFixture, type CommandFixture } from '../../test/command-fixture.ts';

describe('matchInsufficientScope', () => {
  const challenge = (v: string) => new Headers({ 'www-authenticate': v });

  test('matches the RFC 6750 challenge and extracts the scope', () => {
    const m = matchInsufficientScope(
      403,
      challenge('Bearer realm="thesignup", error="insufficient_scope", scope="analytics:read"'),
    );
    expect(m).toEqual({ requiredScope: 'analytics:read' });
  });

  test('matches a body-level insufficient_scope code', () => {
    expect(matchInsufficientScope(403, new Headers(), { error: 'insufficient_scope' })).toEqual({});
  });

  test('ignores other 403s and other statuses', () => {
    expect(matchInsufficientScope(403, new Headers(), { code: 'forbidden' })).toBeNull();
    expect(matchInsufficientScope(401, challenge('Bearer error="insufficient_scope"'))).toBeNull();
  });
});

describe('insufficient_scope surfaces a re-login hint, not a raw error', () => {
  let fx: CommandFixture;
  let stderr = '';
  let origWrite: typeof process.stderr.write;

  beforeEach(async () => {
    fx = await createCommandFixture();
    fx.server.seedSignup({
      id: 'su_a',
      slug: 'ev',
      status: 'active',
      title: 'E',
      created_at: '2026-05-01T00:00:00Z',
      updated_at: '2026-05-01T00:00:00Z',
    });
    stderr = '';
    origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr += chunk.toString();
      return true;
    }) as typeof process.stderr.write;
  });
  afterEach(async () => {
    process.stderr.write = origWrite;
    await fx.cleanup();
  });

  const base = () => ({ profile: fx.profile, apiBase: fx.server.url });

  test('analytics', async () => {
    fx.server.denyScope('/v1/signups/ev/analytics', 'analytics:read');
    const code = await runAnalytics({ ...base(), signup: 'ev' }, { storeFactory: fx.storeFactory });
    expect(code).toBe(1);
    expect(stderr).toContain('thesignup auth login');
    expect(stderr).toContain('analytics:read');
    expect(stderr).not.toContain('Missing required scope');
    expect(stderr).not.toContain('HTTP 403');
  });

  test('ai draft, in --json mode', async () => {
    fx.server.denyScope('/v1/signups/from-description', 'ai:draft');
    const code = await runAiDraft(
      { ...base(), json: true, description: 'x' },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(1);
    const parsed = JSON.parse(stderr) as { error: string; message: string };
    expect(parsed.error).toBe('insufficient_scope');
    expect(parsed.message).toContain('thesignup auth login');
  });

  test('webhooks listen (SSE) fails fast without retrying', async () => {
    fx.server.denyScope('/v1/webhooks/events', 'webhooks:read');
    const controller = new AbortController();
    const before = fx.server.recordedRequests().length;
    const code = await runWebhooksListen(
      { ...base(), forwardTo: 'http://127.0.0.1:1/x', signal: controller.signal },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(1);
    expect(fx.server.recordedRequests().length - before).toBe(1);
    expect(stderr).toContain('thesignup auth login');
  });
});
