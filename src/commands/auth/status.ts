import { resolveProfile } from '../../config/profile.ts';
import { createCredentialStore } from '../../storage/credentials.ts';
import { emit, makeOutput } from '../../util/output.ts';

export interface StatusOptions {
  profile?: string;
  apiBase?: string;
  json?: boolean;
}

export interface StatusDeps {
  storeFactory?: typeof createCredentialStore;
  now?: () => number;
}

export async function runStatus(opts: StatusOptions = {}, deps: StatusDeps = {}): Promise<number> {
  const ctx = makeOutput({ json: opts.json });
  const profile = resolveProfile({ flagProfile: opts.profile, flagApiBase: opts.apiBase });
  const now = deps.now ?? Date.now;
  const storeFactory = deps.storeFactory ?? createCredentialStore;
  const store = storeFactory();

  const creds = await store.load(profile.name);
  const backend = await store.backend();

  if (!creds) {
    emit(ctx, { ok: false, loggedIn: false, profile: profile.name, backend }, [
      `Profile "${profile.name}" is not logged in.`,
      `Run: thesignup auth login --profile ${profile.name}`,
    ]);
    return 1;
  }

  const expired = creds.expiresAt <= now();
  const lines = [
    creds.identity?.email
      ? `Logged in as ${creds.identity.name ?? creds.identity.email} (${creds.identity.email}).`
      : `Logged in.`,
    `Profile:    ${profile.name}`,
    `API base:   ${creds.apiBase}`,
    `Storage:    ${backend}`,
    `Scope:      ${creds.scope ?? '(unknown)'}`,
    `Token:      ${expired ? 'expired (will refresh on next call)' : `valid until ${new Date(creds.expiresAt).toISOString()}`}`,
  ];

  emit(
    ctx,
    {
      ok: true,
      loggedIn: true,
      profile: profile.name,
      backend,
      apiBase: creds.apiBase,
      scope: creds.scope,
      identity: creds.identity,
      expiresAt: new Date(creds.expiresAt).toISOString(),
      expired,
    },
    lines,
  );
  return 0;
}
