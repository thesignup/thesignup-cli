import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CACHE_TTL_MS,
  buildUpdateNotice,
  checkForUpdates,
  compareSemver,
  isValidSemver,
} from './update-check.ts';

let workDir: string;
let cachePath: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'thesignup-cli-update-test-'));
  cachePath = join(workDir, 'update-cache.json');
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function asFetch(fn: (...args: unknown[]) => Promise<Response>): typeof fetch {
  return fn as unknown as typeof fetch;
}

describe('compareSemver', () => {
  test('returns negative when a < b, positive when a > b, 0 when equal', () => {
    expect(compareSemver('1.2.3', '1.2.4')).toBe(-1);
    expect(compareSemver('2.0.0', '1.9.9')).toBe(1);
    expect(compareSemver('0.1.0', '0.1.0')).toBe(0);
  });
  test('handles missing patch / minor components', () => {
    expect(compareSemver('1.0', '1.0.0')).toBe(0);
    expect(compareSemver('1.1', '1.0.5')).toBe(1);
  });
  test('strips pre-release suffixes', () => {
    expect(compareSemver('1.2.3-rc.1', '1.2.3')).toBe(0);
  });
});

describe('isValidSemver', () => {
  test('accepts standard versions and pre-release suffixes', () => {
    expect(isValidSemver('1.2.3')).toBe(true);
    expect(isValidSemver('0.1')).toBe(true);
    expect(isValidSemver('1.2.3-rc.1')).toBe(true);
  });
  test('rejects anything that is not a clean version string', () => {
    expect(isValidSemver('nightly')).toBe(false);
    expect(isValidSemver('1.2.3; rm -rf /')).toBe(false);
    expect(isValidSemver('')).toBe(false);
  });
});

describe('buildUpdateNotice', () => {
  test('returns null when up to date', () => {
    expect(buildUpdateNotice('1.2.3', '1.2.3')).toBeNull();
    expect(buildUpdateNotice('2.0.0', '1.9.9')).toBeNull();
  });
  test('returns a notice when newer', () => {
    const notice = buildUpdateNotice('0.1.0', '0.2.0');
    expect(notice).toContain('0.1.0');
    expect(notice).toContain('0.2.0');
  });
  test('returns null when the latest version is not valid semver', () => {
    expect(buildUpdateNotice('1.0.0', 'nightly')).toBeNull();
    expect(buildUpdateNotice('1.0.0', '9.9.9 && curl evil')).toBeNull();
  });
});

describe('checkForUpdates', () => {
  test('opt-out via THESIGNUP_NO_UPDATE_CHECK skips the network', async () => {
    let fetchCalls = 0;
    const fetchImpl = asFetch(async () => {
      fetchCalls++;
      return new Response(null, { status: 200 });
    });
    const res = await checkForUpdates({
      currentVersion: '0.1.0',
      env: { THESIGNUP_NO_UPDATE_CHECK: '1' } as NodeJS.ProcessEnv,
      fetchImpl,
      cachePath,
    });
    expect(fetchCalls).toBe(0);
    expect(res.skipped).toBe('opt-out');
  });

  test('cache hit skips the network within TTL', async () => {
    writeFileSync(cachePath, JSON.stringify({ checked_at: Date.now(), latest_version: '0.2.0' }));
    let fetchCalls = 0;
    const fetchImpl = asFetch(async () => {
      fetchCalls++;
      return new Response(null, { status: 200 });
    });
    const res = await checkForUpdates({
      currentVersion: '0.1.0',
      cachePath,
      fetchImpl,
    });
    expect(fetchCalls).toBe(0);
    expect(res.latest).toBe('0.2.0');
    expect(res.upToDate).toBe(false);
    expect(res.skipped).toBe('cache-hit');
  });

  test('stale cache triggers a refresh', async () => {
    writeFileSync(
      cachePath,
      JSON.stringify({
        checked_at: Date.now() - CACHE_TTL_MS - 1000,
        latest_version: '0.1.0',
      }),
    );
    let calledUrl = '';
    const fetchImpl = asFetch(async (url) => {
      calledUrl = String(url);
      return new Response(JSON.stringify({ tag_name: 'v0.3.0' }), { status: 200 });
    });
    const res = await checkForUpdates({
      currentVersion: '0.1.0',
      cachePath,
      fetchImpl,
      releasesUrl: 'https://example.test/releases/latest',
    });
    expect(calledUrl).toBe('https://example.test/releases/latest');
    expect(res.latest).toBe('0.3.0');
    expect(res.upToDate).toBe(false);
    const written = JSON.parse(readFileSync(cachePath, 'utf8'));
    expect(written.latest_version).toBe('0.3.0');
  });

  test('refresh failure falls back to cached value', async () => {
    writeFileSync(
      cachePath,
      JSON.stringify({
        checked_at: Date.now() - CACHE_TTL_MS - 1000,
        latest_version: '0.2.0',
      }),
    );
    const fetchImpl = asFetch(async () => {
      throw new Error('network down');
    });
    const res = await checkForUpdates({
      currentVersion: '0.1.0',
      cachePath,
      fetchImpl,
    });
    expect(res.latest).toBe('0.2.0');
    expect(res.skipped).toBe('refresh-failed');
  });

  test('forceRefresh bypasses the cache', async () => {
    writeFileSync(cachePath, JSON.stringify({ checked_at: Date.now(), latest_version: '0.1.0' }));
    let fetchCalls = 0;
    const fetchImpl = asFetch(async () => {
      fetchCalls++;
      return new Response(JSON.stringify({ tag_name: 'v0.5.0' }), { status: 200 });
    });
    const res = await checkForUpdates({
      currentVersion: '0.1.0',
      cachePath,
      fetchImpl,
      forceRefresh: true,
    });
    expect(fetchCalls).toBe(1);
    expect(res.latest).toBe('0.5.0');
  });

  test('GitHub tag prefix "v" is stripped', async () => {
    const fetchImpl = asFetch(
      async () => new Response(JSON.stringify({ tag_name: 'v1.2.3' }), { status: 200 }),
    );
    const res = await checkForUpdates({ currentVersion: '1.0.0', cachePath, fetchImpl });
    expect(res.latest).toBe('1.2.3');
    expect(existsSync(cachePath)).toBe(true);
  });

  test('a non-semver GitHub tag is ignored rather than trusted', async () => {
    const fetchImpl = asFetch(
      async () => new Response(JSON.stringify({ tag_name: 'nightly-build' }), { status: 200 }),
    );
    const res = await checkForUpdates({ currentVersion: '1.0.0', cachePath, fetchImpl });
    expect(res.latest).toBeNull();
    expect(res.skipped).toBe('refresh-failed');
    expect(existsSync(cachePath)).toBe(false);
  });
});
