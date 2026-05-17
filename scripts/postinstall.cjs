#!/usr/bin/env node
/**
 * Post-install: pick the right pre-built thesignup binary for this platform
 * and drop it into bin/. Idempotent. Bails out cleanly on unsupported
 * platforms or when running inside the source repo (during `bun install`
 * for local development).
 *
 * Security model:
 *  - The download must use HTTPS (loopback hosts may use HTTP for local
 *    testing). Redirects may not downgrade to plain HTTP.
 *  - The downloaded bytes are verified against a SHA-256 published in
 *    package.json (`binaryChecksums`) before the binary is installed or made
 *    executable. Without a matching expected checksum the install fails
 *    closed rather than running unverified native code.
 *
 * Override the source URL with THESIGNUP_CLI_DOWNLOAD_URL=... — when doing so
 * you must also supply THESIGNUP_CLI_DOWNLOAD_SHA256=... (lowercase hex).
 * Skip entirely with THESIGNUP_CLI_SKIP_POSTINSTALL=1.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const crypto = require('node:crypto');

const MAX_REDIRECTS = 5;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

if (process.env.THESIGNUP_CLI_SKIP_POSTINSTALL === '1') {
  console.log('thesignup: postinstall skipped via THESIGNUP_CLI_SKIP_POSTINSTALL=1');
  process.exit(0);
}

// When developing in the source repo, `bin/` won't exist on a fresh checkout
// (it's only created by this script), so we use the presence of src/ as a
// proxy for "we're in the source tree." Skip in that case so contributors
// don't hit a 404 every time they run `bun install`.
const repoRoot = path.resolve(__dirname, '..');
if (fs.existsSync(path.join(repoRoot, 'src', 'index.ts'))) {
  console.log('thesignup: postinstall skipped (running inside source repo)');
  process.exit(0);
}

const pkg = require('../package.json');
const version = pkg.version;

const triple = resolveTriple();
if (!triple) {
  console.error(
    `thesignup: no prebuilt binary for ${process.platform}/${process.arch} — file an issue.`,
  );
  process.exit(1);
}

const filename = triple.os === 'windows' ? `${triple.name}.exe` : triple.name;
const baseUrl =
  process.env.THESIGNUP_CLI_DOWNLOAD_URL ??
  `https://github.com/thesignup/thesignup-cli/releases/download/v${version}/${filename}`;
const targetDir = path.join(repoRoot, 'bin');
const targetPath = path.join(targetDir, triple.os === 'windows' ? 'thesignup.exe' : 'thesignup');

const expectedSha256 = resolveExpectedSha256();
if (!expectedSha256) {
  console.error(
    `thesignup: no SHA-256 checksum is available for ${filename}; refusing to install ` +
      `an unverified binary.\n` +
      (process.env.THESIGNUP_CLI_DOWNLOAD_URL
        ? `  Set THESIGNUP_CLI_DOWNLOAD_SHA256=<lowercase hex> alongside ` +
          `THESIGNUP_CLI_DOWNLOAD_URL.`
        : `  Maintainers: publish the checksum under "binaryChecksums" in package.json.`),
  );
  process.exit(1);
}

let assertSafeUrl;
try {
  assertSafeUrl = makeUrlGuard();
} catch (err) {
  console.error(`thesignup: ${err.message}`);
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });
const tmpPath = path.join(targetDir, `.thesignup-download-${process.pid}-${Date.now()}.tmp`);

download(baseUrl, tmpPath, 0)
  .then(() => {
    const actual = sha256OfFile(tmpPath);
    if (actual !== expectedSha256) {
      fs.rmSync(tmpPath, { force: true });
      throw new Error(
        `checksum mismatch for ${filename}\n` +
          `  expected: ${expectedSha256}\n` +
          `  actual:   ${actual}\n` +
          `  The download may be corrupt or tampered with — not installing.`,
      );
    }
    // Verified — move into place and only now make it executable.
    fs.renameSync(tmpPath, targetPath);
    if (triple.os !== 'windows') {
      fs.chmodSync(targetPath, 0o755);
    }
    console.log(`thesignup: installed ${filename} → ${targetPath} (sha256 verified)`);
  })
  .catch((err) => {
    fs.rmSync(tmpPath, { force: true });
    console.error(`thesignup: failed to install binary: ${err.message}`);
    console.error(`  URL: ${baseUrl}`);
    process.exit(1);
  });

function resolveTriple() {
  const p = process.platform;
  const a = process.arch;
  if (p === 'darwin' && a === 'arm64') return { os: 'darwin', name: 'thesignup-darwin-arm64' };
  if (p === 'darwin' && a === 'x64') return { os: 'darwin', name: 'thesignup-darwin-x64' };
  if (p === 'linux' && a === 'arm64') return { os: 'linux', name: 'thesignup-linux-arm64' };
  if (p === 'linux' && a === 'x64') return { os: 'linux', name: 'thesignup-linux-x64' };
  if (p === 'win32' && a === 'x64') return { os: 'windows', name: 'thesignup-windows-x64' };
  return null;
}

function resolveExpectedSha256() {
  const fromEnv = process.env.THESIGNUP_CLI_DOWNLOAD_SHA256;
  const raw = fromEnv ?? (pkg.binaryChecksums && pkg.binaryChecksums[filename]);
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

// Returns a guard that throws if a URL is not HTTPS (loopback HTTP excepted).
// Applied to the initial URL and to every redirect target.
function makeUrlGuard() {
  return function assertSafeUrl(rawUrl) {
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error(`invalid download URL: ${rawUrl}`);
    }
    if (parsed.protocol === 'https:') return parsed;
    if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname)) return parsed;
    throw new Error(
      `refusing to download over ${parsed.protocol}// — HTTPS is required ` +
        `(URL: ${rawUrl})`,
    );
  };
}

function sha256OfFile(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function download(rawUrl, dest, redirectCount) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = assertSafeUrl(rawUrl);
    } catch (err) {
      reject(err);
      return;
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(parsed, (res) => {
      const status = res.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        res.resume();
        if (!res.headers.location) {
          reject(new Error(`redirect with no Location header: ${status}`));
          return;
        }
        if (redirectCount >= MAX_REDIRECTS) {
          reject(new Error(`too many redirects (>${MAX_REDIRECTS})`));
          return;
        }
        // Resolve the location relative to the current URL, then re-check it
        // — this is where an https→http downgrade would be caught.
        const next = new URL(res.headers.location, parsed).toString();
        download(next, dest, redirectCount + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`HTTP ${status}`));
        return;
      }
      const file = fs.createWriteStream(dest, { mode: 0o600 });
      res.pipe(file);
      file.on('finish', () => file.close((err) => (err ? reject(err) : resolve())));
      file.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error('download timed out after 30s')));
  });
}
