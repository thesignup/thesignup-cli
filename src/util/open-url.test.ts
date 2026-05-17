import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { spawn } from 'node:child_process';
import { openUrl, sanitizeOpenableUrl } from './open-url.ts';

// A spawn() stand-in that records each invocation and immediately reports a
// successful 'spawn' so openUrl resolves without touching a real process.
function recordingSpawn() {
  const calls: { command: string; args: string[] }[] = [];
  const impl = ((command: string, args: string[]) => {
    calls.push({ command, args });
    const child = new EventEmitter() as EventEmitter & { unref(): void };
    child.unref = () => {};
    queueMicrotask(() => child.emit('spawn'));
    return child;
  }) as unknown as typeof spawn;
  return { calls, impl };
}

describe('sanitizeOpenableUrl', () => {
  test('returns the normalized href for http/https URLs', () => {
    expect(sanitizeOpenableUrl('https://thesignup.app/device?user_code=ABCD')).toBe(
      'https://thesignup.app/device?user_code=ABCD',
    );
    expect(sanitizeOpenableUrl('http://localhost:3000/x')).toBe('http://localhost:3000/x');
  });

  test('rejects non-web schemes', () => {
    expect(() => sanitizeOpenableUrl('file:///etc/passwd')).toThrow(/non-web/);
    expect(() => sanitizeOpenableUrl('javascript:alert(1)')).toThrow(/non-web/);
  });

  test('rejects malformed input that is not a URL at all', () => {
    expect(() => sanitizeOpenableUrl('/Applications/Calculator.app')).toThrow(/malformed/);
    expect(() => sanitizeOpenableUrl('not a url')).toThrow(/malformed/);
  });
});

describe('openUrl', () => {
  test('uses `open` on macOS with the URL as a single argument', async () => {
    const { calls, impl } = recordingSpawn();
    await openUrl('https://thesignup.app/device', {
      spawnImpl: impl,
      platformImpl: () => 'darwin',
    });
    expect(calls[0]?.command).toBe('open');
    expect(calls[0]?.args).toEqual(['https://thesignup.app/device']);
  });

  test('uses rundll32 (never cmd) on Windows to avoid shell re-parsing', async () => {
    const { calls, impl } = recordingSpawn();
    await openUrl('https://thesignup.app/device', {
      spawnImpl: impl,
      platformImpl: () => 'win32',
    });
    expect(calls[0]?.command).toBe('rundll32');
    expect(calls[0]?.args).toEqual(['url.dll,FileProtocolHandler', 'https://thesignup.app/device']);
  });

  test('uses xdg-open on Linux', async () => {
    const { calls, impl } = recordingSpawn();
    await openUrl('https://thesignup.app/device', {
      spawnImpl: impl,
      platformImpl: () => 'linux',
    });
    expect(calls[0]?.command).toBe('xdg-open');
  });

  test('refuses a non-web URL before spawning anything', async () => {
    const { calls, impl } = recordingSpawn();
    await expect(
      openUrl('file:///etc/passwd', { spawnImpl: impl, platformImpl: () => 'darwin' }),
    ).rejects.toThrow(/non-web/);
    expect(calls.length).toBe(0);
  });
});
