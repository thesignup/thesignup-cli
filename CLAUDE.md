# CLAUDE.md — `thesignup-cli`

This file is read by Claude Code when working in this repo. Keep it short and current.

## What this is

The `thesignup` CLI: a single-binary, cross-platform command-line tool. Runtime is Bun. Language is TypeScript (strict). HTTP uses the built-in `fetch`. CLI framework is `commander`.

## Required gates before any push or PR

Run **all** of these locally and ensure they pass:

```sh
bun run lint
bun run format:check
bun run typecheck
bun test
bun run build
```

CI runs the same gates on every PR. Don't push if any are failing — fix the underlying issue rather than skipping.

## Tests-before-implementation

For new behaviour, write the test first, watch it fail, then make it pass. The OAuth flow, credential storage, and HTTP client all have unit tests with a mock OAuth server fixture (`test/mock-oauth-server.ts`) — extend that fixture rather than mocking `fetch` ad-hoc.

## Use Bun

- `bun run <script>` (not `npm run`)
- `bun add <pkg>` / `bun add -d <pkg>` (not `npm install`)
- `bun test` (not `jest` / `vitest`)
- `bun build --compile` for the binary
- `Bun.serve()` is fine for test fixtures; don't add `express`

Prefer `node:` imports over Bun-specific APIs in source files when the code might run in tests outside Bun (rare — most things are Bun-targeted), but `Bun.serve` is OK in `test/`.

## Auth flow contract

The CLI implements RFC 8628 (OAuth 2.0 Device Authorization Grant) against the `thesignup` API. The contract is owned by the API repo's `cli-backend-handoff.md`. **Do not unilaterally change endpoint shapes** — flag back to the user if you need a contract change.

- Default API base: `https://thesignup.app`
- Env override: `THESIGNUP_API_BASE`
- Flag override: `--api-base`
- Default `client_id`: `cli_thesignup_official`

## Storage

Tokens go into the OS keychain via `@napi-rs/keyring` when available. Otherwise, an AES-256-GCM encrypted JSON file at `~/.config/thesignup/credentials` (XDG-aware; `%APPDATA%\thesignup\credentials` on Windows). The encryption key is derived from a machine-id source — this is best-effort, not a hardware-backed secret. **Never commit any real credentials, even encrypted ones.**

## Layout

```
src/
  index.ts                  # commander root
  commands/auth/{login,logout,status}.ts
  oauth/{device-flow,pkce}.ts
  config/{paths,profile}.ts
  storage/credentials.ts
  http/client.ts
  util/{output,open-url}.ts
test/mock-oauth-server.ts   # shared test fixture
```

Tests live alongside the source as `*.test.ts`.

## Cutting a release

Only relevant when publishing a new version — normal development never touches this.

1. Be on `main` with the gates above green.
2. `npm version <patch|minor|major>` — bumps `package.json` and creates a matching `v…` tag.
3. `git push --follow-tags`.

Pushing the tag triggers `.github/workflows/release.yml`, which re-runs the gates, cross-compiles all five platform binaries, hashes them into `package.json` `binaryChecksums`, creates the GitHub release with the binaries attached, then `npm publish`es. The tag must match `package.json`'s version (step 2 keeps them in sync).

Publishing uses **npm Trusted Publishing (OIDC)** — there is no stored npm token. The `@thesignup/cli` package on npmjs.com must list this repo and `release.yml` as a trusted publisher (npmjs.com → package → Admin → Trusted Publisher). Because that can only be configured once the package exists, the **first ever publish must be done manually** (`npm pkg delete private` → `npm publish --access public` with an interactive OTP → restore `private`); every release after that is just a tag push.

The `binaryChecksums` entries stay empty in the repo on purpose — CI fills them into the published tarball; don't commit real hashes. `private: true` is likewise stripped by CI at publish time and should stay in the committed `package.json`.

## Things to avoid

- No `axios` — use `fetch`.
- No `dotenv` — Bun loads `.env` automatically; for runtime config, use the CLI flags or `THESIGNUP_*` env vars.
- No silent failures. The OAuth polling loop, credential save/load, and HTTP refresh wrapper must surface errors.
- No secrets in commits, fixtures, or test files.
