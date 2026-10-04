import { describe, expect, test } from 'bun:test';
import { responseError } from './api-error.ts';

describe('WWW-Authenticate scope challenges', () => {
  const cases = [
    {
      name: 'API Bearer challenge',
      challenge: 'Bearer error="insufficient_scope", scope="analytics:read"',
      code: 'insufficient_scope',
      scope: 'analytics:read',
    },
    {
      name: 'case-insensitive Bearer and auth-param names with unquoted values',
      challenge: 'bEaReR ErRoR = insufficient_scope, ScOpE = analytics:read',
      code: 'insufficient_scope',
      scope: 'analytics:read',
    },
    {
      name: 'Bearer parameters after a realm with a comma inside quotes',
      challenge: 'Basic realm="one,two", Bearer realm="api", error="insufficient_scope"',
      code: 'insufficient_scope',
      scope: null,
    },
    {
      name: 'Basic error before an unrelated Bearer challenge',
      challenge: 'Basic error="insufficient_scope", Bearer realm="api"',
      code: 'forbidden',
      scope: null,
    },
    {
      name: 'Basic error after an unrelated Bearer challenge',
      challenge: 'Bearer realm="api", Basic error="insufficient_scope", scope="analytics:read"',
      code: 'forbidden',
      scope: null,
    },
    {
      name: 'a scope on another challenge does not contaminate Bearer error',
      challenge: 'Bearer error=insufficient_scope, Basic scope="analytics:read"',
      code: 'insufficient_scope',
      scope: null,
    },
    {
      name: 'quoted and unquoted parameters separated by a challenge',
      challenge:
        'Basic error=other, Bearer realm="api", error=insufficient_scope, scope="ai:draft"',
      code: 'insufficient_scope',
      scope: 'ai:draft',
    },
  ] as const;

  for (const { name, challenge, code, scope } of cases) {
    test(name, async () => {
      const res = new Response(JSON.stringify({ code: 'forbidden', detail: 'Denied' }), {
        status: 403,
        headers: { 'www-authenticate': challenge },
      });
      const error = await responseError(res);
      expect(error.code).toBe(code);
      if (code === 'insufficient_scope') {
        expect(error.message).toContain('thesignup auth login');
        expect(error.message).toContain(scope ?? 'a required scope');
        if (!scope) expect(error.message).not.toContain('analytics:read');
      } else {
        expect(error.message).toBe('Denied');
      }
    });
  }
});
