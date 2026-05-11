import type { Participant } from '../api/types.ts';
import { emit, makeOutput } from '../util/output.ts';
import {
  apiJson,
  buildClient,
  failWithError,
  type ClientDeps,
  type CommonOptions,
} from './util/api.ts';
import { extractSignupRef } from './util/slug.ts';

export interface RegisterOptions extends CommonOptions {
  target: string;
  name?: string;
  email?: string;
  slot?: number | string;
  items?: string;
}

export async function runRegister(opts: RegisterOptions, deps: ClientDeps = {}): Promise<number> {
  const ctx = makeOutput({ json: opts.json });
  try {
    const { client } = buildClient(opts, deps);
    const ref = extractSignupRef(opts.target);
    const body: Record<string, unknown> = {};
    if (opts.name !== undefined) body.name = opts.name;
    if (opts.email !== undefined) body.email = opts.email;
    if (opts.slot !== undefined) body.slot = opts.slot;
    if (opts.items !== undefined) body.items = opts.items;
    const participant = await apiJson<Participant>(
      client,
      `/v1/signups/${encodeURIComponent(ref)}/register`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
    emit(ctx, { ok: true, participant }, [
      `Registered as ${participant.name} (${participant.id}).`,
    ]);
    return 0;
  } catch (err) {
    return failWithError(ctx, err);
  }
}
