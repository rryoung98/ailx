/**
 * Composite scoring — spec §04 "Composite scoring" and "Performance bands".
 *
 * Track raw scores are NOT summed. Instead:
 *   1. each track raw score → within-cohort z-score;
 *   2. z-scores equally weighted and summed (deliberate annual policy);
 *   3. normalised area transformation: rank → percentile → inverse-normal
 *      → rescale to mean 50, SD 15, truncated to [0, 100];
 *   4. reports carry the four track scores, percentile and band.
 *
 * All functions here are PURE: no I/O, no clock, no Math.random.
 */

import { SCORE_ALLOCATION, SCORED_TRACK_IDS, trackPoints } from "@ailx/core";
import { canonicalJson, seededUniform, sha256Hex } from "./hash.js";

export const TRACK_IDS = ["t1", "t2", "t3", "t4"] as const;
export type TrackId = (typeof TRACK_IDS)[number];

/**
 * Track ids that carry composite weight. T4 is a SHOWCASE track: it is still
 * run, still recorded and still published to the gallery, and it issues no
 * points and enters no composite.
 */
export const SCORED_TRACKS: readonly TrackId[] = SCORED_TRACK_IDS;

/**
 * Tracks whose pure score() READS `inputs.judgments`, i.e. whose number
 * cannot be derived from the artifact alone.
 *
 * It is deliberately NOT derived from `SCORE_ALLOCATION`. The allocation
 * table describes the SCORED point budget; T4 is a showcase track and
 * declares no components at all, yet its showcase number is read straight off
 * stored judge values. A rule derived from the table would therefore exempt
 * exactly the track with the least oversight. This is instead a declaration
 * about the PLUGINS, and it is verified against them —
 * `apps/web/test/judgmentDependence.test.ts` varies only the stored judgments
 * of every real plugin and asserts that the set of scores that move is
 * exactly this set. A declaration that nothing checks is how the last one
 * went wrong.
 *
 * The session machine uses it for one thing: a locally-issued score on one of
 * these tracks MUST carry the judgment rows score() consumed. `judgments: []`
 * beside a judge-derived score is the precise shape of a score with no
 * recorded evidence, which is what the recomputability invariant forbids.
 */
export const JUDGE_RESOLVED_TRACKS: readonly TrackId[] = ["t1", "t3", "t4"];

/**
 * Composite weights, PROPORTIONAL TO THE POINT ALLOCATION (spec §04).
 *
 * This used to be four equal quarters, and equal weighting was defended as a
 * deliberate policy choice. It cannot survive the restructure unexamined, for
 * a reason that is easy to miss: the composite is built from z-scores, so
 * dropping T4 and keeping "equal weighting" would have RAISED T2 from a
 * quarter of the composite to a third — the exact opposite of the demotion
 * the point allocation just made. Weighting by declared points is what makes
 * the two agree: T1 135/375, T2 80/375, T3 160/375.
 *
 * The same mechanism is why removing T1's 25-point process component (TEN-80)
 * moved all three weights and not just T1's: a share of a smaller instrument
 * is a bigger share. Nothing was re-weighted by hand.
 *
 * It stays a policy choice, restated annually. It is now a policy choice that
 * says the same thing twice instead of two things at once.
 */
export const TRACK_WEIGHTS: Readonly<Record<TrackId, number>> = {
  t1: SCORE_ALLOCATION.t1.compositeWeight,
  t2: SCORE_ALLOCATION.t2.compositeWeight,
  t3: SCORE_ALLOCATION.t3.compositeWeight,
  t4: SCORE_ALLOCATION.t4.compositeWeight,
};

export interface TrackRawScores {
  t1: number;
  t2: number;
  t3: number;
  t4: number;
}

export type Band = "Distinction" | "Merit" | "Pass" | "Participation";

/** Year-1 band quotas (norm-referenced, IMO-style 1:2:3) — spec §04. */
export const BAND_QUOTAS = {
  Distinction: 1 / 12,
  Merit: 1 / 6,
  Pass: 1 / 4,
} as const;

// ---------------------------------------------------------------------------
// Statistics primitives
// ---------------------------------------------------------------------------

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) throw new Error("mean of empty array");
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Population standard deviation. */
export function stdev(xs: readonly number[]): number {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

/** Within-cohort z-scores. A zero-variance column maps to all zeros. */
export function zScores(xs: readonly number[]): number[] {
  const m = mean(xs);
  const s = stdev(xs);
  if (s === 0) return xs.map(() => 0);
  return xs.map((x) => (x - m) / s);
}

/**
 * Inverse of the standard normal CDF (probit), Acklam’s rational
 * approximation. Max relative error ~1.15e-9 — far below reporting precision.
 */
export function probit(p: number): number {
  if (!(p > 0 && p < 1)) throw new Error(`probit domain: p=${p}`);
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687,
    138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866,
    66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996,
    3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Mid-rank (Hazen) percentiles in (0, 1), ties averaged.
 * percentile_i = (avgRank_i − 0.5) / n.
 */
export function midRankPercentiles(xs: readonly number[]): number[] {
  const n = xs.length;
  const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(n);
  let k = 0;
  while (k < n) {
    let j = k;
    while (j + 1 < n && order[j + 1].v === order[k].v) j++;
    const avgRank = (k + j) / 2 + 1; // 1-based average rank of the tie group
    for (let t = k; t <= j; t++) ranks[order[t].i] = avgRank;
    k = j + 1;
  }
  return ranks.map((r) => (r - 0.5) / n);
}

// ---------------------------------------------------------------------------
// Composite pipeline
// ---------------------------------------------------------------------------

export interface CompositeResult {
  /** Weighted z-score sum per candidate (pre-normalisation). */
  zComposite: number[];
  /** Percentile in [0, 1) per candidate (mid-rank of zComposite). */
  percentile: number[];
  /** Normalised composite, mean 50 SD 15, truncated to [0, 100]. */
  composite: number[];
  /** Band per candidate, assigned by Year-1 fixed quota. */
  band: Band[];
  /**
   * REALIZED band cutlines on the composite scale: the minimum composite
   * actually placed in each band by the quotas this cohort produced (null
   * when a quota rounds to zero members). Bands are QUOTA-authoritative
   * (spec §04); the fixed thresholds in `bandFromComposite` are indicative
   * only, so reports must show these realized cutlines instead of implying
   * fixed ones.
   */
  bandCutlines: Record<"Distinction" | "Merit" | "Pass", number | null>;
}

/**
 * Deterministic tie key for quota banding (documented policy, F14):
 * candidates tied on the z-composite are ordered by higher T3, then higher
 * T2, then higher T1, then by the LEXICOGRAPHIC attempt hash (ascending).
 * T4 is deliberately absent: it is an unscored showcase, and a showcase
 * result may not decide who receives an award. With distinct attempt ids this is a total order,
 * so banding is invariant under input order. Without ids the hash falls back
 * to the canonical JSON of the raw score row; fully identical rows without
 * distinct ids are the only residual index-order case.
 */
export type TieKey = readonly [number, number, number, string];

export function tieKeyFor(row: TrackRawScores, attemptHash: string): TieKey {
  // SCORED tracks only. A showcase score may not decide an award.
  return [row.t3, row.t2, row.t1, attemptHash];
}

function compareTieKeys(a: TieKey, b: TieKey): number {
  for (let k = 0; k < 3; k++) {
    if (a[k] !== b[k]) return (b[k] as number) - (a[k] as number); // higher first
  }
  return a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0; // hash ascending
}

/**
 * Full composite pipeline for a cohort. `cohort[i]` is candidate i’s four
 * raw track scores (0–100 each). Order of candidates does not affect any
 * candidate’s outputs (verified by tests) — reproducibility requirement.
 */
export function scoreCohort(
  cohort: readonly TrackRawScores[],
  /** Optional stable candidate ids (attempt ids); hashed into the tie key. */
  attemptIds?: readonly string[],
): CompositeResult {
  const n = cohort.length;
  if (n < 2) throw new Error("composite scoring needs a cohort of ≥ 2");
  // SCORED tracks only: a showcase track has no composite weight, and
  // including its z-column would give it one by arithmetic accident.
  const zByTrack = SCORED_TRACKS.map((t) => zScores(cohort.map((c) => c[t])));
  const zComposite = cohort.map((_, i) =>
    SCORED_TRACKS.reduce((acc, t, ti) => acc + TRACK_WEIGHTS[t] * zByTrack[ti][i], 0),
  );
  const percentile = midRankPercentiles(zComposite);
  const composite = percentile.map((p) =>
    round3(clamp(50 + 15 * probit(p), 0, 100)),
  );
  const tieKeys = cohort.map((row, i) =>
    tieKeyFor(row, sha256Hex(attemptIds?.[i] ?? canonicalJson(row))),
  );
  const band = quotaBands(zComposite, tieKeys);
  const bandCutlines = realizedCutlines(band, composite);
  return {
    zComposite: zComposite.map(round6),
    percentile: percentile.map(round6),
    composite,
    band,
    bandCutlines,
  };
}

/** Minimum composite actually placed in each awarded band (null if empty). */
export function realizedCutlines(
  band: readonly Band[],
  composite: readonly number[],
): Record<"Distinction" | "Merit" | "Pass", number | null> {
  const min = (b: Band): number | null => {
    let m: number | null = null;
    band.forEach((x, i) => {
      if (x === b && (m === null || composite[i] < m)) m = composite[i];
    });
    return m;
  };
  return { Distinction: min("Distinction"), Merit: min("Merit"), Pass: min("Pass") };
}

/**
 * Norm-referenced Year-1 bands with fixed quotas (spec §04):
 * top 1/12 Distinction, next 1/6 Merit, next 1/4 Pass, remainder Participation.
 */
export function quotaBands(
  scores: readonly number[],
  /** Documented tie policy (see TieKey). Omitted → legacy index tiebreak. */
  tieKeys?: readonly TieKey[],
): Band[] {
  const n = scores.length;
  const nDistinction = Math.round(n * BAND_QUOTAS.Distinction);
  const nMerit = Math.round(n * BAND_QUOTAS.Merit);
  const nPass = Math.round(n * BAND_QUOTAS.Pass);
  // Descending order; ties broken by the documented tie policy when keys
  // are supplied (higher T3 → T2 → T1 → attempt hash), else by index.
  const order = scores
    .map((v, i) => ({ v, i }))
    .sort((a, b) =>
      b.v - a.v ||
      (tieKeys ? compareTieKeys(tieKeys[a.i], tieKeys[b.i]) : 0) ||
      a.i - b.i,
    );
  const bands = new Array<Band>(n);
  order.forEach(({ i }, rank) => {
    bands[i] =
      rank < nDistinction ? "Distinction"
      : rank < nDistinction + nMerit ? "Merit"
      : rank < nDistinction + nMerit + nPass ? "Pass"
      : "Participation";
  });
  return bands;
}

/**
 * INDICATIVE composite-scale band boundaries (spec §04 table): ≥70 / 61–69 /
 * 50–60 / <50. Quotas are AUTHORITATIVE for awarded bands; use
 * `CompositeResult.bandCutlines` for the realized thresholds of a cohort.
 */
export function bandFromComposite(composite: number): Band {
  if (composite >= 70) return "Distinction";
  if (composite >= 61) return "Merit";
  if (composite >= 50) return "Pass";
  return "Participation";
}

// ---------------------------------------------------------------------------
// Demo cohort simulator (clearly labelled: DEMO, not measurement)
// ---------------------------------------------------------------------------

/**
 * Deterministic synthetic cohort for the static showcase. Seeded by sha256,
 * so every visitor sees the same 44 peers. Approximately normal raw scores
 * via a sum of 12 uniforms (Irwin–Hall), per track.
 */
export function demoCohort(seed: string, size: number): TrackRawScores[] {
  const out: TrackRawScores[] = [];
  for (let i = 0; i < size; i++) {
    const row = {} as TrackRawScores;
    TRACK_IDS.forEach((t, ti) => {
      let s = 0;
      for (let k = 0; k < 12; k++) {
        s += seededUniform(`${seed}:${t}`, i * 12 + k);
      }
      // Irwin-Hall(12): mean 6, sd 1. Mixture of peers: every third one is a
      // casual player (centre ~32, wider spread), the rest prepared (~58).
      // Without the casual tail, real first runs fell below ALL 44 peers and
      // the rank->probit transform pinned every report at the same floor
      // (15.7) regardless of raw scores — observed live.
      // three tiers: drop-ins (~15), casual (~34), prepared (~58)
      const tier = i % 5 === 0 ? 0 : i % 3 === 0 ? 1 : 2;
      const centre = [15, 34, 58][tier];
      const spread = [10, 14, 12][tier];
      const raw = centre + [-4, 2, -1, 3][ti] + (s - 6) * spread;
      // Generated on a 0-100 shape, then stretched onto THIS track's point
      // total. Without the stretch a synthetic peer would top out at 100 on a
      // 160-point track and every real candidate would outrank all 44 of
      // them. A showcase track has no point total, so its index stays 0-100.
      const cap = trackPoints(t) || 100;
      row[t] = round1(clamp(raw, 0, 100) * (cap / 100));
    });
    out.push(row);
  }
  return out;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
function round1(x: number): number { return Math.round(x * 10) / 10; }
function round3(x: number): number { return Math.round(x * 1000) / 1000; }
function round6(x: number): number { return Math.round(x * 1e6) / 1e6; }
