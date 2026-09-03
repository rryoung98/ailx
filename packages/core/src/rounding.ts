/**
 * Score rounding — the ONE copy.
 *
 * Every track rounds its reported components to three decimals, and until
 * this file existed each of the four kept its own identical private copy.
 * They also each carried the same latent defect: `Math.round(-0.0004 * 1000)`
 * is `-0`, and so is `Math.round(-0 * 1000)`. Negative zero passes every
 * range check, compares `=== 0`, prints as "0", and is invisible in a debugger
 * — and it is a DIFFERENT value to content-address. T2's `criterionC` really
 * did reach a stored score as `-0`, from `-(probit(H) + probit(F)) / 2` when
 * hit rate and false-alarm rate are symmetric, which is not an edge case: it
 * is the unbiased responder.
 *
 * So rounding normalizes it. A score of record may not contain a value whose
 * canonical encoding depends on a sign nobody meant.
 */

/** Round to three decimals, never returning negative zero. */
export function round3(x: number): number {
  const r = Math.round(x * 1000) / 1000;
  return r === 0 ? 0 : r;
}
