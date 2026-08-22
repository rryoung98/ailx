/**
 * T2 pure scoring. Spec §T2 "Score allocation" + "Why raw accuracy is not
 * the score". No I/O, no clock, no randomness.
 *
 *  - 60 pts sensitivity: d' = z(H) - z(F), log-linear corrected (+0.5 to
 *    every contingency cell, applied to EVERY candidate).
 *  - 25 pts calibration: Brier score over the 0-100 confidence slider,
 *    computed over ANSWERED binary items only (F7). Lapsed/unanswered items
 *    are EXCLUDED from the Brier mean — silence is not a calibrated 50%
 *    forecast — and full calibration weight additionally requires answering
 *    at least 50% of the binary deck (linear below that; declared missing-
 *    response rule, reported in raw as 'calibrationCoverage'). A fully
 *    unanswered deck earns zero calibration points.
 *  - 15 pts provenance reasoning: difficulty-weighted accuracy over the
 *    untimed provenance block.
 *
 * Raw accuracy and criterion c are reported as diagnostics only.
 */
import type { T2Artifact, T2Config, T2Item, T2Response } from "./types.js";

/** d' beyond this is clamped when scaling to points. Declared constant. */
export const D_PRIME_CEILING = 3.0;

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
  sensitivity: number;
  calibration: number;
  provenance: number;
  /** Diagnostics — reported, never added to the point total. */
  dPrime: number;
  criterion: number;
  accuracy: number;
  brier: number;
  weightedAccuracy: number;
  /** Answered (non-lapsed) binary items — the Brier population (F7). */
  answeredBinary: number;
  /** Coverage multiplier on calibration: min(1, answeredFrac / 0.5). */
  calibrationCoverage: number;
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
  const criterion = nSignal > 0 && nNoise > 0 ? -(probit(H) + probit(F)) / 2 : 0;
  const ceiling = cfg.dPrimeCeiling ?? D_PRIME_CEILING;
  const sensitivity = cfg.weights.sensitivity * clamp01(dPrime / ceiling);

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
  // Declared missing-response rule: full calibration weight requires
  // answering >= 50% of the binary deck; linear credit below that.
  const answeredFrac = binary.length > 0 ? answeredBinary / binary.length : 0;
  const calibrationCoverage = clamp01(answeredFrac / 0.5);
  // 0 Brier -> full points; 0.25 (pure guessing) -> half; >= 0.5 -> zero.
  const calibration =
    cfg.weights.calibration * clamp01(1 - 2 * brier) * calibrationCoverage;

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
    calibration: round3(calibration),
    provenance: round3(provenance),
    dPrime: round3(dPrime),
    criterion: round3(criterion),
    accuracy: round3(accuracy),
    brier: round3(brier),
    weightedAccuracy: round3(weightedAccuracy),
    answeredBinary,
    calibrationCoverage: round3(calibrationCoverage),
    hits, falseAlarms, nSignal, nNoise,
  };
  return { raw, scaled: round3(raw.sensitivity + raw.calibration + raw.provenance) };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
