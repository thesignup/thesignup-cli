import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { updateCacheFile } from '../config/paths.ts';

export const DEFAULT_RELEASES_URL =
  'https://api.github.com/repos/thesignup/thesignup-cli/releases/latest';
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const REFRESH_TIMEOUT_MS = 1500;

export interface UpdateCacheEntry {
  checked_at: number;
  latest_version: string | null;
}

export interface UpdateCheckOptions {
  currentVersion: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  cachePath?: string;
  env?: NodeJS.ProcessEnv;
  releasesUrl?: string;
  timeoutMs?: number;
  forceRefresh?: boolean;
}

export interface UpdateCheckResult {
  current: string;
  latest: string | null;
  upToDate: boolean;
  skipped?: 'opt-out' | 'cache-hit' | 'refresh-failed';
}

export async function checkForUpdates(opts: UpdateCheckOptions): Promise<UpdateCheckResult> {
  const env = opts.env ?? process.env;
  if (env.THESIGNUP_NO_UPDATE_CHECK === '1') {
    return { current: opts.currentVersion, latest: null, upToDate: true, skipped: 'opt-out' };
  }
  const now = opts.now ?? Date.now;
  const cachePath = opts.cachePath ?? updateCacheFile();
  const cached = await readCache(cachePath);

  if (!opts.forceRefresh && cached && now() - cached.checked_at < CACHE_TTL_MS) {
    return result(opts.currentVersion, cached.latest_version, 'cache-hit');
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const releasesUrl = opts.releasesUrl ?? env.THESIGNUP_RELEASES_URL ?? DEFAULT_RELEASES_URL;
  const timeoutMs = opts.timeoutMs ?? REFRESH_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let latest: string | null = null;
  try {
    const res = await fetchImpl(releasesUrl, {
      headers: { accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (res.ok) {
      const body = (await res.json()) as { tag_name?: string };
      if (body.tag_name) latest = stripVersionPrefix(body.tag_name);
    }
  } catch {
    // network failure / abort — fall through, keep cached if any
  } finally {
    clearTimeout(timer);
  }

  if (latest === null) {
    if (cached) return result(opts.currentVersion, cached.latest_version, 'refresh-failed');
    return {
      current: opts.currentVersion,
      latest: null,
      upToDate: true,
      skipped: 'refresh-failed',
    };
  }

  await writeCache(cachePath, { checked_at: now(), latest_version: latest });
  return result(opts.currentVersion, latest);
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function buildUpdateNotice(current: string, latest: string): string | null {
  if (compareSemver(latest, current) <= 0) return null;
  return `\nA new version of thesignup is available: ${current} → ${latest}\nRun: bun install -g thesignup@${latest}    (or set THESIGNUP_NO_UPDATE_CHECK=1 to silence)\n`;
}

function result(
  current: string,
  latest: string | null,
  skipped?: UpdateCheckResult['skipped'],
): UpdateCheckResult {
  const upToDate = latest === null ? true : compareSemver(latest, current) <= 0;
  return { current, latest, upToDate, ...(skipped ? { skipped } : {}) };
}

function stripVersionPrefix(tag: string): string {
  return tag.startsWith('v') ? tag.slice(1) : tag;
}

function parseSemver(v: string): number[] {
  return v
    .split('-')[0]!
    .split('.')
    .map((s) => Number.parseInt(s, 10))
    .map((n) => (Number.isFinite(n) ? n : 0));
}

async function readCache(path: string): Promise<UpdateCacheEntry | null> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as UpdateCacheEntry;
    if (
      typeof parsed.checked_at === 'number' &&
      (typeof parsed.latest_version === 'string' || parsed.latest_version === null)
    ) {
      return parsed;
    }
  } catch {
    // missing or malformed → ignore
  }
  return null;
}

async function writeCache(path: string, entry: UpdateCacheEntry): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, JSON.stringify(entry), { mode: 0o600 });
  } catch {
    // best effort — don't fail the run just because cache write failed
  }
}
