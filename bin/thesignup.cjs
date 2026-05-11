#!/usr/bin/env node
/**
 * Bin shim — npm symlinks node_modules/.bin/thesignup to this file. The real
 * native binary is dropped into bin/thesignup (or bin/thesignup.exe on
 * Windows) by scripts/postinstall.cjs. This shim just exec's that binary
 * with the same argv.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const binName = process.platform === 'win32' ? 'thesignup.exe' : 'thesignup';
const binPath = path.join(__dirname, binName);

if (!fs.existsSync(binPath)) {
  console.error(
    `thesignup: native binary not found at ${binPath}.\n` +
      `The postinstall step may have failed. Re-run install with the package, or\n` +
      `set THESIGNUP_CLI_DOWNLOAD_URL and run \`node scripts/postinstall.cjs\` manually.`,
  );
  process.exit(1);
}

const res = spawnSync(binPath, process.argv.slice(2), { stdio: 'inherit' });
if (res.error) {
  console.error(`thesignup: failed to exec: ${res.error.message}`);
  process.exit(1);
}
process.exit(res.status ?? 0);
