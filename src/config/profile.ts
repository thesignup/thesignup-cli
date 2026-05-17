export const DEFAULT_PROFILE = 'default';
export const DEFAULT_API_BASE = 'https://thesignup.app';

export interface ProfileContext {
  name: string;
  apiBase: string;
}

export interface ResolveProfileInput {
  flagProfile?: string | undefined;
  flagApiBase?: string | undefined;
  env?: NodeJS.ProcessEnv;
}

// Plain HTTP is only acceptable for loopback addresses — there the traffic
// never leaves the machine, so it can't be intercepted. Any other host must
// use HTTPS, otherwise the access/refresh tokens would travel in cleartext.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

export function resolveProfile(input: ResolveProfileInput = {}): ProfileContext {
  const env = input.env ?? process.env;
  const name = input.flagProfile ?? env.THESIGNUP_PROFILE ?? DEFAULT_PROFILE;
  const apiBase = input.flagApiBase ?? env.THESIGNUP_API_BASE ?? DEFAULT_API_BASE;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
    throw new Error(
      `invalid profile name: "${name}" (must be 1–64 chars of letters, digits, "_" or "-")`,
    );
  }
  assertSafeApiBase(apiBase);
  return { name, apiBase };
}

function assertSafeApiBase(apiBase: string): void {
  let url: URL;
  try {
    url = new URL(apiBase);
  } catch {
    throw new Error(`invalid API base URL: "${apiBase}"`);
  }
  if (url.protocol === 'https:') return;
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return;
  throw new Error(
    `refusing to use API base "${apiBase}": credentials may only be sent over HTTPS ` +
      `(plain HTTP is allowed only for loopback hosts such as localhost)`,
  );
}
