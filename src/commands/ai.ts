import { stringify as yamlStringify } from 'yaml';
import type { AiDraftResponse } from '../api/types.ts';
import { emit, makeOutput } from '../util/output.ts';
import {
  apiJson,
  buildClient,
  failWithError,
  type ClientDeps,
  type CommonOptions,
} from './util/api.ts';

export interface AiDraftOptions extends CommonOptions {
  description: string;
}

export async function runAiDraft(opts: AiDraftOptions, deps: ClientDeps = {}): Promise<number> {
  const ctx = makeOutput({ json: opts.json });
  try {
    if (!opts.description) throw new Error('description is required');
    const { client } = buildClient(opts, deps);
    const res = await apiJson<AiDraftResponse>(client, '/v1/signups/from-description', {
      method: 'POST',
      body: JSON.stringify({ description: opts.description }),
    });
    emit(ctx, { ok: true, draft: res.draft }, [
      '# Drafted signup (review, then `thesignup signups create --file`)',
      '',
      yamlStringify(res.draft),
    ]);
    return 0;
  } catch (err) {
    return failWithError(ctx, err);
  }
}
