#!/usr/bin/env node
/**
 * Compute the SHA-256 of every prebuilt binary in dist/ and write it into
 * package.json under `binaryChecksums`. Run after `bun run build:all`.
 *
 * scripts/postinstall.cjs refuses to install a binary whose hash is not listed
 * here, so this step is what makes a published release installable. The repo
 * keeps empty placeholders on purpose — the release workflow fills them into
 * the npm tarball at publish time; nothing is committed back.
 *
 * stdout: one `<sha256>  <filename>` line per binary (shasum -c compatible).
 * stderr: human-readable status. Exits non-zero if any artifact is missing.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const repoRoot = path.resolve(__dirname, '..');
const pkgPath = path.join(repoRoot, 'package.json');
const distDir = path.join(repoRoot, 'dist');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const keys = Object.keys(pkg.binaryChecksums ?? {});
if (keys.length === 0) {
  console.error('write-checksums: package.json has no "binaryChecksums" entries to fill');
  process.exit(1);
}

let failed = false;
for (const key of keys) {
  const file = path.join(distDir, key);
  if (!fs.existsSync(file)) {
    console.error(`write-checksums: missing build artifact dist/${key} — run \`bun run build:all\``);
    failed = true;
    continue;
  }
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  pkg.binaryChecksums[key] = hash;
  // stdout — captured into checksums.txt and published as a release asset.
  console.log(`${hash}  ${key}`);
}
if (failed) {
  process.exit(1);
}

fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.error(`write-checksums: injected ${keys.length} checksum(s) into package.json`);
