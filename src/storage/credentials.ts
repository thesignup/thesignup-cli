import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { hostname, platform, userInfo } from 'node:os';
import { spawnSync } from 'node:child_process';
import { credentialsFile } from '../config/paths.ts';

const SERVICE = 'thesignup-cli';
const KEYRING_KEY_PREFIX = 'profile:';
const FILE_VERSION = 1;
const FILE_MAGIC = Buffer.from('TSU1', 'utf8');

export interface StoredCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope?: string;
  apiBase: string;
  identity?: { id?: string; name?: string; email?: string } | undefined;
  obtainedAt: number;
}

export type StorageBackend = 'keychain' | 'file';

export interface CredentialStore {
  backend(): Promise<StorageBackend>;
  load(profile: string): Promise<StoredCredentials | null>;
  save(profile: string, creds: StoredCredentials): Promise<void>;
  remove(profile: string): Promise<void>;
  listProfiles(): Promise<string[]>;
}

interface KeyringLike {
  setPassword(password: string): void;
  getPassword(): string | null;
  deletePassword(): boolean;
}

export interface KeyringConstructor {
  new (service: string, account: string): KeyringLike;
}

export interface CredentialStoreOptions {
  keyringFactory?: () => KeyringConstructor | null;
  filePath?: string;
  fileIndexPath?: string;
  fileEncryptionKey?: Buffer;
}

export function createCredentialStore(options: CredentialStoreOptions = {}): CredentialStore {
  const keyringFactory = options.keyringFactory ?? defaultKeyringFactory;
  const filePath = options.filePath ?? credentialsFile();
  const fileIndexPath = options.fileIndexPath ?? `${filePath}.profiles`;
  const Keyring = keyringFactory();

  let detected: StorageBackend | null = null;
  const detect = async (): Promise<StorageBackend> => {
    if (detected) return detected;
    if (Keyring) {
      try {
        const probe = new Keyring(SERVICE, '__probe__');
        probe.setPassword('probe');
        probe.deletePassword();
        detected = 'keychain';
        return detected;
      } catch {
        // fall through to file
      }
    }
    detected = 'file';
    return detected;
  };

  const fileStore = createFileStore(filePath, fileIndexPath, options.fileEncryptionKey);

  return {
    async backend() {
      return detect();
    },
    async load(profile) {
      const backend = await detect();
      if (backend === 'keychain' && Keyring) {
        const k = new Keyring(SERVICE, KEYRING_KEY_PREFIX + profile);
        const raw = k.getPassword();
        if (!raw) return null;
        try {
          return JSON.parse(raw) as StoredCredentials;
        } catch {
          return null;
        }
      }
      return fileStore.load(profile);
    },
    async save(profile, creds) {
      const backend = await detect();
      if (backend === 'keychain' && Keyring) {
        const k = new Keyring(SERVICE, KEYRING_KEY_PREFIX + profile);
        k.setPassword(JSON.stringify(creds));
        await fileStore.indexAdd(profile);
        return;
      }
      await fileStore.save(profile, creds);
    },
    async remove(profile) {
      const backend = await detect();
      if (backend === 'keychain' && Keyring) {
        try {
          const k = new Keyring(SERVICE, KEYRING_KEY_PREFIX + profile);
          k.deletePassword();
        } catch {
          // ignore — entry may not exist
        }
        await fileStore.indexRemove(profile);
        return;
      }
      await fileStore.remove(profile);
    },
    async listProfiles() {
      return fileStore.listIndex();
    },
  };
}

function defaultKeyringFactory(): KeyringConstructor | null {
  try {
    const mod = (globalThis as unknown as { require?: NodeRequire }).require?.(
      '@napi-rs/keyring',
    ) as { Entry?: KeyringConstructor } | undefined;
    return mod?.Entry ?? null;
  } catch {
    return null;
  }
}

interface FileStoreShape {
  load(profile: string): Promise<StoredCredentials | null>;
  save(profile: string, creds: StoredCredentials): Promise<void>;
  remove(profile: string): Promise<void>;
  indexAdd(profile: string): Promise<void>;
  indexRemove(profile: string): Promise<void>;
  listIndex(): Promise<string[]>;
}

function createFileStore(filePath: string, indexPath: string, forcedKey?: Buffer): FileStoreShape {
  const getKey = (): Buffer => forcedKey ?? deriveFileKey();

  const readAll = async (): Promise<Record<string, StoredCredentials>> => {
    let raw: Buffer;
    try {
      raw = await readFile(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
    if (raw.length === 0) return {};
    return decryptFile(raw, getKey());
  };

  const writeAll = async (data: Record<string, StoredCredentials>): Promise<void> => {
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
    const blob = encryptFile(data, getKey());
    await writeFile(filePath, blob, { mode: 0o600 });
    try {
      await chmod(filePath, 0o600);
    } catch {
      // best effort on platforms without POSIX modes
    }
  };

  const readIndex = async (): Promise<string[]> => {
    try {
      const raw = await readFile(indexPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === 'string');
      return [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      return [];
    }
  };

  const writeIndex = async (profiles: string[]): Promise<void> => {
    await mkdir(dirname(indexPath), { recursive: true, mode: 0o700 });
    await writeFile(indexPath, JSON.stringify([...new Set(profiles)].sort(), null, 2), {
      mode: 0o600,
    });
  };

  return {
    async load(profile) {
      const data = await readAll();
      return data[profile] ?? null;
    },
    async save(profile, creds) {
      const data = await readAll();
      data[profile] = creds;
      await writeAll(data);
      const idx = await readIndex();
      if (!idx.includes(profile)) await writeIndex([...idx, profile]);
    },
    async remove(profile) {
      const data = await readAll();
      if (profile in data) {
        delete data[profile];
        await writeAll(data);
      }
      const idx = await readIndex();
      const next = idx.filter((p) => p !== profile);
      if (next.length !== idx.length) await writeIndex(next);
    },
    async indexAdd(profile) {
      const idx = await readIndex();
      if (!idx.includes(profile)) await writeIndex([...idx, profile]);
    },
    async indexRemove(profile) {
      const idx = await readIndex();
      const next = idx.filter((p) => p !== profile);
      if (next.length !== idx.length) await writeIndex(next);
    },
    async listIndex() {
      return readIndex();
    },
  };
}

interface FileEnvelope {
  v: typeof FILE_VERSION;
  profiles: Record<string, StoredCredentials>;
}

export function encryptFile(data: Record<string, StoredCredentials>, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const envelope: FileEnvelope = { v: FILE_VERSION, profiles: data };
  const plaintext = Buffer.from(JSON.stringify(envelope), 'utf8');
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([FILE_MAGIC, Buffer.from([FILE_VERSION]), iv, tag, enc]);
}

export function decryptFile(buf: Buffer, key: Buffer): Record<string, StoredCredentials> {
  if (buf.length < FILE_MAGIC.length + 1 + 12 + 16) {
    throw new Error('credentials file is corrupted (too short)');
  }
  if (!buf.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC)) {
    throw new Error('credentials file is corrupted (bad magic)');
  }
  const version = buf[FILE_MAGIC.length];
  if (version !== FILE_VERSION) {
    throw new Error(`credentials file version ${version} not supported`);
  }
  let off = FILE_MAGIC.length + 1;
  const iv = buf.subarray(off, off + 12);
  off += 12;
  const tag = buf.subarray(off, off + 16);
  off += 16;
  const enc = buf.subarray(off);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(enc), decipher.final()]);
  const parsed = JSON.parse(plaintext.toString('utf8')) as FileEnvelope;
  return parsed.profiles ?? {};
}

let cachedKey: Buffer | null = null;

export function deriveFileKey(): Buffer {
  if (cachedKey) return cachedKey;
  const seed = `${getMachineIdSync()}|${userInfo().username}|${SERVICE}`;
  cachedKey = createHash('sha256').update(seed).digest();
  return cachedKey;
}

function getMachineIdSync(): string {
  const plat = platform();
  try {
    if (plat === 'darwin') {
      const out = spawnSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
        encoding: 'utf8',
        timeout: 1500,
      });
      const match = out.stdout?.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (match?.[1]) return match[1];
    } else if (plat === 'linux') {
      const id = readMachineIdFile();
      if (id) return id;
    } else if (plat === 'win32') {
      const out = spawnSync(
        'reg',
        ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'],
        { encoding: 'utf8', timeout: 1500 },
      );
      const match = out.stdout?.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/);
      if (match?.[1]) return match[1];
    }
  } catch {
    // fall through
  }
  return `${hostname()}|${userInfo().username}`;
}

function readMachineIdFile(): string | null {
  for (const path of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      const id = readFileSync(path, 'utf8').trim();
      if (id) return id;
    } catch {
      // try next
    }
  }
  return null;
}
