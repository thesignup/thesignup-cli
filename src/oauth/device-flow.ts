import { setTimeout as sleepMs } from 'node:timers/promises';

export interface DeviceAuthorizationResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface OAuthErrorResponse {
  error: string;
  error_description?: string;
}

export class OAuthError extends Error {
  readonly code: string;
  readonly description: string | undefined;
  readonly status: number;

  constructor(code: string, description: string | undefined, status: number) {
    super(description ? `${code}: ${description}` : code);
    this.name = 'OAuthError';
    this.code = code;
    this.description = description;
    this.status = status;
  }
}

export const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

export interface RequestDeviceAuthorizationOptions {
  apiBase: string;
  clientId: string;
  scope?: string;
  fetchImpl?: typeof fetch;
}

export async function requestDeviceAuthorization(
  opts: RequestDeviceAuthorizationOptions,
): Promise<DeviceAuthorizationResponse> {
  const f = opts.fetchImpl ?? fetch;
  const body = new URLSearchParams({ client_id: opts.clientId });
  if (opts.scope) body.set('scope', opts.scope);

  const res = await f(`${stripTrailingSlash(opts.apiBase)}/oauth/device_authorization`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: body.toString(),
  });

  const json = (await res.json().catch(() => ({}))) as
    | DeviceAuthorizationResponse
    | OAuthErrorResponse
    | Record<string, unknown>;

  if (!res.ok) {
    const err = json as OAuthErrorResponse;
    throw new OAuthError(
      err.error ?? 'device_authorization_failed',
      err.error_description,
      res.status,
    );
  }

  const ok = json as DeviceAuthorizationResponse;
  if (
    !ok.device_code ||
    !ok.user_code ||
    !ok.verification_uri ||
    typeof ok.expires_in !== 'number'
  ) {
    throw new OAuthError(
      'invalid_response',
      'device_authorization response missing required fields',
      res.status,
    );
  }
  return {
    ...ok,
    interval: typeof ok.interval === 'number' && ok.interval > 0 ? ok.interval : 5,
  };
}

export interface PollForTokenOptions {
  apiBase: string;
  clientId: string;
  deviceCode: string;
  interval: number;
  expiresIn: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
  onTick?: (info: { interval: number; elapsedMs: number }) => void;
}

export async function pollForToken(opts: PollForTokenOptions): Promise<TokenResponse> {
  const f = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms) => sleepMs(ms));
  const now = opts.now ?? Date.now;
  const start = now();
  const deadline = start + opts.expiresIn * 1000;
  let interval = Math.max(1, opts.interval);

  while (true) {
    if (opts.signal?.aborted) {
      throw new OAuthError('aborted', 'polling aborted by caller', 0);
    }
    if (now() >= deadline) {
      throw new OAuthError('expired_token', 'device code expired before approval', 400);
    }

    opts.onTick?.({ interval, elapsedMs: now() - start });
    await sleep(interval * 1000);

    const body = new URLSearchParams({
      grant_type: DEVICE_CODE_GRANT,
      device_code: opts.deviceCode,
      client_id: opts.clientId,
    });

    const res = await f(`${stripTrailingSlash(opts.apiBase)}/oauth/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: body.toString(),
    });

    const json = (await res.json().catch(() => ({}))) as
      | TokenResponse
      | OAuthErrorResponse
      | Record<string, unknown>;

    if (res.ok) return json as TokenResponse;

    const err = json as OAuthErrorResponse;
    switch (err.error) {
      case 'authorization_pending':
        continue;
      case 'slow_down':
        interval += 5;
        continue;
      case 'access_denied':
      case 'expired_token':
        throw new OAuthError(err.error, err.error_description, res.status);
      default:
        throw new OAuthError(
          err.error ?? 'token_request_failed',
          err.error_description,
          res.status,
        );
    }
  }
}

export interface RefreshAccessTokenOptions {
  apiBase: string;
  clientId: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}

export async function refreshAccessToken(opts: RefreshAccessTokenOptions): Promise<TokenResponse> {
  const f = opts.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
  });

  const res = await f(`${stripTrailingSlash(opts.apiBase)}/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: body.toString(),
  });

  const json = (await res.json().catch(() => ({}))) as
    | TokenResponse
    | OAuthErrorResponse
    | Record<string, unknown>;

  if (!res.ok) {
    const err = json as OAuthErrorResponse;
    throw new OAuthError(err.error ?? 'refresh_failed', err.error_description, res.status);
  }
  return json as TokenResponse;
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
