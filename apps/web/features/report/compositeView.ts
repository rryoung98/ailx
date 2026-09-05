/**
 * ONE COMPOSITE PRESENTATION, TWO PLACES THE NUMBER CAN COME FROM (TEN-92).
 *
 * The report has always drawn the composite from the browser's own event log:
 * `candidateComposite` replays the local scores against the synthetic demo
 * cohort. A HOSTED sitting has no such log entry for a judged track, so the
 * exam service issues the composite instead and returns it on `scores`.
 *
 * Two sources, one card. This module normalises both into the shape the card
 * draws, so there is no second composite presentation to drift from the
 * first, and no chance of a hosted card quietly gaining a number the local
 * one does not have. What the two sources do NOT share is stated in the type:
 * the browser receives no cohort distribution and no showcase-track score
 * from the service, so a hosted card draws no dot strip and no radar. It
 * shows what it was given.
 *
 * Pure: view models in, view model out.
 */
import type {
  AwaitedTrack,
  CompositeSource,
  CompositeWithheldReason,
  CutlineBand,
  IssuedComposite,
  WithheldComposite,
} from "@ailx/contract";
import { DEMO_COHORT_SEED, TRACK_META, type CandidateComposite } from "@ailx/report";
import { SCORED_TRACKS, TRACK_IDS, type TrackId, type TrackRawScores } from "@ailx/session";

/** One bar in the per-track row under the number. */
export interface CompositeBar {
  trackId: TrackId;
  value: number;
}

/** Where the number came from, and what came with it. */
export type CompositeOrigin =
  | {
      kind: "local";
      /** Every dot on the strip: the cohort this browser standardized against. */
      cohortComposites: number[];
      /** All four tracks, so the radar can be drawn. */
      trackRaw: TrackRawScores;
    }
  | {
      kind: "server";
      /** The stored score rows the service derived the number from. */
      sources: CompositeSource[];
    };

export interface CompositeCardView {
  /** Undefined on a log that never recorded one; the card then prints no id. */
  attemptId: string | undefined;
  composite: number;
  /**
   * The band, as a string. `CandidateComposite` types it loosely and the
   * service's union is a subset of the same words; the card only prints it
   * and puts it in a class name, so narrowing here would buy nothing.
   */
  band: string;
  bandCutlines: Record<CutlineBand, number | null>;
  /** Peers plus the candidate: the n the card prints. */
  cohortSize: number;
  cohortSeed: string;
  /** Position within the cohort, used ONLY to detect the floor. Never printed. */
  percentile: number;
  bars: CompositeBar[];
  /**
   * Raw points over the SCORED tracks only, against the instrument total.
   * T4 is a showcase track and carries no points, so adding its bar here
   * would print a total the instrument cannot reach.
   */
  rawTotal: number;
  origin: CompositeOrigin;
  /** The line the copy button puts on a clipboard, with no page around it. */
  shareText: string;
}

/** The shared half of the copied summary, so both sources say it the same way. */
function cohortClause(cohortSize: number): string {
  return `standardized on a synthetic demo cohort of ${cohortSize} generated runs (no percentile, no judged result)`;
}

/** The composite this browser computed from its own log. */
export function localCompositeView(
  attemptId: string | undefined,
  summary: CandidateComposite,
): CompositeCardView {
  return {
    attemptId,
    composite: summary.composite,
    band: summary.band,
    bandCutlines: summary.bandCutlines,
    cohortSize: summary.cohortSize,
    cohortSeed: DEMO_COHORT_SEED,
    percentile: summary.percentile,
    bars: TRACK_IDS.map((t) => ({ trackId: t, value: summary.trackRaw[t] })),
    rawTotal: SCORED_TRACKS.reduce((a, t) => a + summary.trackRaw[t], 0),
    origin: { kind: "local", cohortComposites: summary.cohortComposites, trackRaw: summary.trackRaw },
    // The copied line travels furthest with no page around it, so it carries
    // no percentile-shaped number at all: "P78.9 of 45" reads as a real-world
    // rank the moment it is pasted anywhere.
    shareText:
      `Foray 2026.1 (demo) — composite ${summary.composite.toFixed(1)}/100, ${summary.band}, ` +
      `${cohortClause(summary.cohortSize)}. ` +
      `Tracks ${TRACK_IDS.map((t) => `${t.toUpperCase()} ${summary.trackRaw[t].toFixed(0)}`).join(" · ")}.`,
  };
}

/**
 * The composite the exam service issued.
 *
 * `cohort.size` counts PEERS; the card's n counts the candidate too, exactly
 * as the local card does. The copied line says who issued the number, because
 * a summary that reads as the browser's own would claim a replay that does
 * not exist.
 */
export function serviceCompositeView(
  attemptId: string,
  issued: IssuedComposite,
): CompositeCardView {
  const n = issued.cohort.size + 1;
  const bars = issued.sources
    .map((s) => ({ trackId: TRACK_IDS.find((t) => t === s.trackId), value: s.scaled }))
    .filter((b): b is CompositeBar => b.trackId !== undefined);
  return {
    attemptId,
    composite: issued.composite,
    band: issued.band,
    bandCutlines: issued.bandCutlines,
    cohortSize: n,
    cohortSeed: issued.cohort.seed,
    percentile: issued.percentile,
    bars,
    // The service issues a score of record for the scored tracks only, so the
    // sources ARE the scored tracks and their sum is the same total.
    rawTotal: bars.reduce((a, b) => a + b.value, 0),
    origin: { kind: "server", sources: issued.sources },
    shareText:
      `Foray 2026.1 (demo) — composite ${issued.composite.toFixed(1)}/100, ${issued.band}, ` +
      `${cohortClause(n)}. Issued by the exam service, not by this browser. ` +
      `Tracks ${bars.map((b) => `${b.trackId.toUpperCase()} ${b.value.toFixed(0)}`).join(" · ")}.`,
  };
}

/**
 * WHAT A WITHHELD COMPOSITE SAYS TO THE CANDIDATE.
 *
 * "Unavailable" is not a reason, and a blank is worse. Each state below is a
 * different fact about the sitting, and the sentences must not be
 * interchangeable: a jury that has not reported yet means a number is coming,
 * and a track that was never sat means one is not. Keeping those apart is the
 * whole reason the service sends `awaiting[].trackState` instead of a count.
 *
 * Pure: a record in, a sentence out.
 */
export function awaitingCopy(awaited: AwaitedTrack): string {
  const name = TRACK_IDS.find((t) => t === awaited.trackId);
  const label = name === undefined ? awaited.trackId.toUpperCase() : `${TRACK_META[name].code} ${TRACK_META[name].name}`;
  switch (awaited.trackState) {
    case "pending_judging":
      return `${label} is with the jury. A judged track is marked after the sitting, so its score arrives later. The composite is issued when it does.`;
    case "not_sat":
      return `${label} was not sat. The exam service holds no work for it, so there is nothing to compose and no composite is coming for this sitting.`;
    case "unscored":
      return `${label} has no score of record. The exam service issued none for it, so the composite cannot be computed from this sitting.`;
  }
}

/** The heading over a withheld composite. It names the state, never a number. */
export function withheldHeadline(withheld: WithheldComposite): string {
  if (withheld.reason === "not_finalized") return "No composite yet";
  const waiting = withheld.awaiting.some((a) => a.trackState === "pending_judging");
  return waiting ? "Your composite is waiting on a judged track" : "No composite for this sitting";
}

/** Why a composite over part of the instrument is not issued at all. */
export const WITHHELD_LEDE: Record<CompositeWithheldReason, string> = {
  not_finalized:
    "This sitting is still open. The exam service issues a score of record when you finish it, and the composite is issued with those scores.",
  awaiting_track:
    "A composite needs every scored track. The weights are shares of the whole instrument, and the band ranks you against peers who sat all of it. Over a subset both mean something else, so the service withholds the number rather than print a different one under this name.",
};
