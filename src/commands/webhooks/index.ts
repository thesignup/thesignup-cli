import type { Webhook, ListWebhooksResponse } from '../../api/types.ts';
import { emit, makeOutput } from '../../util/output.ts';
import {
  apiJson,
  buildClient,
  failWithError,
  type ClientDeps,
  type CommonOptions,
} from '../util/api.ts';
import { formatWebhookDetail, formatWebhookRow, webhookHeader } from '../util/format.ts';

export async function runWebhooksList(
  opts: CommonOptions = {},
  deps: ClientDeps = {},
): Promise<number> {
  const ctx = makeOutput({ json: opts.json });
  try {
    const { client } = buildClient(opts, deps);
    const data = await apiJson<ListWebhooksResponse>(client, '/v1/webhooks');
    if (data.webhooks.length === 0) {
      emit(ctx, { ok: true, webhooks: [] }, ['No webhooks configured.']);
      return 0;
    }
    emit(ctx, { ok: true, webhooks: data.webhooks }, [
      webhookHeader(),
      ...data.webhooks.map(formatWebhookRow),
    ]);
    return 0;
  } catch (err) {
    return failWithError(ctx, err);
  }
}

export interface WebhooksCreateOptions extends CommonOptions {
  url: string;
  events: string;
  description?: string;
}

export async function runWebhooksCreate(
  opts: WebhooksCreateOptions,
  deps: ClientDeps = {},
): Promise<number> {
  const ctx = makeOutput({ json: opts.json });
  try {
    if (!opts.url) throw new Error('--url is required');
    if (!opts.events) throw new Error('--events is required (comma-separated)');
    const events = opts.events
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (events.length === 0) throw new Error('--events must list at least one event pattern');

    const { client } = buildClient(opts, deps);
    const body: Record<string, unknown> = { url: opts.url, events };
    if (opts.description !== undefined) body.description = opts.description;
    const created = await apiJson<Webhook>(client, '/v1/webhooks', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    emit(ctx, { ok: true, webhook: created }, [
      `Created webhook ${created.id}.`,
      ...formatWebhookDetail(created),
    ]);
    return 0;
  } catch (err) {
    return failWithError(ctx, err);
  }
}
