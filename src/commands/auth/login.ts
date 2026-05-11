import { OAuthError, pollForToken, requestDeviceAuthorization } from '../../oauth/device-flow.ts';
import { createCredentialStore, type StoredCredentials } from '../../storage/credentials.ts';
import { resolveProfile } from '../../config/profile.ts';
import { emit, emitError, makeOutput } from '../../util/output.ts';
import { openUrl } from '../../util/open-url.ts';

export const DEFAULT_CLIENT_ID = 'cli_thesignup_official';
export const DEFAULT_SCOPES = [
  'signups:read',
  'signups:write',
  'participants:read',
  'participants:write',
  'webhooks:read',
  'webhooks:write',
  // Required for refresh-token issuance — the API only mints refresh
  // tokens when offline_access is in the granted scope set. Without it,
  // the proactive-refresh + 401-retry paths in src/http/client.ts never
  // run and users have to `auth login` every hour.
  'offline_access',
].join(' ');

export interface LoginOptions {
  profile?: string;
  apiBase?: string;
  json?: boolean;
  noBrowser?: boolean;
  scope?: string;
  clientId?: string;
}

export interface LoginDeps {
  fetchImpl?: typeof fetch;
  openUrlImpl?: typeof openUrl;
  promptOpenBrowser?: () => Promise<boolean>;
  storeFactory?: typeof createCredentialStore;
  now?: () => number;
  exit?: (code: number) => never;
}

export async function runLogin(opts: LoginOptions = {}, deps: LoginDeps = {}): Promise<number> {
  const ctx = makeOutput({ json: opts.json });
  const profile = resolveProfile({ flagProfile: opts.profile, flagApiBase: opts.apiBase });
  const clientId = opts.clientId ?? DEFAULT_CLIENT_ID;
  const scope = opts.scope ?? DEFAULT_SCOPES;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const storeFactory = deps.storeFactory ?? createCredentialStore;
  const store = storeFactory();

  let device;
  try {
    device = await requestDeviceAuthorization({
      apiBase: profile.apiBase,
      clientId,
      scope,
      fetchImpl,
    });
  } catch (err) {
    return failWith(ctx, err);
  }

  const verifyUrl = device.verification_uri_complete ?? device.verification_uri;

  if (ctx.format === 'pretty') {
    ctx.stdout.write(
      [
        '',
        `Open this URL in your browser to authorize:`,
        `  ${verifyUrl}`,
        '',
        `Verification code: ${device.user_code}`,
        '',
      ].join('\n') + '\n',
    );
    const shouldOpen =
      !opts.noBrowser && (await (deps.promptOpenBrowser?.() ?? Promise.resolve(true)));
    if (shouldOpen) {
      const opener = deps.openUrlImpl ?? openUrl;
      try {
        await opener(verifyUrl);
      } catch {
        ctx.stdout.write(`(failed to open browser; visit the URL manually)\n`);
      }
    }
    ctx.stdout.write(`Waiting for authorization…\n`);
  }

  let tokens;
  try {
    tokens = await pollForToken({
      apiBase: profile.apiBase,
      clientId,
      deviceCode: device.device_code,
      interval: device.interval,
      expiresIn: device.expires_in,
      fetchImpl,
    });
  } catch (err) {
    return failWith(ctx, err);
  }

  const stored: StoredCredentials = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: now() + tokens.expires_in * 1000,
    scope: tokens.scope ?? scope,
    apiBase: profile.apiBase,
    obtainedAt: now(),
  };

  let identity: StoredCredentials['identity'];
  try {
    const meRes = await fetchImpl(`${stripTrailingSlash(profile.apiBase)}/v1/me`, {
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        accept: 'application/json',
      },
    });
    if (meRes.ok) {
      const me = (await meRes.json().catch(() => null)) as {
        id?: string;
        name?: string;
        email?: string;
      } | null;
      if (me) identity = { id: me.id, name: me.name, email: me.email };
    }
  } catch {
    // /v1/me failure shouldn't block login — we still have valid tokens
  }
  if (identity) stored.identity = identity;

  await store.save(profile.name, stored);
  const backend = await store.backend();

  emit(
    ctx,
    {
      ok: true,
      profile: profile.name,
      apiBase: profile.apiBase,
      backend,
      scope: stored.scope,
      identity,
      expiresAt: new Date(stored.expiresAt).toISOString(),
    },
    [
      identity?.email
        ? `Logged in as ${identity.name ?? identity.email} (${identity.email}).`
        : `Logged in successfully.`,
      `Profile: ${profile.name}  API: ${profile.apiBase}  Storage: ${backend}`,
    ],
  );
  return 0;
}

function failWith(ctx: ReturnType<typeof makeOutput>, err: unknown): number {
  if (err instanceof OAuthError) {
    const hint =
      err.code === 'expired_token'
        ? ' — re-run `thesignup auth login`'
        : err.code === 'access_denied'
          ? ' — authorization was denied'
          : '';
    emitError(ctx, `${err.message}${hint}`, err.code);
  } else if (err instanceof Error) {
    emitError(ctx, err.message);
  } else {
    emitError(ctx, String(err));
  }
  return 1;
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
