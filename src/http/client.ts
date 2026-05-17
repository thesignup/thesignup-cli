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
      const url = resolveRequestUrl(apiBase, path);

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

// Build the request URL from the configured API base. A relative path is
// joined to the base; an absolute URL is only honoured when it points at the
// same origin as the base. This prevents the bearer token from being attached
// to a request aimed at an arbitrary host (e.g. an attacker-controlled
// "next page" link returned in an API response).
export function resolveRequestUrl(apiBase: string, path: string): string {
  if (!/^https?:\/\//i.test(path)) {
    return `${stripTrailingSlash(apiBase)}${path.startsWith('/') ? path : `/${path}`}`;
  }
  const target = new URL(path);
  const base = new URL(apiBase);
  if (target.origin !== base.origin) {
    throw new Error(`refusing to send credentials to ${target.origin} — expected ${base.origin}`);
  }
  return target.href;
}
