// A token that predates a scope the CLI now needs gets a 403 from the API. The
// API's problem body carries `code: "forbidden"`; the machine-readable signal
// is the RFC 6750 challenge on the response —
//   WWW-Authenticate: Bearer realm="thesignup", error="insufficient_scope",
//     scope="analytics:read", ...
// Recognise that (and a body-level `insufficient_scope` code, for servers that
// put it there) and turn it into an actionable message instead of a raw error.

export const INSUFFICIENT_SCOPE_CODE = 'insufficient_scope';

export class InsufficientScopeError extends Error {
  readonly status = 403;
  readonly code = INSUFFICIENT_SCOPE_CODE;
  readonly requiredScope: string | undefined;
  constructor(requiredScope?: string) {
    super(insufficientScopeMessage(requiredScope));
    this.name = 'InsufficientScopeError';
    this.requiredScope = requiredScope;
  }
}

export function insufficientScopeMessage(requiredScope?: string): string {
  const need = requiredScope ? ` (needs scope "${requiredScope}")` : '';
  return `your saved login doesn't have permission for this command${need} — run \`thesignup auth login\` again to grant it`;
}

export interface InsufficientScopeMatch {
  requiredScope?: string;
}

// Returns a match when a response is a 403 insufficient_scope; null otherwise.
// `body` is the parsed JSON error body, when the caller has one.
export function matchInsufficientScope(
  status: number,
  headers: Headers,
  body?: { error?: unknown; code?: unknown } | null,
): InsufficientScopeMatch | null {
  if (status !== 403) return null;
  const challenge = headers.get('www-authenticate') ?? '';
  const headerHit = /\berror="?insufficient_scope"?/i.test(challenge);
  const bodyHit = body?.error === INSUFFICIENT_SCOPE_CODE || body?.code === INSUFFICIENT_SCOPE_CODE;
  if (!headerHit && !bodyHit) return null;
  const scope = challenge.match(/\bscope="([^"]*)"/i)?.[1]?.trim();
  return scope ? { requiredScope: scope } : {};
}
