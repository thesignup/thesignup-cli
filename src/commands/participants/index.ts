import type { ListParticipantsResponse } from '../../api/types.ts';
import { emit, makeOutput, type OutputContext } from '../../util/output.ts';
import {
  apiJson,
  buildClient,
  failWithError,
  type ClientDeps,
  type CommonOptions,
} from '../util/api.ts';
import { formatParticipantRow, participantHeader } from '../util/format.ts';
import { runRegister } from '../register.ts';
import { runWatch, type WatchEnvelope } from '../util/watch.ts';
import type { AuthenticatedClient } from '../../http/client.ts';

// Participant-list watch fires on everything that can change a row's
// presence or slot/item attribution. signup.* events that affect the
// roster (publish toggles the form open; cancellation closes signups)
// are intentionally excluded — those are covered by signups list.
const PARTICIPANTS_WATCH_EVENTS: readonly string[] = [
  'participant.registered',
  'participant.canceled',
  'participant.no_show',
  'slot.filled',
  'slot.opened',
  'item.claimed',
  'item.released',
];

export interface ParticipantsListOptions extends CommonOptions {
  signup: string;
  watch?: boolean;
  signal?: AbortSignal;
}

export interface ParticipantsListDeps extends ClientDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onWatchEvent?: (envelope: WatchEnvelope) => void;
}

export async function runParticipantsList(
  opts: ParticipantsListOptions,
  deps: ParticipantsListDeps = {},
): Promise<number> {
  const ctx = makeOutput({ json: opts.json });
  try {
    const { client } = buildClient(opts, deps);
    const render = (): Promise<void> => renderParticipantsList(client, ctx, opts.signup);
    if (!opts.watch) {
      await render();
      return 0;
    }
    // Best-effort same-signup filter on the client. The envelope.data
    // shape varies per event type (participant.* events include the
    // participant row; slot.*/item.* events include the slot/item).
    // Across all of them, the related signup id surfaces as a common
    // field we can read off — when the field is missing we keep the
    // event so we don't silently drop relevant updates.
    const isMatchingSignup = (envelope: WatchEnvelope): boolean => {
      const data = envelope.data ?? {};
      const candidates = [
        (data as { eventId?: unknown }).eventId,
        (data as { signupId?: unknown }).signupId,
        (data as { event_id?: unknown }).event_id,
        (data as { signup_id?: unknown }).signup_id,
      ];
      const sid = candidates.find((c) => typeof c === 'string') as string | undefined;
      return sid === undefined ? true : sid === opts.signup;
    };
    return await runWatch({
      client,
      ctx,
      events: PARTICIPANTS_WATCH_EVENTS,
      render,
      shouldHandle: isMatchingSignup,
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
      ...(deps.onWatchEvent ? { onEvent: deps.onWatchEvent } : {}),
    });
  } catch (err) {
    return failWithError(ctx, err);
  }
}

async function renderParticipantsList(
  client: AuthenticatedClient,
  ctx: OutputContext,
  signup: string,
): Promise<void> {
  const data = await apiJson<ListParticipantsResponse>(
    client,
    `/v1/signups/${encodeURIComponent(signup)}/participants`,
  );
  if (data.participants.length === 0) {
    emit(ctx, { ok: true, participants: [] }, ['No participants.']);
    return;
  }
  emit(ctx, { ok: true, participants: data.participants }, [
    participantHeader(),
    ...data.participants.map(formatParticipantRow),
  ]);
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
