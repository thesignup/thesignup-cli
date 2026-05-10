import { describe, expect, test } from 'bun:test';
import {
  DEVICE_CODE_GRANT,
  OAuthError,
  pollForToken,
  refreshAccessToken,
  requestDeviceAuthorization,
} from './device-flow.ts';
import { createMockOAuthServer, type MockOAuthServer } from '../../test/mock-oauth-server.ts';

const CLIENT_ID = 'cli_thesignup_test';

async function withServer<T>(
  cfg: Parameters<typeof createMockOAuthServer>[0],
  fn: (s: MockOAuthServer) => Promise<T>,
): Promise<T> {
  const s = createMockOAuthServer(cfg);
  await s.start();
  try {
    return await fn(s);
  } finally {
    await s.stop();
  }
}

describe('requestDeviceAuthorization', () => {
  test('returns the device authorization payload', async () => {
    await withServer({}, async (s) => {
      const res = await requestDeviceAuthorization({
        apiBase: s.url,
        clientId: CLIENT_ID,
        scope: 'signups:read',
      });
      expect(res.device_code).toBeTruthy();
      expect(res.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(res.verification_uri).toContain(s.url);
      expect(res.verification_uri_complete).toContain(res.user_code);
      expect(res.interval).toBeGreaterThan(0);
      expect(res.expires_in).toBeGreaterThan(0);
    });
  });

  test('forwards client_id and scope to the server', async () => {
    await withServer({}, async (s) => {
      await requestDeviceAuthorization({
        apiBase: s.url,
        clientId: CLIENT_ID,
        scope: 'signups:read signups:write',
      });
      const last = s.lastDeviceAuthorizationBody();
      expect(last.get('client_id')).toBe(CLIENT_ID);
      expect(last.get('scope')).toBe('signups:read signups:write');
    });
  });

  test('throws OAuthError on 4xx with error body', async () => {
    await withServer(
      { deviceAuthorizationOverride: () => ({ status: 400, body: { error: 'invalid_client' } }) },
      async (s) => {
        await expect(
          requestDeviceAuthorization({ apiBase: s.url, clientId: CLIENT_ID }),
        ).rejects.toBeInstanceOf(OAuthError);
      },
    );
  });
});

describe('pollForToken', () => {
  test('happy path: returns tokens after approval', async () => {
    await withServer({}, async (s) => {
      const auth = await requestDeviceAuthorization({ apiBase: s.url, clientId: CLIENT_ID });
      // approve immediately
      s.approve(auth.device_code);
      const tokens = await pollForToken({
        apiBase: s.url,
        clientId: CLIENT_ID,
        deviceCode: auth.device_code,
        interval: 1,
        expiresIn: auth.expires_in,
        sleep: async () => {},
      });
      expect(tokens.access_token).toBeTruthy();
      expect(tokens.refresh_token).toBeTruthy();
      expect(tokens.token_type).toBe('Bearer');
      expect(tokens.expires_in).toBeGreaterThan(0);

      const lastBody = s.lastTokenBody();
      expect(lastBody.get('grant_type')).toBe(DEVICE_CODE_GRANT);
      expect(lastBody.get('device_code')).toBe(auth.device_code);
      expect(lastBody.get('client_id')).toBe(CLIENT_ID);
    });
  });

  test('keeps polling on authorization_pending then succeeds', async () => {
    await withServer({}, async (s) => {
      const auth = await requestDeviceAuthorization({ apiBase: s.url, clientId: CLIENT_ID });
      // approve after the 3rd poll attempt
      s.approveAfterPolls(auth.device_code, 3);
      const tokens = await pollForToken({
        apiBase: s.url,
        clientId: CLIENT_ID,
        deviceCode: auth.device_code,
        interval: 1,
        expiresIn: auth.expires_in,
        sleep: async () => {},
      });
      expect(tokens.access_token).toBeTruthy();
      expect(s.tokenPolls(auth.device_code)).toBeGreaterThanOrEqual(4);
    });
  });

  test('bumps interval on slow_down then continues', async () => {
    await withServer({}, async (s) => {
      const auth = await requestDeviceAuthorization({ apiBase: s.url, clientId: CLIENT_ID });
      s.approveAfterPolls(auth.device_code, 3);
      s.slowDownNext(auth.device_code, 2);
      const intervals: number[] = [];
      const tokens = await pollForToken({
        apiBase: s.url,
        clientId: CLIENT_ID,
        deviceCode: auth.device_code,
        interval: 1,
        expiresIn: auth.expires_in,
        sleep: async () => {},
        onTick: ({ interval }) => intervals.push(interval),
      });
      expect(tokens.access_token).toBeTruthy();
      // interval should increase by 5 each slow_down (2 → 1, 6, 11, ...)
      expect(intervals[0]).toBe(1);
      expect(intervals.some((i) => i >= 6)).toBeTrue();
    });
  });

  test('rejects with access_denied on user denial', async () => {
    await withServer({}, async (s) => {
      const auth = await requestDeviceAuthorization({ apiBase: s.url, clientId: CLIENT_ID });
      s.deny(auth.device_code);
      await expect(
        pollForToken({
          apiBase: s.url,
          clientId: CLIENT_ID,
          deviceCode: auth.device_code,
          interval: 1,
          expiresIn: auth.expires_in,
          sleep: async () => {},
        }),
      ).rejects.toMatchObject({ name: 'OAuthError', code: 'access_denied' });
    });
  });

  test('rejects with expired_token when server says expired', async () => {
    await withServer({}, async (s) => {
      const auth = await requestDeviceAuthorization({ apiBase: s.url, clientId: CLIENT_ID });
      s.expire(auth.device_code);
      await expect(
        pollForToken({
          apiBase: s.url,
          clientId: CLIENT_ID,
          deviceCode: auth.device_code,
          interval: 1,
          expiresIn: auth.expires_in,
          sleep: async () => {},
        }),
      ).rejects.toMatchObject({ name: 'OAuthError', code: 'expired_token' });
    });
  });

  test('rejects with expired_token if local deadline elapses', async () => {
    await withServer(
      // server keeps replying authorization_pending
      { tokenOverride: () => ({ status: 400, body: { error: 'authorization_pending' } }) },
      async (s) => {
        let nowMs = 1_000_000;
        await expect(
          pollForToken({
            apiBase: s.url,
            clientId: CLIENT_ID,
            deviceCode: 'never-approved',
            interval: 1,
            expiresIn: 5, // 5 seconds
            sleep: async (ms) => {
              nowMs += ms;
            },
            now: () => nowMs,
          }),
        ).rejects.toMatchObject({ name: 'OAuthError', code: 'expired_token' });
      },
    );
  });
});

describe('refreshAccessToken', () => {
  test('exchanges a refresh_token for a fresh access_token', async () => {
    await withServer({}, async (s) => {
      const tokens = await refreshAccessToken({
        apiBase: s.url,
        clientId: CLIENT_ID,
        refreshToken: 'refresh-abc',
      });
      expect(tokens.access_token).toBeTruthy();
      expect(tokens.token_type).toBe('Bearer');
      const last = s.lastTokenBody();
      expect(last.get('grant_type')).toBe('refresh_token');
      expect(last.get('refresh_token')).toBe('refresh-abc');
      expect(last.get('client_id')).toBe(CLIENT_ID);
    });
  });

  test('throws OAuthError on invalid_grant', async () => {
    await withServer(
      { tokenOverride: () => ({ status: 400, body: { error: 'invalid_grant' } }) },
      async (s) => {
        await expect(
          refreshAccessToken({
            apiBase: s.url,
            clientId: CLIENT_ID,
            refreshToken: 'bad',
          }),
        ).rejects.toMatchObject({ name: 'OAuthError', code: 'invalid_grant' });
      },
    );
  });
});
