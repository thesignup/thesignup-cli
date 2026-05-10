import { randomUUID } from 'node:crypto';

export type DeviceState =
  | { kind: 'pending'; pollsRemaining?: number; slowDownPolls?: number }
  | { kind: 'approved' }
  | { kind: 'denied' }
  | { kind: 'expired' };

export interface MockOAuthServerOptions {
  deviceAuthorizationOverride?: () => { status: number; body: unknown };
  tokenOverride?: () => { status: number; body: unknown };
}

export interface MockOAuthServer {
  url: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  approve(deviceCode: string): void;
  deny(deviceCode: string): void;
  expire(deviceCode: string): void;
  approveAfterPolls(deviceCode: string, polls: number): void;
  slowDownNext(deviceCode: string, count: number): void;
  tokenPolls(deviceCode: string): number;
  lastDeviceAuthorizationBody(): URLSearchParams;
  lastTokenBody(): URLSearchParams;
}

export function createMockOAuthServer(opts: MockOAuthServerOptions = {}): MockOAuthServer {
  const states = new Map<string, DeviceState>();
  const pollCounts = new Map<string, number>();
  let lastDeviceAuthorizationBody = new URLSearchParams();
  let lastTokenBody = new URLSearchParams();

  let server: ReturnType<typeof Bun.serve> | null = null;

  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === 'POST' && path === '/oauth/device_authorization') {
      const text = await req.text();
      lastDeviceAuthorizationBody = new URLSearchParams(text);
      if (opts.deviceAuthorizationOverride) {
        const o = opts.deviceAuthorizationOverride();
        return jsonResponse(o.status, o.body);
      }
      const deviceCode = randomUUID();
      const userCode = randomUserCode();
      states.set(deviceCode, { kind: 'pending' });
      pollCounts.set(deviceCode, 0);
      const body = {
        device_code: deviceCode,
        user_code: userCode,
        verification_uri: `${url.origin}/device`,
        verification_uri_complete: `${url.origin}/device?user_code=${userCode}`,
        expires_in: 900,
        interval: 1,
      };
      return jsonResponse(200, body);
    }

    if (req.method === 'POST' && path === '/oauth/token') {
      const text = await req.text();
      lastTokenBody = new URLSearchParams(text);
      if (opts.tokenOverride) {
        const o = opts.tokenOverride();
        return jsonResponse(o.status, o.body);
      }
      const grant = lastTokenBody.get('grant_type');
      if (grant === 'refresh_token') {
        return jsonResponse(200, {
          access_token: `at_${randomUUID()}`,
          refresh_token: `rt_${randomUUID()}`,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'signups:read',
        });
      }
      if (grant === 'urn:ietf:params:oauth:grant-type:device_code') {
        const code = lastTokenBody.get('device_code') ?? '';
        const state = states.get(code);
        pollCounts.set(code, (pollCounts.get(code) ?? 0) + 1);
        if (!state) return jsonResponse(400, { error: 'invalid_grant' });
        if (state.kind === 'denied') return jsonResponse(400, { error: 'access_denied' });
        if (state.kind === 'expired') return jsonResponse(400, { error: 'expired_token' });
        if (state.kind === 'pending') {
          if (state.slowDownPolls && state.slowDownPolls > 0) {
            states.set(code, { ...state, slowDownPolls: state.slowDownPolls - 1 });
            return jsonResponse(400, { error: 'slow_down' });
          }
          if (state.pollsRemaining !== undefined && state.pollsRemaining > 0) {
            states.set(code, { ...state, pollsRemaining: state.pollsRemaining - 1 });
            return jsonResponse(400, { error: 'authorization_pending' });
          }
          if (state.pollsRemaining === 0) {
            states.set(code, { kind: 'approved' });
          } else {
            return jsonResponse(400, { error: 'authorization_pending' });
          }
        }
        if (states.get(code)?.kind === 'approved') {
          return jsonResponse(200, {
            access_token: `at_${randomUUID()}`,
            refresh_token: `rt_${randomUUID()}`,
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'signups:read signups:write',
          });
        }
        return jsonResponse(400, { error: 'authorization_pending' });
      }
      return jsonResponse(400, { error: 'unsupported_grant_type' });
    }

    if (req.method === 'POST' && path === '/oauth/revoke') {
      return new Response(null, { status: 200 });
    }

    if (req.method === 'GET' && path === '/v1/me') {
      return jsonResponse(200, { id: 'usr_test', name: 'Test User', email: 'test@example.com' });
    }

    return new Response('not found', { status: 404 });
  };

  return {
    get url() {
      if (!server) throw new Error('server not started');
      return `http://127.0.0.1:${server.port}`;
    },
    async start() {
      server = Bun.serve({ port: 0, fetch: handler });
    },
    async stop() {
      await server?.stop(true);
      server = null;
    },
    approve(deviceCode) {
      states.set(deviceCode, { kind: 'approved' });
    },
    deny(deviceCode) {
      states.set(deviceCode, { kind: 'denied' });
    },
    expire(deviceCode) {
      states.set(deviceCode, { kind: 'expired' });
    },
    approveAfterPolls(deviceCode, polls) {
      states.set(deviceCode, { kind: 'pending', pollsRemaining: polls });
    },
    slowDownNext(deviceCode, count) {
      const cur = states.get(deviceCode);
      if (!cur || cur.kind !== 'pending') {
        states.set(deviceCode, { kind: 'pending', slowDownPolls: count });
      } else {
        states.set(deviceCode, { ...cur, slowDownPolls: count });
      }
    },
    tokenPolls(deviceCode) {
      return pollCounts.get(deviceCode) ?? 0;
    },
    lastDeviceAuthorizationBody() {
      return lastDeviceAuthorizationBody;
    },
    lastTokenBody() {
      return lastTokenBody;
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ23456789';

function randomUserCode(): string {
  const pick = () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  let s = '';
  for (let i = 0; i < 4; i++) s += pick();
  s += '-';
  for (let i = 0; i < 4; i++) s += pick();
  return s;
}
