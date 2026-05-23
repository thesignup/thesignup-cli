import type { ListParticipantsResponse } from '../../api/types.ts';
import { emit, makeOutput } from '../../util/output.ts';
import {
  apiJson,
  buildClient,
  failWithError,
  type ClientDeps,
  type CommonOptions,
} from '../util/api.ts';
import { formatParticipantRow, participantHeader } from '../util/format.ts';
import { runRegister } from '../register.ts';

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

// `participants add` and `register` are the same server operation (POST
// /v1/signups/:id/participants with the link-share submission contract).
// `add` is just a sibling alias under the participants group, so route
// it through runRegister to keep one source of truth for the contract.
export interface ParticipantsAddOptions extends CommonOptions {
  signup: string;
  name: string;
  email: string;
  phone?: string;
  slot?: string;
  item?: string[];
  note?: string;
}

export async function runParticipantsAdd(
  opts: ParticipantsAddOptions,
  deps: ClientDeps = {},
): Promise<number> {
  return runRegister(
    {
      ...opts,
      target: opts.signup,
    },
    deps,
  );
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
