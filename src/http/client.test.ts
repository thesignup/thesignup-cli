import { describe, expect, test } from 'bun:test';
import { createAuthenticatedClient } from './client.ts';
import type { CredentialStore, StoredCredentials, StorageBackend } from '../storage/credentials.ts';

function memoryStore(initial: Record<string, StoredCredentials>): CredentialStore {
  const data = { ...initial };
  return {
    async backend(): Promise<StorageBackend> {
      return 'file';
    },
    async load(profile) {
      return data[profile] ?? null;
    },
    async save(profile, creds) {
      data[profile] = creds;
    },
    async remove(profile) {
      delete data[profile];
    },
    async listProfiles() {
      return Object.keys(data);
    },
  };
}

const baseCreds = (overrides: Partial<StoredCredentials> = {}): StoredCredentials => ({
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: Date.now() + 3600_000,
  scope: 'signups:read',
  apiBase: 'https://api.test',
  obtainedAt: Date.now(),
  ...overrides,
});

describe('createAuthenticatedClient', () => {
  test('attaches Authorization: Bearer header', async () => {
    const store = memoryStore({ default: baseCreds() });
    const seen: Headers[] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    const client = createAuthenticatedClient({
      store,
      profile: 'default',
      clientId: 'cli',
      fetchImpl,
    });
    const res = await client.fetch('/v1/me');
    expect(res.status).toBe(200);
    expect(seen[0]?.get('authorization')).toBe('Bearer access-1');
  });

  test('refreshes proactively when token is near expiry', async () => {
    const store = memoryStore({
      default: baseCreds({ accessToken: 'old', expiresAt: Date.now() + 1000 }),
    });
    let calls = 0;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls++;
      const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      if (u.endsWith('/oauth/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'fresh-1',
            refresh_token: 'refresh-2',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'signups:read',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      const auth = new Headers(init?.headers).get('authorization');
      return new Response(auth ?? '', { status: 200 });
    }) as typeof fetch;

    const client = createAuthenticatedClient({
      store,
      profile: 'default',
      clientId: 'cli',
      fetchImpl,
    });
    const res = await client.fetch('/v1/me');
    expect(await res.text()).toBe('Bearer fresh-1');
    expect(calls).toBe(2);

    const after = await store.load('default');
    expect(after?.accessToken).toBe('fresh-1');
    expect(after?.refreshToken).toBe('refresh-2');
  });

  test('on 401 it refreshes and retries once', async () => {
    const store = memoryStore({ default: baseCreds() });
    let resourceCalls = 0;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      if (u.endsWith('/oauth/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'fresh-1',
            refresh_token: 'refresh-2',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      resourceCalls++;
      const auth = new Headers(init?.headers).get('authorization');
      if (auth === 'Bearer access-1') return new Response('expired', { status: 401 });
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    const client = createAuthenticatedClient({
      store,
      profile: 'default',
      clientId: 'cli',
      fetchImpl,
    });
    const res = await client.fetch('/v1/protected');
    expect(res.status).toBe(200);
    expect(resourceCalls).toBe(2);
    expect((await store.load('default'))?.accessToken).toBe('fresh-1');
  });

  test('throws when no credentials stored for profile', async () => {
    const store = memoryStore({});
    const client = createAuthenticatedClient({
      store,
      profile: 'default',
      clientId: 'cli',
    });
    await expect(client.fetch('/v1/me')).rejects.toThrow(/not authenticated/);
  });
});
