#!/usr/bin/env node
/**
 * Post-install: pick the right pre-built thesignup binary for this platform
 * and drop it into bin/. Idempotent. Bails out cleanly on unsupported
 * platforms or when running inside the source repo (during `bun install`
 * for local development).
 *
 * Override the source URL with THESIGNUP_CLI_DOWNLOAD_URL=...
 * Skip entirely with THESIGNUP_CLI_SKIP_POSTINSTALL=1.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');

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

fs.mkdirSync(targetDir, { recursive: true });
download(baseUrl, targetPath)
  .then(() => {
    if (triple.os !== 'windows') {
      fs.chmodSync(targetPath, 0o755);
    }
    console.log(`thesignup: installed ${filename} → ${targetPath}`);
  })
  .catch((err) => {
    console.error(`thesignup: failed to download binary: ${err.message}`);
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

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        if (!res.headers.location) {
          reject(new Error(`redirect with no Location header: ${res.statusCode}`));
          return;
        }
        download(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      const file = fs.createWriteStream(dest, { mode: 0o755 });
      res.pipe(file);
      file.on('finish', () => file.close((err) => (err ? reject(err) : resolve())));
      file.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error('download timed out after 30s')));
  });
}
