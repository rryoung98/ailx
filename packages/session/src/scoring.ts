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

import { seededUniform } from "./hash.js";

export const TRACK_IDS = ["t1", "t2", "t3", "t4"] as const;
export type TrackId = (typeof TRACK_IDS)[number];

/** Equal weighting is a deliberate policy choice, restated annually (spec §04). */
export const TRACK_WEIGHTS: Readonly<Record<TrackId, number>> = {
  t1: 0.25,
  t2: 0.25,
  t3: 0.25,
  t4: 0.25,
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
}

/**
 * Full composite pipeline for a cohort. `cohort[i]` is candidate i’s four
 * raw track scores (0–100 each). Order of candidates does not affect any
 * candidate’s outputs (verified by tests) — reproducibility requirement.
 */
export function scoreCohort(cohort: readonly TrackRawScores[]): CompositeResult {
  const n = cohort.length;
  if (n < 2) throw new Error("composite scoring needs a cohort of ≥ 2");
  const zByTrack = TRACK_IDS.map((t) => zScores(cohort.map((c) => c[t])));
  const zComposite = cohort.map((_, i) =>
    TRACK_IDS.reduce((acc, t, ti) => acc + TRACK_WEIGHTS[t] * zByTrack[ti][i], 0),
  );
  const percentile = midRankPercentiles(zComposite);
  const composite = percentile.map((p) =>
    round3(clamp(50 + 15 * probit(p), 0, 100)),
  );
  const band = quotaBands(zComposite);
  return { zComposite: zComposite.map(round6), percentile: percentile.map(round6), composite, band };
}

/**
 * Norm-referenced Year-1 bands with fixed quotas (spec §04):
 * top 1/12 Distinction, next 1/6 Merit, next 1/4 Pass, remainder Participation.
 */
export function quotaBands(scores: readonly number[]): Band[] {
  const n = scores.length;
  const nDistinction = Math.round(n * BAND_QUOTAS.Distinction);
  const nMerit = Math.round(n * BAND_QUOTAS.Merit);
  const nPass = Math.round(n * BAND_QUOTAS.Pass);
  // Stable descending order; ties broken by original index for determinism.
  const order = scores
    .map((v, i) => ({ v, i }))
    .sort((a, b) => b.v - a.v || a.i - b.i);
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

/** Composite-scale band boundaries (spec §04 table): ≥70 / 61–69 / 50–60 / <50. */
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
      // Irwin-Hall(12): mean 6, sd 1. Centre ~58 raw pts, sd ~13, per-track offset.
      const raw = 58 + [-4, 2, -1, 3][ti] + (s - 6) * 13;
      row[t] = round1(clamp(raw, 0, 100));
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
