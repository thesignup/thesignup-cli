import { refreshAccessToken } from '../oauth/device-flow.ts';
import type { CredentialStore, StoredCredentials } from '../storage/credentials.ts';

export interface AuthenticatedClientOptions {
  store: CredentialStore;
  profile: string;
  clientId: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface AuthenticatedClient {
  fetch(path: string, init?: RequestInit): Promise<Response>;
  getStoredCredentials(): Promise<StoredCredentials | null>;
}

export function createAuthenticatedClient(opts: AuthenticatedClientOptions): AuthenticatedClient {
  const f = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;

  const ensureFresh = async (creds: StoredCredentials): Promise<StoredCredentials> => {
    if (creds.expiresAt - now() > 30_000) return creds;
    if (!creds.refreshToken) return creds;
    const fresh = await refreshAccessToken({
      apiBase: creds.apiBase,
      clientId: opts.clientId,
      refreshToken: creds.refreshToken,
      fetchImpl: f,
    });
    const updated: StoredCredentials = {
      ...creds,
      accessToken: fresh.access_token,
      refreshToken: fresh.refresh_token ?? creds.refreshToken,
      expiresAt: now() + fresh.expires_in * 1000,
      scope: fresh.scope ?? creds.scope,
      obtainedAt: now(),
    };
    await opts.store.save(opts.profile, updated);
    return updated;
  };

  return {
    async getStoredCredentials() {
      return opts.store.load(opts.profile);
    },

    async fetch(path, init = {}) {
      const creds = await opts.store.load(opts.profile);
      if (!creds) {
        throw new Error(
          `not authenticated for profile "${opts.profile}" — run 'thesignup auth login'`,
        );
      }
      const fresh = await ensureFresh(creds);
      const apiBase = opts.apiBase ?? fresh.apiBase;
      const url =
        path.startsWith('http://') || path.startsWith('https://')
          ? path
          : `${stripTrailingSlash(apiBase)}${path.startsWith('/') ? path : `/${path}`}`;

      const headers = new Headers(init.headers);
      headers.set('authorization', `Bearer ${fresh.accessToken}`);
      if (!headers.has('accept')) headers.set('accept', 'application/json');

      const res = await f(url, { ...init, headers });
      if (res.status !== 401 || !fresh.refreshToken) return res;

      // 401 — try one refresh + retry
      const retried = await refreshAccessToken({
        apiBase: fresh.apiBase,
        clientId: opts.clientId,
        refreshToken: fresh.refreshToken,
        fetchImpl: f,
      });
      const updated: StoredCredentials = {
        ...fresh,
        accessToken: retried.access_token,
        refreshToken: retried.refresh_token ?? fresh.refreshToken,
        expiresAt: now() + retried.expires_in * 1000,
        scope: retried.scope ?? fresh.scope,
        obtainedAt: now(),
      };
      await opts.store.save(opts.profile, updated);
      headers.set('authorization', `Bearer ${updated.accessToken}`);
      return f(url, { ...init, headers });
    },
  };
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
