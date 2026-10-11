import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createCredentialStore, type StoredCredentials } from '../src/storage/credentials.ts';
import { createMockOAuthServer, type MockOAuthServer } from './mock-oauth-server.ts';

export interface CommandFixture {
  server: MockOAuthServer;
  storeFactory: () => ReturnType<typeof createCredentialStore>;
  profile: string;
  workDir: string;
  cleanup: () => Promise<void>;
}

export async function captureOutput(run: () => Promise<number>): Promise<{
  code: number;
  stdout: string;
}> {
  let stdout = '';
  const original = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    return { code: await run(), stdout };
  } finally {
    process.stdout.write = original;
  }
}

export async function createCommandFixture(
  opts: { profile?: string } = {},
): Promise<CommandFixture> {
  const profile = opts.profile ?? 'test';
  const workDir = mkdtempSync(join(tmpdir(), 'thesignup-cli-cmd-test-'));
  const fileEncryptionKey = randomBytes(32);
  const storeFactory = () =>
    createCredentialStore({
      keyringFactory: () => null,
      filePath: join(workDir, 'credentials'),
      fileEncryptionKey,
    });

  const server = createMockOAuthServer({});
  await server.start();

  const stored: StoredCredentials = {
    accessToken: 'at_test_token',
    refreshToken: 'rt_test_token',
    expiresAt: Date.now() + 3600_000,
    scope: 'signups:read signups:write participants:read participants:write',
    apiBase: server.url,
    obtainedAt: Date.now(),
  };
  await storeFactory().save(profile, stored);

  return {
    server,
    storeFactory,
    profile,
    workDir,
    async cleanup() {
      await server.stop();
      rmSync(workDir, { recursive: true, force: true });
    },
  };
}
