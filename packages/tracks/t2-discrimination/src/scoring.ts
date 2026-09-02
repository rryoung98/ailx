/**
 * T2 pure scoring. Spec §T2 "Score allocation" + "Why raw accuracy is not
 * the score". No I/O, no clock, no randomness.
 *
 *  - 25 pts sensitivity: d' = z(H) - z(F), log-linear corrected (+0.5 to
 *    every contingency cell, applied to EVERY candidate), scaled between a
 *    declared FLOOR and a declared ceiling.
 *  - 15 pts criterion placement: distance of c from an unbiased threshold.
 *  - 25 pts calibration: Brier score over the 0-100 confidence slider,
 *    computed over ANSWERED binary items only (F7). Lapsed/unanswered items
 *    are EXCLUDED from the Brier mean — silence is not a calibrated 50%
 *    forecast.
 *  - 15 pts provenance reasoning: difficulty-weighted accuracy over the
 *    untimed provenance block.
 *
 * WHAT CHANGED, AND WHY IT HAD TO
 *
 * 1. **The criterion is scored, and the pure-d' weight is cut from 60 to 25.**
 *    The old allocation scored the part of this task that does not move and
 *    discarded the part that does. Gray et al. (R. Soc. Open Sci. 2025,
 *    N = 664) trained typical-ability participants to 51% accuracy at
 *    d' = -0.066, t(69) = 1.092, p = 0.279 — indistinguishable from chance;
 *    the authors read the gain as the removal of a below-chance BIAS. Kamali
 *    et al. (2026, within-subject, N = 32) found the same shape: +9 points of
 *    accuracy driven by +14.2 points on REAL images, i.e. criterion
 *    correction. Diel et al.'s meta-analysis (56 papers, 86,155 participants)
 *    puts pooled accuracy at 55.5% and pooled d' not significantly different
 *    from chance. So c is where the instruction-sensitive variance lives, and
 *    it used to be "reported as a diagnostic and does not enter the point
 *    total" by design.
 *
 * 2. **The floor spike is gone.** `clamp01(d'/ceiling)` gave EXACTLY zero to
 *    every candidate at or below chance. In a general-population panel that
 *    is a large, identical-scored spike at the bottom: it cannot be
 *    IRT-scaled, it cannot yield plausible values, and a national mean then
 *    moves with the size of the spike rather than with ability. Sensitivity
 *    is now scaled from a declared NEGATIVE floor, so a below-chance result
 *    is a datum rather than a tie, and the signed d' stays in `raw` either
 *    way.
 *
 * 3. **Coverage gates the criterion component too.** A candidate who answers
 *    nothing misses every signal item AND false-alarms every noise item; the
 *    two probits cancel and c lands near 0 — an unbiased-looking criterion
 *    earned by not playing. `responseCoverage` (the declared missing-response
 *    rule, previously used only for calibration) multiplies both.
 *
 * WHAT A T2 SCORE IS NOT. It is not a measure of AI literacy, and this file
 * is where that stops being restated as if it were. The reliable variance in
 * discrimination sensitivity is a mixture of a domain-general and
 * training-RESISTANT perceptual aptitude, familiarity with the specific
 * generators in this year's form, and how much the candidate happens to use
 * AI at work. The construct is synthetic-media discrimination — sensitivity
 * and criterion together.
 *
 * Raw accuracy is reported as a diagnostic only.
 */
import { round3 } from "@ailx/core";
import type { T2Artifact, T2Config, T2Item, T2Response } from "./types.js";
export { T2_DEFAULT_WEIGHTS, T2_TOTAL_POINTS } from "./types.js";

/** d' beyond this is clamped when scaling to points. Declared constant. */
export const D_PRIME_CEILING = 3.0;

/**
 * Signed d' at or below which sensitivity earns zero. Declared constant,
 * NEGATIVE on purpose.
 *
 * The old scale started at chance (d' = 0), which handed an identical zero to
 * everyone at or below it — and the population sits at chance. A floor spike
 * of identical scores cannot be IRT-scaled and cannot yield plausible values,
 * so the most-quoted output of the instrument would have measured the size of
 * the spike. −1.0 is roughly "systematically worse than chance": a candidate
 * there is calling real content synthetic and synthetic content real, which
 * is a real and different result from being at chance, and it should not tie
 * with it.
 */
export const D_PRIME_FLOOR = -1.0;

/**
 * |c| at or beyond which criterion points are exhausted. Declared constant.
 * c = 0 is an unbiased threshold; |c| = 1 is a strong, systematic truth bias
 * or synthetic bias — published human performance runs near a 67%/31%
 * true-positive split, which is that order of magnitude.
 */
export const CRITERION_CEILING = 1.0;

/**
 * Fraction of the binary deck that must be answered for full weight on the
 * components a non-response can fake. Declared missing-response rule.
 */
export const FULL_COVERAGE_FRACTION = 0.5;

/**
 * Best corrected d′ a flawless run can reach on a deck with the given
 * signal/noise counts (hits = nSignal, falseAlarms = 0, log-linear cells).
 * Short demo decks pass min(D_PRIME_CEILING, this) as cfg.dPrimeCeiling so
 * perfect play still earns full sensitivity points.
 */
export function maxAttainableDPrime(nSignal: number, nNoise: number): number {
  if (nSignal <= 0 || nNoise <= 0) return 0;
  return probit((nSignal + 0.5) / (nSignal + 1)) - probit(0.5 / (nNoise + 1));
}

/**
 * Inverse standard-normal CDF (probit), Acklam's rational approximation.
 * |relative error| < 1.15e-9 over (0,1). Pure.
 */
export function probit(p: number): number {
  if (!(p > 0 && p < 1)) throw new Error(`probit domain: ${p}`);
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
    1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
    6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
    -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
    3.754408661907416e+00];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pl) {
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export interface T2Raw {
  /** The four SCORED components, in points. */
  sensitivity: number;
  criterion: number;
  calibration: number;
  provenance: number;
  /** Diagnostics — reported, never added to the point total. */
  dPrime: number;
  /** Signed c. Negative is a synthetic-calling bias, positive a truth bias. */
  criterionC: number;
  accuracy: number;
  brier: number;
  weightedAccuracy: number;
  /** Answered (non-lapsed) binary items — the Brier population (F7). */
  answeredBinary: number;
  /**
   * Coverage multiplier on the components a non-response could otherwise
   * fake: min(1, answeredFrac / FULL_COVERAGE_FRACTION).
   */
  responseCoverage: number;
  hits: number;
  falseAlarms: number;
  nSignal: number;
  nNoise: number;
}

function responseFor(
  byId: ReadonlyMap<string, T2Response>,
  item: T2Item,
): T2Response {
  // A lapsed item is a stored fact: no choice, zero confidence.
  return byId.get(item.id) ?? { itemId: item.id, choice: -1, confidence: 0, latencyMs: 0 };
}

export function scoreT2(artifact: T2Artifact, cfg: T2Config): { raw: T2Raw; scaled: number } {
  const byId = new Map<string, T2Response>();
  for (const r of artifact.responses) {
    if (!byId.has(r.itemId)) byId.set(r.itemId, r); // first write wins: append-only
  }

  const binary = cfg.items.filter((i) => i.type !== "provenance");
  const prov = cfg.items.filter((i) => i.type === "provenance");

  // --- Sensitivity: d' over the binary (media + message) blocks -------------
  let hits = 0, falseAlarms = 0, nSignal = 0, nNoise = 0;
  for (const item of binary) {
    const signal = item.signal ?? 1;
    const r = responseFor(byId, item);
    const isSignal = item.key === signal;
    const saidSignal = r.choice === signal;
    // A lapse (choice < 0) earns the bad cell in BOTH classes: no hit on a
    // signal item, a false alarm on a noise item. Silence is never a free
    // correct rejection — otherwise deliberately lapsing noise items would
    // strictly dominate answering (mirrors F7: silence is not a forecast).
    if (isSignal) {
      nSignal++;
      if (saidSignal) hits++;
    } else {
      nNoise++;
      if (saidSignal || r.choice < 0) falseAlarms++;
    }
  }
  // Log-linear correction (Hautus): +0.5 per cell, +1 per denominator, always.
  const H = (hits + 0.5) / (nSignal + 1);
  const F = (falseAlarms + 0.5) / (nNoise + 1);
  const dPrime = nSignal > 0 && nNoise > 0 ? probit(H) - probit(F) : 0;
  const criterionC = nSignal > 0 && nNoise > 0 ? -(probit(H) + probit(F)) / 2 : 0;
  const measurable = nSignal > 0 && nNoise > 0;
  const ceiling = cfg.dPrimeCeiling ?? D_PRIME_CEILING;
  const floor = cfg.dPrimeFloor ?? D_PRIME_FLOOR;
  // Scaled between a declared floor and a declared ceiling, so a below-chance
  // result is a datum rather than a tie at zero (see D_PRIME_FLOOR).
  const sensitivityUnit = measurable && ceiling > floor
    ? clamp01((dPrime - floor) / (ceiling - floor))
    : 0;
  const sensitivity = cfg.weights.sensitivity * sensitivityUnit;

  // --- Calibration: Brier over ANSWERED confidence taps only (F7) -----------
  // Forecast f = 0.5 + confidence/200: a 0-confidence answer is a coin flip,
  // 100 confidence claims certainty. Being confidently wrong costs the most.
  // Lapsed items (choice < 0, i.e. no response before the exposure ended)
  // are excluded from the Brier mean: an unanswered item is not a forecast
  // and must earn no calibration credit.
  let brierSum = 0, correctCount = 0, answeredBinary = 0;
  for (const item of binary) {
    const r = responseFor(byId, item);
    const correct = r.choice === item.key ? 1 : 0;
    correctCount += correct;
    if (r.choice < 0) continue; // lapse: excluded from calibration
    answeredBinary++;
    const f = 0.5 + Math.min(100, Math.max(0, r.confidence)) / 200;
    brierSum += (f - correct) ** 2;
  }
  const brier = answeredBinary > 0 ? brierSum / answeredBinary : 0;
  const accuracy = binary.length > 0 ? correctCount / binary.length : 0;
  // Declared missing-response rule: full weight requires answering >= 50% of
  // the binary deck; linear credit below that. It gates BOTH calibration and
  // criterion, because both are fakeable by silence.
  const answeredFrac = binary.length > 0 ? answeredBinary / binary.length : 0;
  const responseCoverage = clamp01(answeredFrac / FULL_COVERAGE_FRACTION);
  // 0 Brier -> full points; 0.25 (pure guessing) -> half; >= 0.5 -> zero.
  const calibration =
    cfg.weights.calibration * clamp01(1 - 2 * brier) * responseCoverage;

  // --- Criterion placement: how far the threshold sits from unbiased -------
  // The component the evidence says instruction actually moves. Full points
  // at c = 0; exhausted at |c| >= CRITERION_CEILING, in EITHER direction —
  // calling everything synthetic is a different literacy failure from
  // calling everything real, and both are failures.
  //
  // Coverage-gated, and that gate is load-bearing rather than defensive: a
  // candidate who answers nothing misses every signal item and false-alarms
  // every noise item, the two probits cancel, and c lands at ~0. Without the
  // gate, silence would buy a perfect criterion score.
  const criterionUnit = measurable
    ? clamp01(1 - Math.abs(criterionC) / CRITERION_CEILING)
    : 0;
  const criterion = cfg.weights.criterion * criterionUnit * responseCoverage;

  // --- Provenance reasoning: difficulty-weighted accuracy -------------------
  let wSum = 0, wCorrect = 0;
  for (const item of prov) {
    const r = responseFor(byId, item);
    const wgt = 1 + item.difficulty; // hard items count up to double
    wSum += wgt;
    if (r.choice === item.key) wCorrect += wgt;
  }
  const weightedAccuracy = wSum > 0 ? wCorrect / wSum : 0;
  const provenance = cfg.weights.provenance * weightedAccuracy;

  const raw: T2Raw = {
    sensitivity: round3(sensitivity),
    criterion: round3(criterion),
    calibration: round3(calibration),
    provenance: round3(provenance),
    dPrime: round3(dPrime),
    criterionC: round3(criterionC),
    accuracy: round3(accuracy),
    brier: round3(brier),
    weightedAccuracy: round3(weightedAccuracy),
    answeredBinary,
    responseCoverage: round3(responseCoverage),
    hits, falseAlarms, nSignal, nNoise,
  };
  return {
    raw,
    scaled: round3(
      raw.sensitivity + raw.criterion + raw.calibration + raw.provenance,
    ),
  };
}

