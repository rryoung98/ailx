import type { Judgment } from "./plugin.js";

/**
 * Shared, ORDER-INVARIANT aggregation of STORED judgment rows.
 *
 * WHY THIS FILE EXISTS. The repo invariant is that any score ever issued is
 * byte-identically recomputable from stored inputs. Stored judgments arrive
 * from a database, and a SQL read without an explicit ORDER BY has no
 * guaranteed row order. That was enough to break the invariant, because
 * floating-point addition is NOT associative: the three legal values
 * [0.1, 0.2, 0.30000000000000004] sum to 0.6000000000000001 in one
 * permutation and 0.6 in another, so their mean is 0.20000000000000004 or
 * 0.19999999999999998 depending on nothing but arrival order. Downstream
 * that survived rounding — a real T3 sitting differed by 30.226 vs 30.227
 * AFTER round3. The score of record was not reproducible.
 *
 * The fix is arithmetic, not documentation: every aggregation here is
 * order-invariant BY CONSTRUCTION.
 *
 *  - Values are CANONICALLY SORTED ascending before they are summed, so a
 *    permutation of the same multiset produces the identical sequence of
 *    floating-point additions and therefore the identical bits. Compensated
 *    (Kahan/Neumaier) summation was considered and rejected ALONE: it shrinks
 *    the error but is itself order-sensitive, so it would only make the bug
 *    rarer and harder to find. Sorting is exact for this purpose, pure, and
 *    at jury sizes (3-8 rows) free.
 *  - Rows themselves get ONE canonical total order —
 *    (dimension, sample, modelId, value, evidence) — see
 *    {@link compareJudgments}. It is TOTAL on purpose: duplicate-looking rows
 *    cannot fall back to arrival order to break a tie.
 *  - Negative zero is normalized to +0 on read. `-0` passes the [0,1] range
 *    check, sorts equal to `0`, and is invisible to `===`, but it serializes
 *    and hashes differently — exactly the kind of difference "byte-identical"
 *    is about.
 *
 * Everything here is pure: no I/O, no clock, no randomness. It is the ONE
 * copy of this arithmetic; T1, T3 and T4 all call it, so they cannot drift.
 */

/** Track label used in validation errors, so a bad row names its track. */
export type JudgmentTrackLabel = "t1" | "t3" | "t4";

/**
 * THE canonical total order for stored judgment rows:
 * dimension, then sample, then modelId, then value, then evidence.
 *
 * Strings compare with `<`/`>` on UTF-16 code units — deterministic and
 * locale-independent, unlike `String.prototype.localeCompare`.
 */
export function compareJudgments(a: Judgment, b: Judgment): number {
  if (a.dimension !== b.dimension) return a.dimension < b.dimension ? -1 : 1;
  if (a.sample !== b.sample) return a.sample < b.sample ? -1 : 1;
  if (a.modelId !== b.modelId) return a.modelId < b.modelId ? -1 : 1;
  if (a.value !== b.value) return a.value < b.value ? -1 : 1;
  const ae = a.evidence ?? "";
  const be = b.evidence ?? "";
  if (ae !== be) return ae < be ? -1 : 1;
  return 0;
}

/**
 * A copy of the rows in the canonical order. Never mutates the input — the
 * caller's array may be the stored read itself.
 *
 * NaN `sample` or `value` would make the comparator inconsistent, so callers
 * that sort must validate first ({@link validatedValues} does).
 */
export function canonicalJudgments(
  judgments: ReadonlyArray<Judgment>,
): Judgment[] {
  return judgments.slice().sort(compareJudgments);
}

/**
 * Range check for ONE stored judgment value — F10.
 * Values are NORMALIZED to [0,1] by contract (JudgeResponse.value); anything
 * outside that range is invalid stored data and throws rather than silently
 * clamping into full credit. NaN and ±Infinity throw here too.
 */
export function checkJudgmentRange(
  j: Judgment,
  track: JudgmentTrackLabel,
): number {
  if (!Number.isFinite(j.value) || j.value < 0 || j.value > 1) {
    throw new Error(
      `${track} judgment out of range: dimension=${j.dimension} sample=${j.sample} value=${j.value} (expected normalized [0,1])`,
    );
  }
  return j.value === 0 ? 0 : j.value; // normalize -0 to +0
}

/**
 * Validated values for one dimension, in CANONICAL VALUE ORDER (ascending).
 *
 * Validation runs over the rows in canonical ROW order, so which bad row is
 * reported first does not depend on arrival order either — the error message
 * is part of the observable behaviour.
 */
export function validatedValues(
  judgments: ReadonlyArray<Judgment>,
  dimension: string,
  track: JudgmentTrackLabel,
): number[] {
  const vals: number[] = [];
  for (const j of judgments) {
    if (j.dimension !== dimension) continue;
    vals.push(checkJudgmentRange(j, track));
  }
  // Rows that failed validation never reach here, so no NaN can poison sort.
  return vals.sort((a, b) => a - b);
}

/**
 * Mean of already-validated values, order-invariant.
 * Sorts ascending before summing (see the module comment). Empty -> 0.
 */
export function meanValue(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  let sum = 0;
  for (const v of sorted) sum += v;
  return sum / sorted.length;
}

/**
 * Median of already-validated values — robust to a single outlier sample.
 * Empty -> 0. The even-length midpoint `(lo + hi) / 2` is computed from the
 * SORTED pair, so it does not depend on arrival order.
 */
export function medianValue(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  const half = (sorted[mid - 1] + sorted[mid]) / 2;
  return half === 0 ? 0 : half; // (-0 + -0)/2 is -0
}

/**
 * Median across judge samples for one dimension. The one implementation T1
 * and T4 share; they used to keep near-identical private copies.
 */
export function medianForDimension(
  judgments: ReadonlyArray<Judgment>,
  dimension: string,
  track: JudgmentTrackLabel,
): number {
  return medianValue(validatedValues(judgments, dimension, track));
}

/** Order-invariant mean across judge samples for one dimension. */
export function meanForDimension(
  judgments: ReadonlyArray<Judgment>,
  dimension: string,
  track: JudgmentTrackLabel,
): number {
  return meanValue(validatedValues(judgments, dimension, track));
}

/**
 * Validated values for one dimension in CANONICAL ROW order — for series
 * that are read positionally (T4's per-draft generation series) rather than
 * aggregated. Sorting by `sample` alone left rows that share a `sample`
 * tie-breaking by arrival order; the total order removes that.
 */
export function orderedDimensionValues(
  judgments: ReadonlyArray<Judgment>,
  dimension: string,
  track: JudgmentTrackLabel,
): number[] {
  const rows = judgments.filter((j) => j.dimension === dimension);
  // Validate BEFORE sorting: a NaN value would make the comparator
  // inconsistent and the result implementation-defined.
  for (const j of rows) checkJudgmentRange(j, track);
  return canonicalJudgments(rows).map((j) => checkJudgmentRange(j, track));
}
