/**
 * WHICH TRACKS NEED A MODEL — THE ONE PLACE THAT KNOWS (TEN-149).
 *
 * The start gate used to be per-RUN: one `connected` boolean in
 * apps/web/app/exam/page.tsx, and a Start pill that said "Connect a model to
 * start" until it was true. Two of the four tracks need no model at all, so a
 * candidate with none was refused the whole instrument — including the two
 * tracks that would have run. Measured on staging, 2026-09-05.
 *
 * The requirement is DATA here, not a condition in a page. A track knows
 * whether it needs a model; the exam page derives the gate from the tracks
 * actually in the run and renders what it is told. Nothing else in the UI may
 * keep a second copy of this fact — read it from here, or from the registry
 * that re-exports it.
 *
 * PURE: no storage, no fetch, no clock, no plugin imports. `score()` purity is
 * untouched because no scorer reads any of this — a model-free sitting scores
 * exactly the tracks it sat, and the composite is withheld rather than
 * renormalised over a subset (TEN-92).
 */
import { TRACK_META } from "@ailx/report";
import { TRACK_ORDER, type TrackId } from "@ailx/session";

/**
 * Does the track's runner call a model to do its work?
 *
 * T1 vibe-codes against an OpenAI-compatible endpoint and T4 generates
 * images and video; both take `modelFetch` from the host. T2 is a swipe deck
 * over dealt media and T3's assistant is a scripted, seeded transcript —
 * neither makes a model call, and neither is degraded by the absence of one.
 * `apps/web/test/modelGate.test.ts` pins this table against the runners that
 * actually read `modelFetch`, so a new model call cannot arrive here unnoticed.
 */
export const TRACK_NEEDS_MODEL: Readonly<Record<TrackId, boolean>> = {
  t1: true,
  t2: false,
  t3: false,
  t4: true,
};

/** True when this track cannot run without a connected model endpoint. */
export function needsModel(trackId: TrackId): boolean {
  return TRACK_NEEDS_MODEL[trackId];
}

/** Tracks that never need a model, in run order. */
export const MODEL_FREE_TRACKS: readonly TrackId[] = TRACK_ORDER.filter((t) => !needsModel(t));

/** Tracks that do, in run order. */
export const MODEL_TRACKS: readonly TrackId[] = TRACK_ORDER.filter((t) => needsModel(t));

/** "T1" · "T1 and T4" — the same list style the run hub uses. */
function codes(ids: readonly TrackId[]): string {
  const list = ids.map((t) => TRACK_META[t].code);
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/**
 * WHAT A LOCKED TRACK SAYS.
 *
 * Three clauses, in this order: what is missing, why this track needs it, and
 * the ONE action that changes it — including that the action works mid-run,
 * because a candidate who thinks connecting means starting over will not do
 * it. The vocabulary is ConnectPanel's ("Bring a real model", "T1 (vibe
 * coding) and T4 (image generation) run on your model"), not a second one
 * invented for the same fact.
 *
 * What it never does: sell. No "unlock", no count of tracks held back as
 * pressure, no comparison with a candidate who connected.
 */
export function lockedTrackCopy(trackId: TrackId): string {
  const meta = TRACK_META[trackId];
  const work = trackId === "t1" ? "vibe coding" : "image generation";
  return (
    `${meta.code} runs on your model (${work}), and this browser has none connected. ` +
    "Connect one above and it opens where it stands — mid-run is fine, nothing restarts " +
    "and no clock is lost."
  );
}

/** One track's standing in the gate. */
export interface TrackAvailability {
  readonly trackId: TrackId;
  /** True when the track can be sat right now. */
  readonly available: boolean;
  /** What is missing and the action that fixes it. Undefined when available. */
  readonly reason?: string;
}

/** The gate over the tracks actually in the run. */
export interface RunGate {
  /** Every track in the run, in run order, with its standing. */
  readonly tracks: readonly TrackAvailability[];
  /** Tracks that can be sat now, in run order. */
  readonly available: readonly TrackId[];
  /** Tracks held back for want of a model, in run order. */
  readonly locked: readonly TrackId[];
  /** A run starts when at least ONE track in it can run. */
  readonly canStart: boolean;
  /** The Start pill's label. */
  readonly startLabel: string;
  /**
   * What the candidate is told beside the Start pill before they start, or
   * null when everything in the run is available and there is nothing to say.
   */
  readonly startNote: string | null;
}

/**
 * Derive the gate from the tracks IN THE RUN and the one fact the page holds:
 * whether a model endpoint is connected.
 *
 * `order` is the run's own track order (`SessionState.order`), so a run over a
 * subset of the instrument gates over that subset and nothing else.
 */
export function runGate(input: {
  readonly connected: boolean;
  readonly order?: readonly TrackId[];
}): RunGate {
  const order = input.order ?? TRACK_ORDER;
  const tracks: TrackAvailability[] = order.map((trackId) =>
    input.connected || !needsModel(trackId)
      ? { trackId, available: true }
      : { trackId, available: false, reason: lockedTrackCopy(trackId) },
  );
  const available = tracks.filter((t) => t.available).map((t) => t.trackId);
  const locked = tracks.filter((t) => !t.available).map((t) => t.trackId);
  return {
    tracks,
    available,
    locked,
    canStart: available.length > 0,
    startLabel: available.length === 0 ? "Connect a model to start" : "Start your run",
    startNote:
      locked.length === 0
        ? null
        : available.length === 0
          ? `Every track in this run needs a model. Connect one above and Start opens.`
          : `You can start now and sit ${codes(available)}. ${codes(locked)} ` +
            `${locked.length === 1 ? "runs" : "run"} on your model, so ${locked.length === 1 ? "it stays" : "they stay"} shut until one is connected — ` +
            "which you can do at any point in the run.",
  };
}

/**
 * The next track to sit: the first track in the run that is neither completed
 * nor locked.
 *
 * The session engine's `nextTrack` returns the first track that is not
 * completed, which on a model-free sitting is a track that cannot be sat. The
 * run would hang on it. This is the same question asked of the gate.
 */
export function nextAvailableTrack(
  state: { readonly order: readonly TrackId[]; readonly tracks: Readonly<Record<TrackId, { status: string }>> },
  connected: boolean,
): TrackId | undefined {
  return state.order.find(
    (t) => state.tracks[t].status !== "completed" && (connected || !needsModel(t)),
  );
}

/** Tracks the run cannot offer yet, in run order: pending, and needing a model. */
export function lockedPendingTracks(
  state: { readonly order: readonly TrackId[]; readonly tracks: Readonly<Record<TrackId, { status: string }>> },
  connected: boolean,
): TrackId[] {
  if (connected) return [];
  return state.order.filter((t) => state.tracks[t].status !== "completed" && needsModel(t));
}
