import { createAuthenticatedClient, type AuthenticatedClient } from '../../http/client.ts';
import { createCredentialStore, type CredentialStore } from '../../storage/credentials.ts';
import { resolveProfile, type ProfileContext } from '../../config/profile.ts';
import { DEFAULT_CLIENT_ID } from '../auth/login.ts';
import { emitError, type OutputContext } from '../../util/output.ts';

export interface CommonOptions {
  profile?: string;
  apiBase?: string;
  json?: boolean;
}

export interface ClientDeps {
  storeFactory?: typeof createCredentialStore;
  fetchImpl?: typeof fetch;
  now?: () => number;
  clientId?: string;
}

export interface ResolvedClient {
  client: AuthenticatedClient;
  store: CredentialStore;
  profile: ProfileContext;
}

export function buildClient(opts: CommonOptions, deps: ClientDeps = {}): ResolvedClient {
  const profile = resolveProfile({ flagProfile: opts.profile, flagApiBase: opts.apiBase });
  const store = (deps.storeFactory ?? createCredentialStore)();
  const client = createAuthenticatedClient({
    store,
    profile: profile.name,
    clientId: deps.clientId ?? DEFAULT_CLIENT_ID,
    apiBase: opts.apiBase ?? profile.apiBase,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.now ? { now: deps.now } : {}),
  });
  return { client, store, profile };
}

export interface ApiErrorBody {
  error?: string;
  message?: string;
  code?: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  body?: ApiErrorBody;
  constructor(status: number, message: string, body?: ApiErrorBody, code?: string) {
    super(message);
    this.status = status;
    if (body !== undefined) this.body = body;
    if (code !== undefined) this.code = code;
  }
}

export async function apiJson<T>(
  client: AuthenticatedClient,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const res = await client.fetch(path, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let body: ApiErrorBody | undefined;
    try {
      body = text ? (JSON.parse(text) as ApiErrorBody) : undefined;
    } catch {
      body = { message: text };
    }
    const message = body?.message ?? body?.error ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, message, body, body?.code ?? body?.error);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function failWithError(ctx: OutputContext, err: unknown): number {
  if (err instanceof ApiError) {
    emitError(ctx, err.message, err.code ?? `http_${err.status}`);
    return 1;
  }
  if (err instanceof Error) {
    emitError(ctx, err.message);
    return 1;
  }
  emitError(ctx, String(err));
  return 1;
}
