import { randomUUID } from 'node:crypto';
import type {
  Signup,
  Participant,
  SignupStatus,
  SignupAnalytics,
  Webhook,
  WebhookEvent,
} from '../src/api/types.ts';

export type DeviceState =
  | { kind: 'pending'; pollsRemaining?: number; slowDownPolls?: number }
  | { kind: 'approved' }
  | { kind: 'denied' }
  | { kind: 'expired' };

export interface MockOAuthServerOptions {
  deviceAuthorizationOverride?: () => { status: number; body: unknown };
  tokenOverride?: () => { status: number; body: unknown };
  requireAuth?: boolean;
}

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  authorization?: string;
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
  seedSignup(signup: Signup): void;
  seedParticipant(participant: Participant): void;
  getSignup(idOrSlug: string): Signup | undefined;
  listSignups(): Signup[];
  listParticipants(signupId: string): Participant[];
  setAnalytics(signupId: string, analytics: SignupAnalytics): void;
  setAiDraft(draft: Partial<Signup>): void;
  recordedRequests(): RecordedRequest[];
  seedWebhook(webhook: Webhook): void;
  listWebhooks(): Webhook[];
  getWebhook(id: string): Webhook | undefined;
  publishWebhookEvent(event: WebhookEvent): void;
  closeEventStreams(): void;
}

export function createMockOAuthServer(opts: MockOAuthServerOptions = {}): MockOAuthServer {
  const states = new Map<string, DeviceState>();
  const pollCounts = new Map<string, number>();
  let lastDeviceAuthorizationBody = new URLSearchParams();
  let lastTokenBody = new URLSearchParams();

  const signupsById = new Map<string, Signup>();
  const slugIndex = new Map<string, string>();
  const participants = new Map<string, Participant>();
  const analytics = new Map<string, SignupAnalytics>();
  const recorded: RecordedRequest[] = [];
  let aiDraft: Partial<Signup> | null = null;
  const webhooks = new Map<string, Webhook>();
  const eventStreamControllers = new Set<ReadableStreamDefaultController<Uint8Array>>();

  const requireAuth = opts.requireAuth ?? true;

  const findSignup = (idOrSlug: string): Signup | undefined => {
    const direct = signupsById.get(idOrSlug);
    if (direct) return direct;
    const id = slugIndex.get(idOrSlug);
    return id ? signupsById.get(id) : undefined;
  };

  const indexSignup = (signup: Signup): void => {
    signupsById.set(signup.id, signup);
    slugIndex.set(signup.slug, signup.id);
  };

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

    if (path.startsWith('/v1/')) {
      const authHeader = req.headers.get('authorization') ?? undefined;
      const query: Record<string, string> = {};
      for (const [k, v] of url.searchParams) query[k] = v;
      let parsedBody: unknown = undefined;
      if (req.method !== 'GET' && req.method !== 'DELETE') {
        const text = await req.text();
        if (text) {
          try {
            parsedBody = JSON.parse(text);
          } catch {
            parsedBody = text;
          }
        }
      }
      recorded.push({
        method: req.method,
        path,
        query,
        body: parsedBody,
        ...(authHeader ? { authorization: authHeader } : {}),
      });

      if (requireAuth && !authHeader?.startsWith('Bearer ')) {
        return jsonResponse(401, { error: 'unauthorized' });
      }

      const signupMatch = path.match(
        /^\/v1\/signups\/([^/]+)(?:\/(participants|cancel|publish|duplicate|register|analytics)(?:\/([^/]+))?)?$/,
      );

      if (req.method === 'GET' && path === '/v1/signups') {
        const status = query.status as SignupStatus | undefined;
        const limit = query.limit ? Number(query.limit) : undefined;
        let list = [...signupsById.values()];
        if (status) list = list.filter((s) => s.status === status);
        list.sort((a, b) => b.created_at.localeCompare(a.created_at));
        if (limit !== undefined) list = list.slice(0, limit);
        return jsonResponse(200, { signups: list });
      }

      if (req.method === 'POST' && path === '/v1/signups') {
        const body = (parsedBody ?? {}) as Partial<Signup> & { description?: string };
        const now = new Date().toISOString();
        const id = body.id ?? `su_${randomUUID().slice(0, 8)}`;
        const slug = body.slug ?? `signup-${id.slice(-6)}`;
        const created: Signup = {
          id,
          slug,
          status: body.status ?? 'draft',
          title: body.title ?? body.description ?? 'Untitled',
          created_at: now,
          updated_at: now,
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.starts_at !== undefined ? { starts_at: body.starts_at } : {}),
          ...(body.ends_at !== undefined ? { ends_at: body.ends_at } : {}),
          ...(body.location !== undefined ? { location: body.location } : {}),
          ...(body.slots !== undefined ? { slots: body.slots } : {}),
          ...(body.url !== undefined ? { url: body.url } : {}),
        };
        indexSignup(created);
        return jsonResponse(201, created);
      }

      if (signupMatch) {
        const [, idOrSlug, sub, subId] = signupMatch;
        if (!idOrSlug) return jsonResponse(404, { error: 'not_found' });
        const target = findSignup(idOrSlug);
        if (!target) return jsonResponse(404, { error: 'not_found' });

        if (!sub) {
          if (req.method === 'GET') return jsonResponse(200, target);
          if (req.method === 'PATCH') {
            const patch = (parsedBody ?? {}) as Partial<Signup>;
            const updated: Signup = {
              ...target,
              ...patch,
              id: target.id,
              slug: patch.slug ?? target.slug,
              updated_at: new Date().toISOString(),
            };
            indexSignup(updated);
            return jsonResponse(200, updated);
          }
          if (req.method === 'DELETE') {
            signupsById.delete(target.id);
            slugIndex.delete(target.slug);
            return new Response(null, { status: 204 });
          }
        }

        if (sub === 'cancel' && req.method === 'POST') {
          const updated = { ...target, status: 'canceled' as const, updated_at: new Date().toISOString() };
          indexSignup(updated);
          return jsonResponse(200, updated);
        }
        if (sub === 'publish' && req.method === 'POST') {
          const updated = { ...target, status: 'active' as const, updated_at: new Date().toISOString() };
          indexSignup(updated);
          return jsonResponse(200, updated);
        }
        if (sub === 'duplicate' && req.method === 'POST') {
          const now = new Date().toISOString();
          const id = `su_${randomUUID().slice(0, 8)}`;
          const duped: Signup = {
            ...target,
            id,
            slug: `${target.slug}-copy`,
            status: 'draft',
            created_at: now,
            updated_at: now,
          };
          indexSignup(duped);
          return jsonResponse(201, duped);
        }

        if (sub === 'participants') {
          if (req.method === 'GET') {
            const list = [...participants.values()].filter((p) => p.signup_id === target.id);
            return jsonResponse(200, { participants: list });
          }
          if (req.method === 'POST') {
            const body = (parsedBody ?? {}) as Partial<Participant>;
            const now = new Date().toISOString();
            const p: Participant = {
              id: body.id ?? `pa_${randomUUID().slice(0, 8)}`,
              signup_id: target.id,
              name: body.name ?? 'Anonymous',
              created_at: now,
              ...(body.email !== undefined ? { email: body.email } : {}),
              ...(body.slot !== undefined ? { slot: body.slot } : {}),
              ...(body.items !== undefined ? { items: body.items } : {}),
            };
            participants.set(p.id, p);
            return jsonResponse(201, p);
          }
          if (req.method === 'DELETE' && subId) {
            const existing = participants.get(subId);
            if (!existing || existing.signup_id !== target.id) {
              return jsonResponse(404, { error: 'not_found' });
            }
            participants.delete(subId);
            return new Response(null, { status: 204 });
          }
        }

        if (sub === 'register' && req.method === 'POST') {
          const body = (parsedBody ?? {}) as Partial<Participant>;
          const now = new Date().toISOString();
          const p: Participant = {
            id: `pa_${randomUUID().slice(0, 8)}`,
            signup_id: target.id,
            name: body.name ?? 'Anonymous',
            created_at: now,
            ...(body.email !== undefined ? { email: body.email } : {}),
            ...(body.slot !== undefined ? { slot: body.slot } : {}),
            ...(body.items !== undefined ? { items: body.items } : {}),
          };
          participants.set(p.id, p);
          return jsonResponse(201, p);
        }

        if (sub === 'analytics' && req.method === 'GET') {
          const a = analytics.get(target.id) ?? {
            signup_id: target.id,
            total_participants: [...participants.values()].filter(
              (p) => p.signup_id === target.id,
            ).length,
          };
          return jsonResponse(200, a);
        }
      }

      if (path === '/v1/ai/draft' && req.method === 'POST') {
        const body = (parsedBody ?? {}) as { description?: string };
        const signup = aiDraft ?? {
          title: body.description ?? 'AI-drafted signup',
          status: 'draft' as const,
          description: body.description ?? '',
        };
        return jsonResponse(200, { signup });
      }

      if (path === '/v1/webhooks' && req.method === 'GET') {
        return jsonResponse(200, { webhooks: [...webhooks.values()] });
      }
      if (path === '/v1/webhooks' && req.method === 'POST') {
        const body = (parsedBody ?? {}) as Partial<Webhook>;
        const now = new Date().toISOString();
        const created: Webhook = {
          id: body.id ?? `whk_${randomUUID().slice(0, 8)}`,
          url: body.url ?? '',
          events: body.events ?? [],
          status: body.status ?? 'active',
          created_at: now,
          ...(body.secret !== undefined ? { secret: body.secret } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
        };
        webhooks.set(created.id, created);
        return jsonResponse(201, created);
      }
      if (path === '/v1/webhooks/events' && req.method === 'GET') {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            eventStreamControllers.add(controller);
          },
          cancel() {
            // controller is auto-cleaned by the stream lifecycle
          },
        });
        return new Response(stream, {
          status: 200,
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          },
        });
      }
      const webhookIdMatch = path.match(/^\/v1\/webhooks\/([^/]+)$/);
      if (webhookIdMatch) {
        const [, id] = webhookIdMatch;
        if (!id) return jsonResponse(404, { error: 'not_found' });
        const wh = webhooks.get(id);
        if (!wh) return jsonResponse(404, { error: 'not_found' });
        if (req.method === 'GET') return jsonResponse(200, wh);
        if (req.method === 'DELETE') {
          webhooks.delete(id);
          return new Response(null, { status: 204 });
        }
      }
    }

    return new Response('not found', { status: 404 });
  };

  const encoder = new TextEncoder();
  const broadcastEvent = (event: WebhookEvent): void => {
    const lines = [
      `id: ${event.id}`,
      `event: ${event.type}`,
      `data: ${JSON.stringify(event)}`,
      '',
      '',
    ].join('\n');
    const chunk = encoder.encode(lines);
    for (const controller of eventStreamControllers) {
      try {
        controller.enqueue(chunk);
      } catch {
        eventStreamControllers.delete(controller);
      }
    }
  };
  const closeStreams = (): void => {
    for (const controller of eventStreamControllers) {
      try {
        controller.close();
      } catch {
        // ignore
      }
    }
    eventStreamControllers.clear();
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
    seedSignup(signup) {
      indexSignup(signup);
    },
    seedParticipant(participant) {
      participants.set(participant.id, participant);
    },
    getSignup(idOrSlug) {
      return findSignup(idOrSlug);
    },
    listSignups() {
      return [...signupsById.values()];
    },
    listParticipants(signupId) {
      return [...participants.values()].filter((p) => p.signup_id === signupId);
    },
    setAnalytics(signupId, a) {
      analytics.set(signupId, a);
    },
    setAiDraft(draft) {
      aiDraft = draft;
    },
    recordedRequests() {
      return [...recorded];
    },
    seedWebhook(wh) {
      webhooks.set(wh.id, wh);
    },
    listWebhooks() {
      return [...webhooks.values()];
    },
    getWebhook(id) {
      return webhooks.get(id);
    },
    publishWebhookEvent(event) {
      broadcastEvent(event);
    },
    closeEventStreams() {
      closeStreams();
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
