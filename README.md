# `thesignup` CLI

The official command-line tool for [thesignup](https://thesignup.app). Single-binary, cross-platform, written in TypeScript and built with [Bun](https://bun.sh).

> **Status:** alpha. The OAuth backend it talks to is rolling out alongside this repo. Until the API ships device-code support, `thesignup auth login` only works against a mock fixture in tests.

## Install

```sh
npm install -g @thesignup/cli
```

This installs the `thesignup` command. Or build from source:

```sh
bun install
bun run build
./dist/thesignup --help
```

## Quick start

```sh
# log in (opens your browser to authorize the CLI)
thesignup auth login

# check the active identity
thesignup auth status

# log out (revokes the token and clears local credentials)
thesignup auth logout
```

## Profiles

Run multiple identities side-by-side with `--profile`:

```sh
thesignup auth login --profile work
thesignup auth login --profile personal
thesignup auth status --profile work
```

The active profile can also be selected with the `THESIGNUP_PROFILE` environment variable.

## Configuration

| Setting    | Flag           | Env var                | Default                  |
| ---------- | -------------- | ---------------------- | ------------------------ |
| Profile    | `--profile`    | `THESIGNUP_PROFILE`    | `default`                |
| API base   | `--api-base`   | `THESIGNUP_API_BASE`   | `https://thesignup.app`  |
| JSON output| `--json`       | —                      | pretty                   |

## Where credentials live

The CLI tries the OS keychain first (via `@napi-rs/keyring`):

- macOS: Keychain (Login keychain)
- Linux: Secret Service (GNOME Keyring, KWallet)
- Windows: Credential Manager

If the keychain isn't available, the CLI falls back to an AES-256-GCM encrypted file:

- macOS / Linux: `~/.config/thesignup/credentials` (or `$XDG_CONFIG_HOME/thesignup/credentials`)
- Windows: `%APPDATA%\thesignup\credentials`

The encryption key is derived from a machine-id source; this is best-effort obfuscation, **not** a hardware-backed secret. Treat the credentials file like an SSH key.

## Output formats

Pretty by default; pass `--json` for machine-readable output suitable for piping into other tools:

```sh
thesignup auth status --json | jq .
```

## Development

```sh
bun install
bun run start -- auth --help    # run from source
bun test                        # run unit + integration tests
bun run typecheck
bun run lint
bun run build                   # current host binary
bun run build:all               # all 5 targets (macOS x64/arm64, Linux x64/arm64, Windows x64)
```

See `CLAUDE.md` for the contributor checklist.

## License

[MIT](./LICENSE)
