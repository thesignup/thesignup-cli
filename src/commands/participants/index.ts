import type { Participant, ListParticipantsResponse } from '../../api/types.ts';
import { emit, makeOutput } from '../../util/output.ts';
import {
  apiJson,
  buildClient,
  failWithError,
  type ClientDeps,
  type CommonOptions,
} from '../util/api.ts';
import { formatParticipantRow, participantHeader } from '../util/format.ts';

export interface ParticipantsListOptions extends CommonOptions {
  signup: string;
}

export async function runParticipantsList(
  opts: ParticipantsListOptions,
  deps: ClientDeps = {},
): Promise<number> {
  const ctx = makeOutput({ json: opts.json });
  try {
    const { client } = buildClient(opts, deps);
    const data = await apiJson<ListParticipantsResponse>(
      client,
      `/v1/signups/${encodeURIComponent(opts.signup)}/participants`,
    );
    if (data.participants.length === 0) {
      emit(ctx, { ok: true, participants: [] }, ['No participants.']);
      return 0;
    }
    emit(ctx, { ok: true, participants: data.participants }, [
      participantHeader(),
      ...data.participants.map(formatParticipantRow),
    ]);
    return 0;
  } catch (err) {
    return failWithError(ctx, err);
  }
}

export interface ParticipantsAddOptions extends CommonOptions {
  signup: string;
  name: string;
  email?: string;
  slot?: number | string;
  items?: string;
}

export async function runParticipantsAdd(
  opts: ParticipantsAddOptions,
  deps: ClientDeps = {},
): Promise<number> {
  const ctx = makeOutput({ json: opts.json });
  try {
    if (!opts.name) throw new Error('--name is required');
    const { client } = buildClient(opts, deps);
    const body: Record<string, unknown> = { name: opts.name };
    if (opts.email !== undefined) body.email = opts.email;
    if (opts.slot !== undefined) body.slot = opts.slot;
    if (opts.items !== undefined) body.items = opts.items;
    const participant = await apiJson<Participant>(
      client,
      `/v1/signups/${encodeURIComponent(opts.signup)}/participants`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
    emit(ctx, { ok: true, participant }, [
      `Added participant ${participant.id} (${participant.name}).`,
    ]);
    return 0;
  } catch (err) {
    return failWithError(ctx, err);
  }
}

export interface ParticipantsRemoveOptions extends CommonOptions {
  signup: string;
  participantId: string;
}

export async function runParticipantsRemove(
  opts: ParticipantsRemoveOptions,
  deps: ClientDeps = {},
): Promise<number> {
  const ctx = makeOutput({ json: opts.json });
  try {
    const { client } = buildClient(opts, deps);
    await apiJson<void>(
      client,
      `/v1/signups/${encodeURIComponent(opts.signup)}/participants/${encodeURIComponent(opts.participantId)}`,
      { method: 'DELETE' },
    );
    emit(ctx, { ok: true, removed: opts.participantId }, [
      `Removed participant ${opts.participantId}.`,
    ]);
    return 0;
  } catch (err) {
    return failWithError(ctx, err);
  }
}
