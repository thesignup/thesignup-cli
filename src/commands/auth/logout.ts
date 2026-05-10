import { resolveProfile } from '../../config/profile.ts';
import { createCredentialStore } from '../../storage/credentials.ts';
import { emit, emitError, makeOutput } from '../../util/output.ts';
import { DEFAULT_CLIENT_ID } from './login.ts';

export interface LogoutOptions {
  profile?: string;
  apiBase?: string;
  json?: boolean;
  clientId?: string;
}

export interface LogoutDeps {
  storeFactory?: typeof createCredentialStore;
  fetchImpl?: typeof fetch;
}

export async function runLogout(opts: LogoutOptions = {}, deps: LogoutDeps = {}): Promise<number> {
  const ctx = makeOutput({ json: opts.json });
  const profile = resolveProfile({ flagProfile: opts.profile, flagApiBase: opts.apiBase });
  const clientId = opts.clientId ?? DEFAULT_CLIENT_ID;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const storeFactory = deps.storeFactory ?? createCredentialStore;
  const store = storeFactory();

  const existing = await store.load(profile.name);
  if (!existing) {
    emit(ctx, { ok: true, profile: profile.name, alreadyLoggedOut: true }, [
      `No credentials stored for profile "${profile.name}".`,
    ]);
    return 0;
  }

  // best-effort revoke; ignore errors
  try {
    await fetchImpl(`${stripTrailingSlash(existing.apiBase)}/oauth/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token: existing.refreshToken ?? existing.accessToken,
        client_id: clientId,
      }).toString(),
    });
  } catch (err) {
    if (ctx.format === 'pretty') {
      emitError(
        ctx,
        `revoke request failed (${(err as Error).message}); clearing local credentials anyway.`,
      );
    }
  }

  await store.remove(profile.name);

  emit(ctx, { ok: true, profile: profile.name }, [
    `Logged out profile "${profile.name}". Credentials cleared.`,
  ]);
  return 0;
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
