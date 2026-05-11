import type { SignupAnalytics } from '../api/types.ts';
import { emit, makeOutput } from '../util/output.ts';
import {
  apiJson,
  buildClient,
  failWithError,
  type ClientDeps,
  type CommonOptions,
} from './util/api.ts';
import { formatAnalytics } from './util/format.ts';

export interface AnalyticsOptions extends CommonOptions {
  signup: string;
}

export async function runAnalytics(opts: AnalyticsOptions, deps: ClientDeps = {}): Promise<number> {
  const ctx = makeOutput({ json: opts.json });
  try {
    const { client } = buildClient(opts, deps);
    const data = await apiJson<SignupAnalytics>(
      client,
      `/v1/signups/${encodeURIComponent(opts.signup)}/analytics`,
    );
    emit(ctx, { ok: true, analytics: data }, formatAnalytics(data));
    return 0;
  } catch (err) {
    return failWithError(ctx, err);
  }
}
