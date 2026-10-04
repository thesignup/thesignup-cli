// The OAuth scopes each shipped command needs, keyed by the full command path
// as commander reports it (e.g. "signups list").
//
// Source of truth for `DEFAULT_SCOPES` in auth/login.ts, enforced by
// scopes.test.ts: every leaf command in the program must have an entry here,
// and DEFAULT_SCOPES must equal the union of these scopes plus
// `offline_access`. A new command therefore can't ship without declaring (and
// logging in with) the scope it needs.
//
// Each entry mirrors the `requiredScopes` of the API route(s) the command calls
// (thesignup `src/app/api/v1/**/route.ts`). Add the scope here in the same PR
// as the command.
export const COMMAND_SCOPES: Readonly<Record<string, readonly string[]>> = {
  'auth login': [],
  'auth logout': [],
  'auth status': [],

  // `--watch` on the two list commands also opens GET /v1/webhooks/events,
  // which needs webhooks:read.
  'signups list': ['signups:read', 'webhooks:read'],
  'signups create': ['signups:write'],
  'signups view': ['signups:read'],
  'signups edit': ['signups:read', 'signups:write'],
  'signups cancel': ['signups:write'],
  'signups duplicate': ['signups:write'],
  'signups publish': ['signups:write'],

  'participants list': ['participants:read', 'webhooks:read'],
  // POST /v1/signups/:id/participants is anonymous-allowed and requires no
  // scope (the API's `register:write` is only enforced on the MCP surface).
  // Resolving --slot/--item names reads /slots and /items, hence signups:read.
  'participants add': ['signups:read'],
  'participants remove': ['participants:write'],
  register: ['signups:read'],

  'ai draft': ['ai:draft'],
  analytics: ['analytics:read'],

  'webhooks list': ['webhooks:read'],
  'webhooks create': ['webhooks:write'],
  'webhooks listen': ['webhooks:read'],

  completion: [],
};

// Scope granted for refresh-token issuance, not required by any route.
export const OFFLINE_ACCESS_SCOPE = 'offline_access';

export function requiredScopesForCommands(): string[] {
  return [...new Set(Object.values(COMMAND_SCOPES).flat())].sort();
}
