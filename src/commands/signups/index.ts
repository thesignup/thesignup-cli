import { readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import type { Signup, ListSignupsResponse, SignupStatus } from '../../api/types.ts';
import { emit, makeOutput, type OutputContext } from '../../util/output.ts';
import {
  apiJson,
  buildClient,
  failWithError,
  type ClientDeps,
  type CommonOptions,
} from '../util/api.ts';
import { formatSignupDetail, formatSignupRow, signupHeader } from '../util/format.ts';
import { runWatch, type WatchEnvelope } from '../util/watch.ts';
import type { AuthenticatedClient } from '../../http/client.ts';

// Webhook event types that affect a signups-list view. Anything
// touching the lifecycle of an event row gets us — registration-side
// events are handled by participants list.
const SIGNUPS_WATCH_EVENTS: readonly string[] = [
  'signup.created',
  'signup.updated',
  'signup.published',
  'signup.canceled',
  'signup.completed',
];

export interface SignupListOptions extends CommonOptions {
  status?: SignupStatus;
  limit?: number;
  watch?: boolean;
  signal?: AbortSignal;
}

export interface SignupListDeps extends ClientDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  // Test seam: notified for each envelope the --watch loop processes.
  onWatchEvent?: (envelope: WatchEnvelope) => void;
}

export async function runSignupsList(
  opts: SignupListOptions = {},
  deps: SignupListDeps = {},
): Promise<number> {
  const ctx = makeOutput({ json: opts.json });
  try {
    const { client } = buildClient(opts, deps);
    const render = (): Promise<void> => renderSignupsList(client, ctx, opts);
    if (!opts.watch) {
      await render();
      return 0;
    }
    return await runWatch({
      client,
      ctx,
      events: SIGNUPS_WATCH_EVENTS,
      render,
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
      ...(deps.onWatchEvent ? { onEvent: deps.onWatchEvent } : {}),
    });
  } catch (err) {
    return failWithError(ctx, err);
  }
}

async function renderSignupsList(
  client: AuthenticatedClient,
  ctx: OutputContext,
  opts: SignupListOptions,
): Promise<void> {
  const qs = new URLSearchParams();
  if (opts.status) qs.set('status', opts.status);
  if (opts.limit !== undefined) qs.set('limit', String(opts.limit));
  const path = qs.toString() ? `/v1/signups?${qs}` : '/v1/signups';
  const data = await apiJson<ListSignupsResponse>(client, path);
  if (data.signups.length === 0) {
    emit(ctx, { ok: true, signups: [] }, ['No signups.']);
    return;
  }
  emit(ctx, { ok: true, signups: data.signups }, [
    signupHeader(),
    ...data.signups.map(formatSignupRow),
  ]);
}

export interface SignupCreateOptions extends CommonOptions {
  fromDescription?: string;
  file?: string;
}

export interface SignupCreateDeps extends ClientDeps {
  readFileImpl?: typeof readFile;
}

export async function runSignupsCreate(
  opts: SignupCreateOptions,
  deps: SignupCreateDeps = {},
): Promise<number> {
  const ctx = makeOutput({ json: opts.json });
  try {
    if (!opts.fromDescription && !opts.file) {
      throw new Error('provide either --from-description or --file');
    }
    if (opts.fromDescription && opts.file) {
      throw new Error('use only one of --from-description or --file');
    }
    const { client } = buildClient(opts, deps);
    let body: unknown;
    if (opts.fromDescription) {
      body = { description: opts.fromDescription };
    } else if (opts.file) {
      const read = deps.readFileImpl ?? readFile;
      const raw = await read(opts.file, 'utf8');
      body = parseSignupFile(opts.file, raw);
    }
    const created = await apiJson<Signup>(client, '/v1/signups', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    emit(ctx, { ok: true, signup: created }, formatSignupDetail(created));
    return 0;
  } catch (err) {
    return failWithError(ctx, err);
  }
}

export interface SignupSingleOptions extends CommonOptions {
  ref: string;
}

export async function runSignupsView(
  opts: SignupSingleOptions,
  deps: ClientDeps = {},
): Promise<number> {
  const ctx = makeOutput({ json: opts.json });
  try {
    const { client } = buildClient(opts, deps);
    const signup = await apiJson<Signup>(client, `/v1/signups/${encodeURIComponent(opts.ref)}`);
    emit(ctx, { ok: true, signup }, formatSignupDetail(signup));
    return 0;
  } catch (err) {
    return failWithError(ctx, err);
  }
}

export async function runSignupsCancel(
  opts: SignupSingleOptions,
  deps: ClientDeps = {},
): Promise<number> {
  return runSignupAction(opts, deps, 'cancel', 'Canceled');
}

export async function runSignupsPublish(
  opts: SignupSingleOptions,
  deps: ClientDeps = {},
): Promise<number> {
  return runSignupAction(opts, deps, 'publish', 'Published');
}

export async function runSignupsDuplicate(
  opts: SignupSingleOptions,
  deps: ClientDeps = {},
): Promise<number> {
  return runSignupAction(opts, deps, 'duplicate', 'Duplicated');
}

async function runSignupAction(
  opts: SignupSingleOptions,
  deps: ClientDeps,
  action: 'cancel' | 'publish' | 'duplicate',
  verb: string,
): Promise<number> {
  const ctx = makeOutput({ json: opts.json });
  try {
    const { client } = buildClient(opts, deps);
    // cancel is a soft-delete on the base resource (server emits
    // signup.canceled). publish/duplicate are separate action routes.
    const { path, method } =
      action === 'cancel'
        ? { path: `/v1/signups/${encodeURIComponent(opts.ref)}`, method: 'DELETE' as const }
        : {
            path: `/v1/signups/${encodeURIComponent(opts.ref)}/${action}`,
            method: 'POST' as const,
          };
    const result = await apiJson<Signup>(client, path, { method });
    emit(ctx, { ok: true, action, signup: result }, [
      `${verb} signup ${result.id} (${result.slug}).`,
      ...formatSignupDetail(result),
    ]);
    return 0;
  } catch (err) {
    return failWithError(ctx, err);
  }
}

export interface SignupEditOptions extends CommonOptions {
  ref: string;
  editor?: string;
}

export interface SignupEditDeps extends ClientDeps {
  spawnEditor?: (command: string, args: string[]) => Promise<number>;
  tmpDir?: () => string;
  writeFileImpl?: typeof writeFile;
  readFileImpl?: typeof readFile;
  unlinkImpl?: typeof unlink;
  env?: NodeJS.ProcessEnv;
}

export async function runSignupsEdit(
  opts: SignupEditOptions,
  deps: SignupEditDeps = {},
): Promise<number> {
  const ctx = makeOutput({ json: opts.json });
  try {
    const { client } = buildClient(opts, deps);
    const current = await apiJson<Signup>(client, `/v1/signups/${encodeURIComponent(opts.ref)}`);
    const env = deps.env ?? process.env;
    const editor = opts.editor ?? env.VISUAL ?? env.EDITOR;
    if (!editor) {
      throw new Error('no editor configured — set $EDITOR or $VISUAL, or pass --editor <cmd>');
    }
    const tmp = deps.tmpDir?.() ?? tmpdir();
    const tmpPath = join(tmp, `thesignup-edit-${randomUUID()}.yaml`);
    const editable = toEditableYaml(current);
    const write = deps.writeFileImpl ?? writeFile;
    const read = deps.readFileImpl ?? readFile;
    const unl = deps.unlinkImpl ?? unlink;
    await write(tmpPath, editable, { mode: 0o600 });
    try {
      const spawnImpl = deps.spawnEditor ?? defaultSpawnEditor;
      const code = await spawnImpl(editor, [tmpPath]);
      if (code !== 0) {
        throw new Error(`editor exited with status ${code} — aborting edit`);
      }
      const updatedRaw = await read(tmpPath, 'utf8');
      if (updatedRaw === editable) {
        emit(ctx, { ok: true, signup: current, changed: false }, ['No changes made; aborting.']);
        return 0;
      }
      const patch = yamlParse(updatedRaw) as Partial<Signup>;
      const result = await apiJson<Signup>(client, `/v1/signups/${encodeURIComponent(opts.ref)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      emit(ctx, { ok: true, signup: result, changed: true }, [
        `Updated signup ${result.id}.`,
        ...formatSignupDetail(result),
      ]);
      return 0;
    } finally {
      await unl(tmpPath).catch(() => {});
    }
  } catch (err) {
    return failWithError(ctx, err);
  }
}

function defaultSpawnEditor(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 0));
    child.on('error', reject);
  });
}

function toEditableYaml(s: Signup): string {
  const { id, slug, created_at, updated_at, url, ...editable } = s;
  void id;
  void slug;
  void created_at;
  void updated_at;
  void url;
  return yamlStringify(editable);
}

function parseSignupFile(path: string, raw: string): unknown {
  if (path.endsWith('.json')) {
    return JSON.parse(raw);
  }
  return yamlParse(raw);
}
