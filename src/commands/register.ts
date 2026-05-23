import type { ItemDto, ListItemsResponse, ListSlotsResponse, TimeSlotDto } from '../api/types.ts';
import { emit, makeOutput } from '../util/output.ts';
import {
  apiJson,
  buildClient,
  failWithError,
  type ClientDeps,
  type CommonOptions,
} from './util/api.ts';

export interface RegisterOptions extends CommonOptions {
  target: string;
  name: string;
  email: string;
  phone?: string;
  slot?: string;
  item?: string[];
  note?: string;
}

interface Selection {
  type: 'slot' | 'item';
  id: string;
  quantity: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function runRegister(opts: RegisterOptions, deps: ClientDeps = {}): Promise<number> {
  const ctx = makeOutput({ json: opts.json });
  try {
    if (!UUID_RE.test(opts.target)) {
      throw new Error(
        `target must be a signup UUID — got "${opts.target}". Slug lookup is not implemented yet (see /v1/signups list).`,
      );
    }
    if (!opts.name?.trim()) throw new Error('--name is required');
    if (!opts.email?.trim()) throw new Error('--email is required');

    const { client } = buildClient(opts, deps);
    const selections: Selection[] = [];

    if (opts.slot !== undefined) {
      const { data: slots } = await apiJson<ListSlotsResponse>(
        client,
        `/v1/signups/${encodeURIComponent(opts.target)}/slots`,
      );
      const resolved = resolveSlot(opts.slot, slots);
      selections.push({ type: 'slot', id: resolved.id, quantity: 1 });
    }

    if (opts.item && opts.item.length > 0) {
      const { data: items } = await apiJson<ListItemsResponse>(
        client,
        `/v1/signups/${encodeURIComponent(opts.target)}/items`,
      );
      for (const spec of opts.item) {
        const { ref, quantity } = parseItemSpec(spec);
        const resolved = resolveItem(ref, items);
        selections.push({ type: 'item', id: resolved.id, quantity });
      }
    }

    const body: Record<string, unknown> = {
      name: opts.name,
      email: opts.email,
      selections,
    };
    if (opts.phone) body.phone = opts.phone;
    if (opts.note) body.eventCustomFieldResponse = opts.note;

    const result = await apiJson<Record<string, unknown>>(
      client,
      `/v1/signups/${encodeURIComponent(opts.target)}/participants`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
    emit(ctx, { ok: true, result }, [
      `Registered ${opts.name} <${opts.email}> for signup ${opts.target}.`,
    ]);
    return 0;
  } catch (err) {
    return failWithError(ctx, err);
  }
}

function parseItemSpec(spec: string): { ref: string; quantity: number } {
  const idx = spec.lastIndexOf(':');
  if (idx < 0) {
    throw new Error(`--item must be "<name-or-uuid>:<quantity>", got "${spec}"`);
  }
  const ref = spec.slice(0, idx).trim();
  const qtyRaw = spec.slice(idx + 1).trim();
  if (!ref) throw new Error(`--item is missing a name or uuid: "${spec}"`);
  const quantity = Number(qtyRaw);
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error(`--item quantity must be a positive integer, got "${qtyRaw}" in "${spec}"`);
  }
  return { ref, quantity };
}

function resolveSlot(ref: string, slots: TimeSlotDto[]): TimeSlotDto {
  if (UUID_RE.test(ref)) {
    const byId = slots.find((s) => s.id === ref);
    if (!byId) throw new Error(`--slot ${ref}: no slot with that id on this signup`);
    return byId;
  }
  const indexMatch = ref.match(/^#(\d+)$/);
  if (indexMatch) {
    const ordinal = Number(indexMatch[1]);
    const slot = slots[ordinal - 1];
    if (!slot) {
      throw new Error(`--slot ${ref}: signup has ${slots.length} slot(s), no #${ordinal}`);
    }
    return slot;
  }
  const lower = ref.toLowerCase();
  const matches = slots.filter((s) => (s.title ?? '').toLowerCase() === lower);
  if (matches.length === 0) {
    throw new Error(`--slot "${ref}": no slot with that title (case-insensitive exact match)`);
  }
  if (matches.length > 1) {
    throw new Error(
      `--slot "${ref}": ambiguous — ${matches.length} slots share that title. Use the UUID or #index.`,
    );
  }
  return matches[0]!;
}

function resolveItem(ref: string, items: ItemDto[]): ItemDto {
  if (UUID_RE.test(ref)) {
    const byId = items.find((i) => i.id === ref);
    if (!byId) throw new Error(`--item ${ref}: no item with that id on this signup`);
    return byId;
  }
  const lower = ref.toLowerCase();
  const matches = items.filter((i) => i.name.toLowerCase() === lower);
  if (matches.length === 0) {
    throw new Error(`--item "${ref}": no item with that name (case-insensitive exact match)`);
  }
  if (matches.length > 1) {
    throw new Error(
      `--item "${ref}": ambiguous — ${matches.length} items share that name. Use the UUID.`,
    );
  }
  return matches[0]!;
}

// Exposed for tests.
export const __internals = { parseItemSpec, resolveSlot, resolveItem, UUID_RE };
