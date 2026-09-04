/**
 * THE COMPOSITE OF RECORD, AS THE BROWSER READS IT (TEN-92).
 *
 * The exam service issues the composite for a hosted sitting and returns it
 * as a field on the existing `scores` object of `GET /v1/attempts/:id`
 * (backend PR #13). It is here, in the contract, because both repositories
 * must spell the same wire shape and a type copied into two repositories
 * drifts.
 *
 * IT IS A DISCRIMINATED UNION, AND THAT IS THE POINT. A nullable number would
 * let "no composite" be read as "composite zero" by any caller that forgets a
 * check. `state` forces the caller to answer the question, and the withheld
 * arm carries the reason and the tracks it is waiting on, so an absence can
 * be explained to a candidate rather than left as a hole.
 *
 * The browser NEVER computes this number. `scoredBy` is always `"server"`,
 * the evidence stays with the service, and a page that shows it must say so:
 * there is no local replay of a composite the browser did not derive.
 *
 * Pure: types and one hand-checked parser. Every field off the wire is
 * validated rather than cast, because this body decides what a candidate is
 * told about their own result. A malformed record reads as "we cannot say"
 * and never as a number.
 */

/** The bands a cohort quota can assign (`@ailx/session` `Band`). */
export const COMPOSITE_BANDS = ["Distinction", "Merit", "Pass", "Participation"] as const;

export type CompositeBand = (typeof COMPOSITE_BANDS)[number];

/** The three cutline bands. `Participation` is the remainder and has none. */
export const CUTLINE_BANDS = ["Distinction", "Merit", "Pass"] as const;

export type CutlineBand = (typeof CUTLINE_BANDS)[number];

/**
 * The peers this composite positions the candidate against.
 *
 * `demo` is 44 deterministic synthetic runs generated from a seed. It is a
 * fixed reference distribution, not a population, so the band it produces is
 * a position in that fixture and not a rank among people. A surface that
 * shows the number must say which cohort it is (docs/SAMPLING.md), and a real
 * cohort would be a different statistic under a different `kind`.
 */
export interface CompositeCohort {
  kind: "demo";
  seed: string;
  /** Peers, excluding the candidate. The pipeline runs over `size + 1` rows. */
  size: number;
}

/** One stored score row this composite was derived from, named so it can be re-read. */
export interface CompositeSource {
  trackId: string;
  /** The `scores.id` of the live row: what makes the number re-readable. */
  scoreId: string;
  scaled: number;
  /** The marking version the row was issued under. An identifier, not a scheme. */
  rubricVersion: string;
  scoringDigest: string;
  /** This track's share of the whole instrument. */
  weight: number;
}

export interface IssuedComposite {
  state: "issued";
  /** Normalised composite, mean 50 SD 15, truncated to [0, 100]. */
  composite: number;
  /**
   * Mid-rank position of the z-composite within the cohort, in [0, 1).
   *
   * It is a position among 44 generated runs, so it is NOT a percentile about
   * people and must never be printed as one (`apps/web/test/reportHonesty.test.tsx`).
   */
  percentile: number;
  /** The weighted z-score sum, before normalisation. */
  zComposite: number;
  band: CompositeBand;
  /** Realized quota cutlines for THIS cohort. Quotas are authoritative (spec §04). */
  bandCutlines: Record<CutlineBand, number | null>;
  /** Always `"server"`. The browser did not compute this and claims no replay. */
  scoredBy: "server";
  cohort: CompositeCohort;
  /** The scored tracks' weights, by track id. */
  weights: Record<string, number>;
  sources: CompositeSource[];
}

/**
 * `not_finalized` — the sitting is open, so no score of record exists yet.
 * `awaiting_track` — a scored track has no number. Named in `awaiting`.
 */
export const COMPOSITE_WITHHELD_REASONS = ["not_finalized", "awaiting_track"] as const;

export type CompositeWithheldReason = (typeof COMPOSITE_WITHHELD_REASONS)[number];

/**
 * The states a track can be in while the composite waits for it.
 *
 * A jury that has not reported and a track that was never sat are different
 * facts, and a candidate must be told which one they are in. The service
 * copies the state straight off the same read the scores come from.
 */
export const AWAITED_TRACK_STATES = ["pending_judging", "not_sat", "unscored"] as const;

export type AwaitedTrackState = (typeof AWAITED_TRACK_STATES)[number];

export interface AwaitedTrack {
  trackId: string;
  trackState: AwaitedTrackState;
  detail: string;
}

export interface WithheldComposite {
  state: "withheld";
  reason: CompositeWithheldReason;
  /** Empty when the reason is `not_finalized`; otherwise every track waited on. */
  awaiting: AwaitedTrack[];
  detail: string;
}

export type AttemptComposite = IssuedComposite | WithheldComposite;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function parseCutlines(raw: unknown): Record<CutlineBand, number | null> | null {
  if (!isRecord(raw)) return null;
  const out = {} as Record<CutlineBand, number | null>;
  for (const b of CUTLINE_BANDS) {
    const v = raw[b];
    if (v === null || v === undefined) out[b] = null;
    else if (finite(v)) out[b] = v;
    else return null;
  }
  return out;
}

function parseSource(raw: unknown): CompositeSource | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.trackId !== "string" || raw.trackId === "") return null;
  if (typeof raw.scoreId !== "string" || raw.scoreId === "") return null;
  if (!finite(raw.scaled) || !finite(raw.weight)) return null;
  return {
    trackId: raw.trackId,
    scoreId: raw.scoreId,
    scaled: raw.scaled,
    rubricVersion: str(raw.rubricVersion),
    scoringDigest: str(raw.scoringDigest),
    weight: raw.weight,
  };
}

function parseAwaited(raw: unknown): AwaitedTrack | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.trackId !== "string" || raw.trackId === "") return null;
  const trackState = AWAITED_TRACK_STATES.find((s) => s === raw.trackState);
  // A state this build cannot name is dropped rather than guessed at: it
  // would be shown to a candidate as a reason, and a wrong reason is worse
  // than a shorter list.
  return trackState === undefined
    ? null
    : { trackId: raw.trackId, trackState, detail: str(raw.detail) };
}

/**
 * One `composite` field off the wire, or null when it is not one.
 *
 * Null means "the service said nothing we can read", which a caller must
 * render as its own fact. It is not an issued composite and it is not a
 * withheld one, so it may never become a number.
 *
 * An issued composite is rejected outright when a numeric field is missing or
 * not finite. Half a composite is not a composite: a card drawn from it would
 * put a real band next to an invented score.
 */
export function parseAttemptComposite(raw: unknown): AttemptComposite | null {
  if (!isRecord(raw)) return null;
  if (raw.state === "issued") {
    const bandCutlines = parseCutlines(raw.bandCutlines);
    const band = COMPOSITE_BANDS.find((b) => b === raw.band);
    if (bandCutlines === null || band === undefined) return null;
    if (!finite(raw.composite) || !finite(raw.percentile) || !finite(raw.zComposite)) return null;
    if (raw.scoredBy !== "server") return null;
    if (!isRecord(raw.cohort) || raw.cohort.kind !== "demo" || !finite(raw.cohort.size)) return null;
    if (!Array.isArray(raw.sources)) return null;
    const sources = raw.sources.map(parseSource);
    if (sources.some((s) => s === null)) return null;
    const weights: Record<string, number> = {};
    if (isRecord(raw.weights)) {
      for (const [k, w] of Object.entries(raw.weights)) if (finite(w)) weights[k] = w;
    }
    return {
      state: "issued",
      composite: raw.composite,
      percentile: raw.percentile,
      zComposite: raw.zComposite,
      band,
      bandCutlines,
      scoredBy: "server",
      cohort: { kind: "demo", seed: str(raw.cohort.seed), size: raw.cohort.size },
      weights,
      sources: sources as CompositeSource[],
    };
  }
  if (raw.state === "withheld") {
    const reason = COMPOSITE_WITHHELD_REASONS.find((r) => r === raw.reason);
    if (reason === undefined) return null;
    const awaiting = Array.isArray(raw.awaiting)
      ? raw.awaiting.map(parseAwaited).filter((a): a is AwaitedTrack => a !== null)
      : [];
    return { state: "withheld", reason, awaiting, detail: str(raw.detail) };
  }
  return null;
}
