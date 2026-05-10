import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { runLogin, DEFAULT_CLIENT_ID } from './login.ts';
import { runStatus } from './status.ts';
import { runLogout } from './logout.ts';
import { createCredentialStore } from '../../storage/credentials.ts';
import { createMockOAuthServer } from '../../../test/mock-oauth-server.ts';

describe('runLogin (integration with mock server)', () => {
  test('happy path: stores credentials and identity for the profile', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'thesignup-cli-login-test-'));
    try {
      const server = createMockOAuthServer({});
      await server.start();

      // approve every device authorization automatically
      const origDeviceAuth = server.lastDeviceAuthorizationBody;
      void origDeviceAuth;

      const fileEncryptionKey = randomBytes(32);
      const storeFactory = () =>
        createCredentialStore({
          keyringFactory: () => null,
          filePath: join(workDir, 'credentials'),
          fileEncryptionKey,
        });

      // approve device codes as soon as they are issued
      const issuedCodes: string[] = [];
      const origFetch = fetch;
      const wrappedFetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const res = await origFetch(url, init);
        const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (u.endsWith('/oauth/device_authorization') && res.ok) {
          const cloned = res.clone();
          const body = (await cloned.json()) as { device_code: string };
          issuedCodes.push(body.device_code);
          server.approve(body.device_code);
        }
        return res;
      }) as typeof fetch;

      const code = await runLogin(
        { profile: 'work', apiBase: server.url, json: true, noBrowser: true },
        { fetchImpl: wrappedFetch, storeFactory, openUrlImpl: async () => {} },
      );
      expect(code).toBe(0);
      expect(issuedCodes.length).toBe(1);

      const store = storeFactory();
      const stored = await store.load('work');
      expect(stored).not.toBeNull();
      expect(stored?.identity?.email).toBe('test@example.com');
      expect(stored?.refreshToken).toBeTruthy();
      expect(stored?.apiBase).toBe(server.url);

      await server.stop();
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  test('returns non-zero on access_denied', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'thesignup-cli-login-test-'));
    try {
      const server = createMockOAuthServer({});
      await server.start();

      const fileEncryptionKey = randomBytes(32);
      const storeFactory = () =>
        createCredentialStore({
          keyringFactory: () => null,
          filePath: join(workDir, 'credentials'),
          fileEncryptionKey,
        });

      const origFetch = fetch;
      const wrappedFetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const res = await origFetch(url, init);
        const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (u.endsWith('/oauth/device_authorization') && res.ok) {
          const cloned = res.clone();
          const body = (await cloned.json()) as { device_code: string };
          server.deny(body.device_code);
        }
        return res;
      }) as typeof fetch;

      const code = await runLogin(
        { profile: 'default', apiBase: server.url, json: true, noBrowser: true },
        { fetchImpl: wrappedFetch, storeFactory, openUrlImpl: async () => {} },
      );
      expect(code).toBe(1);

      const store = storeFactory();
      expect(await store.load('default')).toBeNull();

      await server.stop();
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  test('login + status + logout cycle for a profile', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'thesignup-cli-cycle-test-'));
    try {
      const server = createMockOAuthServer({});
      await server.start();
      const fileEncryptionKey = randomBytes(32);
      const storeFactory = () =>
        createCredentialStore({
          keyringFactory: () => null,
          filePath: join(workDir, 'credentials'),
          fileEncryptionKey,
        });

      const origFetch = fetch;
      const wrappedFetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const res = await origFetch(url, init);
        const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (u.endsWith('/oauth/device_authorization') && res.ok) {
          const cloned = res.clone();
          const body = (await cloned.json()) as { device_code: string };
          server.approve(body.device_code);
        }
        return res;
      }) as typeof fetch;

      const loginCode = await runLogin(
        { profile: 'cycle', apiBase: server.url, json: true, noBrowser: true },
        { fetchImpl: wrappedFetch, storeFactory, openUrlImpl: async () => {} },
      );
      expect(loginCode).toBe(0);

      const statusCode = await runStatus(
        { profile: 'cycle', apiBase: server.url, json: true },
        { storeFactory },
      );
      expect(statusCode).toBe(0);

      const logoutCode = await runLogout(
        { profile: 'cycle', apiBase: server.url, json: true, clientId: DEFAULT_CLIENT_ID },
        { storeFactory, fetchImpl: wrappedFetch },
      );
      expect(logoutCode).toBe(0);

      const finalStatusCode = await runStatus(
        { profile: 'cycle', apiBase: server.url, json: true },
        { storeFactory },
      );
      expect(finalStatusCode).toBe(1);

      await server.stop();
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
