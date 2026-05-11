import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as yamlParse } from 'yaml';
import {
  runSignupsList,
  runSignupsCreate,
  runSignupsView,
  runSignupsCancel,
  runSignupsPublish,
  runSignupsDuplicate,
  runSignupsEdit,
} from './index.ts';
import type { Signup } from '../../api/types.ts';
import { createCommandFixture, type CommandFixture } from '../../../test/command-fixture.ts';

function makeSignup(over: Partial<Signup> = {}): Signup {
  return {
    id: 'su_one',
    slug: 'sat-potluck',
    status: 'draft',
    title: 'Saturday potluck',
    description: 'Bring a dish',
    starts_at: '2026-06-01T18:00:00Z',
    location: 'Park pavilion',
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    ...over,
  };
}

let fx: CommandFixture;

beforeEach(async () => {
  fx = await createCommandFixture();
});
afterEach(async () => {
  await fx.cleanup();
});

describe('signups list', () => {
  test('returns seeded signups with status filter', async () => {
    fx.server.seedSignup(makeSignup({ id: 'su_a', slug: 'a', status: 'active' }));
    fx.server.seedSignup(makeSignup({ id: 'su_b', slug: 'b', status: 'draft' }));
    fx.server.seedSignup(makeSignup({ id: 'su_c', slug: 'c', status: 'active' }));

    const code = await runSignupsList(
      { profile: fx.profile, apiBase: fx.server.url, json: true, status: 'active' },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);

    const last = fx.server.recordedRequests().at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v1/signups');
    expect(last?.query.status).toBe('active');
    expect(last?.authorization).toBe('Bearer at_test_token');
  });

  test('respects --limit', async () => {
    for (let i = 0; i < 5; i++) {
      fx.server.seedSignup(makeSignup({ id: `su_${i}`, slug: `s-${i}` }));
    }
    const code = await runSignupsList(
      { profile: fx.profile, apiBase: fx.server.url, json: true, limit: 2 },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
    expect(fx.server.recordedRequests().at(-1)?.query.limit).toBe('2');
  });

  test('reports HTTP errors as exit 1', async () => {
    await fx.cleanup();
    fx = await createCommandFixture();
    // Force 401 by clobbering the stored token
    const store = fx.storeFactory();
    const existing = await store.load(fx.profile);
    if (!existing) throw new Error('expected existing credentials');
    await store.save(fx.profile, {
      ...existing,
      accessToken: '',
      refreshToken: undefined,
      expiresAt: Date.now() + 60_000,
    });
    const code = await runSignupsList(
      { profile: fx.profile, apiBase: fx.server.url, json: true },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(1);
  });
});

describe('signups create', () => {
  test('--from-description posts description body', async () => {
    const code = await runSignupsCreate(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        fromDescription: 'Sunday brunch',
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
    const last = fx.server.recordedRequests().at(-1);
    expect(last?.method).toBe('POST');
    expect(last?.path).toBe('/v1/signups');
    expect((last?.body as { description: string }).description).toBe('Sunday brunch');
  });

  test('--file reads YAML and posts the parsed body', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'thesignup-cli-create-test-'));
    try {
      const file = join(dir, 'signup.yaml');
      writeFileSync(
        file,
        'title: From file\nstatus: draft\ndescription: Yaml-defined event\nlocation: Hall\n',
      );
      const code = await runSignupsCreate(
        { profile: fx.profile, apiBase: fx.server.url, json: true, file },
        { storeFactory: fx.storeFactory },
      );
      expect(code).toBe(0);
      const last = fx.server.recordedRequests().at(-1);
      expect(last?.method).toBe('POST');
      expect((last?.body as { title: string }).title).toBe('From file');
      expect((last?.body as { location: string }).location).toBe('Hall');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects when neither --from-description nor --file is supplied', async () => {
    const code = await runSignupsCreate(
      { profile: fx.profile, apiBase: fx.server.url, json: true },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(1);
  });

  test('rejects when both --from-description and --file are supplied', async () => {
    const code = await runSignupsCreate(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        fromDescription: 'X',
        file: '/tmp/does-not-matter',
      },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(1);
  });
});

describe('signups view', () => {
  test('GETs by ref and returns 0', async () => {
    fx.server.seedSignup(makeSignup({ id: 'su_v', slug: 'view-me' }));
    const code = await runSignupsView(
      { profile: fx.profile, apiBase: fx.server.url, json: true, ref: 'view-me' },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
    expect(fx.server.recordedRequests().at(-1)?.path).toBe('/v1/signups/view-me');
  });

  test('404 → exit 1', async () => {
    const code = await runSignupsView(
      { profile: fx.profile, apiBase: fx.server.url, json: true, ref: 'nope' },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(1);
  });
});

describe('signups cancel / publish / duplicate', () => {
  test('cancel POSTs and reports canceled status', async () => {
    fx.server.seedSignup(makeSignup({ id: 'su_x', slug: 'x', status: 'active' }));
    const code = await runSignupsCancel(
      { profile: fx.profile, apiBase: fx.server.url, json: true, ref: 'x' },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
    expect(fx.server.getSignup('x')?.status).toBe('canceled');
  });

  test('publish POSTs and reports active', async () => {
    fx.server.seedSignup(makeSignup({ id: 'su_y', slug: 'y', status: 'draft' }));
    const code = await runSignupsPublish(
      { profile: fx.profile, apiBase: fx.server.url, json: true, ref: 'y' },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
    expect(fx.server.getSignup('y')?.status).toBe('active');
  });

  test('duplicate creates a new draft', async () => {
    fx.server.seedSignup(makeSignup({ id: 'su_z', slug: 'z', status: 'active' }));
    const code = await runSignupsDuplicate(
      { profile: fx.profile, apiBase: fx.server.url, json: true, ref: 'z' },
      { storeFactory: fx.storeFactory },
    );
    expect(code).toBe(0);
    expect(fx.server.listSignups().some((s) => s.slug === 'z-copy')).toBe(true);
  });
});

describe('signups edit', () => {
  test('opens editor, parses YAML edits, PATCHes the signup', async () => {
    fx.server.seedSignup(makeSignup({ id: 'su_e', slug: 'edit-me', title: 'Old title' }));

    const spawnEditor = async (cmd: string, args: string[]): Promise<number> => {
      // Read what edit wrote, mutate, write back.
      const { readFileSync, writeFileSync } = await import('node:fs');
      void cmd;
      const file = args[0];
      if (!file) throw new Error('expected file arg');
      const original = readFileSync(file, 'utf8');
      const updated = yamlParse(original) as Record<string, unknown>;
      updated.title = 'New title';
      writeFileSync(file, `${yamlStringifySafe(updated)}`);
      return 0;
    };

    const code = await runSignupsEdit(
      { profile: fx.profile, apiBase: fx.server.url, json: true, ref: 'edit-me', editor: 'noop' },
      { storeFactory: fx.storeFactory, spawnEditor },
    );
    expect(code).toBe(0);
    expect(fx.server.getSignup('edit-me')?.title).toBe('New title');
  });

  test('no-change abort returns 0 without PATCH', async () => {
    fx.server.seedSignup(makeSignup({ id: 'su_nc', slug: 'no-change', title: 'Same' }));
    const spawnEditor = async (): Promise<number> => 0;
    const code = await runSignupsEdit(
      { profile: fx.profile, apiBase: fx.server.url, json: true, ref: 'no-change', editor: 'noop' },
      { storeFactory: fx.storeFactory, spawnEditor },
    );
    expect(code).toBe(0);
    expect(fx.server.recordedRequests().some((r) => r.method === 'PATCH')).toBe(false);
  });

  test('missing editor in env errors clearly', async () => {
    fx.server.seedSignup(makeSignup({ id: 'su_n', slug: 'noeditor' }));
    const code = await runSignupsEdit(
      {
        profile: fx.profile,
        apiBase: fx.server.url,
        json: true,
        ref: 'noeditor',
      },
      {
        storeFactory: fx.storeFactory,
        env: {} as NodeJS.ProcessEnv,
      },
    );
    expect(code).toBe(1);
  });

  test('editor non-zero exit aborts without PATCH', async () => {
    fx.server.seedSignup(makeSignup({ id: 'su_q', slug: 'quit', title: 'Original' }));
    const spawnEditor = async (): Promise<number> => 130;
    const code = await runSignupsEdit(
      { profile: fx.profile, apiBase: fx.server.url, json: true, ref: 'quit', editor: 'noop' },
      { storeFactory: fx.storeFactory, spawnEditor },
    );
    expect(code).toBe(1);
    expect(fx.server.recordedRequests().some((r) => r.method === 'PATCH')).toBe(false);
  });
});

function yamlStringifySafe(obj: unknown): string {
  // local import to avoid hoisting concerns
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const yaml = require('yaml') as { stringify: (v: unknown) => string };
  return yaml.stringify(obj);
}
