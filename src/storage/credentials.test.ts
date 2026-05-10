import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  createCredentialStore,
  decryptFile,
  encryptFile,
  type StoredCredentials,
  type KeyringConstructor,
} from './credentials.ts';

let workDir: string;
const KEY = randomBytes(32);

function fixture(profile: string): StoredCredentials {
  return {
    accessToken: `access-${profile}`,
    refreshToken: `refresh-${profile}`,
    expiresAt: Date.now() + 3600_000,
    scope: 'signups:read',
    apiBase: 'https://thesignup.app',
    obtainedAt: Date.now(),
  };
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'thesignup-cli-test-'));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('file-backend credential store', () => {
  test('roundtrips a single profile', async () => {
    const store = createCredentialStore({
      keyringFactory: () => null,
      filePath: join(workDir, 'credentials'),
      fileEncryptionKey: KEY,
    });
    const creds = fixture('default');
    await store.save('default', creds);
    const loaded = await store.load('default');
    expect(loaded).toEqual(creds);
    expect(await store.backend()).toBe('file');
  });

  test('isolates profiles', async () => {
    const store = createCredentialStore({
      keyringFactory: () => null,
      filePath: join(workDir, 'credentials'),
      fileEncryptionKey: KEY,
    });
    const a = fixture('work');
    const b = fixture('personal');
    await store.save('work', a);
    await store.save('personal', b);
    expect(await store.load('work')).toEqual(a);
    expect(await store.load('personal')).toEqual(b);
    expect(await store.listProfiles()).toEqual(['personal', 'work']);

    await store.remove('work');
    expect(await store.load('work')).toBeNull();
    expect(await store.load('personal')).toEqual(b);
    expect(await store.listProfiles()).toEqual(['personal']);
  });

  test('returns null for unknown profile', async () => {
    const store = createCredentialStore({
      keyringFactory: () => null,
      filePath: join(workDir, 'credentials'),
      fileEncryptionKey: KEY,
    });
    expect(await store.load('nope')).toBeNull();
  });

  test('encrypt/decrypt round-trip works', () => {
    const data = { default: fixture('default'), work: fixture('work') };
    const enc = encryptFile(data, KEY);
    const dec = decryptFile(enc, KEY);
    expect(dec).toEqual(data);
  });

  test('decrypt with wrong key throws', () => {
    const data = { default: fixture('default') };
    const enc = encryptFile(data, KEY);
    expect(() => decryptFile(enc, randomBytes(32))).toThrow();
  });
});

describe('keychain backend (mocked)', () => {
  test('uses keychain when available and falls back to file index for profile listing', async () => {
    const store = createCredentialStore({
      keyringFactory: () => makeFakeKeyringClass(),
      filePath: join(workDir, 'credentials'),
      fileEncryptionKey: KEY,
    });
    expect(await store.backend()).toBe('keychain');

    const a = fixture('work');
    await store.save('work', a);
    const loaded = await store.load('work');
    expect(loaded).toEqual(a);
    expect(await store.listProfiles()).toEqual(['work']);

    await store.remove('work');
    expect(await store.load('work')).toBeNull();
    expect(await store.listProfiles()).toEqual([]);
  });

  test('falls back to file when keyring constructor throws', async () => {
    const Bad: KeyringConstructor = class {
      constructor() {
        throw new Error('no keyring on this machine');
      }
      setPassword(): void {}
      getPassword(): string | null {
        return null;
      }
      deletePassword(): boolean {
        return false;
      }
    };
    const store = createCredentialStore({
      keyringFactory: () => Bad,
      filePath: join(workDir, 'credentials'),
      fileEncryptionKey: KEY,
    });
    expect(await store.backend()).toBe('file');
    const creds = fixture('default');
    await store.save('default', creds);
    expect(await store.load('default')).toEqual(creds);
  });

  test('keychain isolates profiles by account name', async () => {
    const store = createCredentialStore({
      keyringFactory: () => makeFakeKeyringClass(),
      filePath: join(workDir, 'credentials'),
      fileEncryptionKey: KEY,
    });
    const a = fixture('work');
    const b = fixture('personal');
    await store.save('work', a);
    await store.save('personal', b);
    expect((await store.load('work'))?.accessToken).toBe('access-work');
    expect((await store.load('personal'))?.accessToken).toBe('access-personal');
  });
});

function makeFakeKeyringClass(): KeyringConstructor {
  const memory = new Map<string, string>();
  return class FakeKeyring {
    private readonly key: string;
    constructor(service: string, account: string) {
      this.key = `${service}::${account}`;
    }
    setPassword(password: string): void {
      memory.set(this.key, password);
    }
    getPassword(): string | null {
      return memory.get(this.key) ?? null;
    }
    deletePassword(): boolean {
      return memory.delete(this.key);
    }
  } satisfies KeyringConstructor;
}
