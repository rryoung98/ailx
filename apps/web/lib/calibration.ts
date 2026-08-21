/**
 * T2 calibration curve data — pure functions over the PERSISTED T2 artifact
 * (spec §T2: confidence is a second response; calibration is a scored
 * component). Only logged responses are used: lapses (choice === -1) and
 * responses whose item is unknown to the committed instrument are excluded,
 * never imputed. No invented numbers.
 */

export interface T2ResponseLike {
  itemId: string;
  /** Index into options; -1 = exposure lapsed with no response. */
  choice: number;
  /** 0..100 confidence slider. */
  confidence: number;
}

export interface CalibrationBin {
  /** Confidence range covered by this bin, inclusive lo, exclusive hi (last bin inclusive). */
  lo: number;
  hi: number;
  /** Number of ANSWERED responses that landed in the bin. */
  n: number;
  /** Mean stated confidence of those responses, 0..1. */
  meanConfidence: number;
  /** Observed fraction correct, 0..1. */
  accuracy: number;
}

/** Type guard: a persisted unknown artifact → validated T2 responses (drop malformed rows). */
export function t2ResponsesFromArtifact(artifact: unknown): T2ResponseLike[] {
  if (typeof artifact !== "object" || artifact === null) return [];
  const rs = (artifact as { responses?: unknown }).responses;
  if (!Array.isArray(rs)) return [];
  const out: T2ResponseLike[] = [];
  for (const r of rs) {
    if (typeof r !== "object" || r === null) continue;
    const { itemId, choice, confidence } = r as Record<string, unknown>;
    if (typeof itemId !== "string") continue;
    if (typeof choice !== "number" || !Number.isFinite(choice)) continue;
    if (typeof confidence !== "number" || !Number.isFinite(confidence)) continue;
    out.push({ itemId, choice, confidence });
  }
  return out;
}

/**
 * Bin answered responses by stated confidence and measure observed accuracy
 * per bin against the instrument's answer keys.
 *
 * - `keyByItem` maps itemId → correct option index (from the committed snapshot).
 * - Lapses (choice === -1) are excluded: an unanswered item has no stated
 *   confidence to calibrate (mirrors F7's missing-response rule).
 * - Responses for unknown itemIds are excluded (never guessed).
 * - Confidence is clamped to [0, 100] before binning; 100 lands in the top bin.
 */
export function calibrationBins(
  responses: ReadonlyArray<T2ResponseLike>,
  keyByItem: Readonly<Record<string, number>>,
  binCount = 5,
): CalibrationBin[] {
  if (!Number.isInteger(binCount) || binCount < 1) throw new Error("binCount must be a positive integer");
  const width = 100 / binCount;
  const sums = Array.from({ length: binCount }, () => ({ n: 0, conf: 0, correct: 0 }));
  for (const r of responses) {
    if (r.choice === -1) continue;
    const key = keyByItem[r.itemId];
    if (typeof key !== "number") continue;
    const conf = Math.min(100, Math.max(0, r.confidence));
    const bi = Math.min(binCount - 1, Math.floor(conf / width));
    const s = sums[bi];
    s.n += 1;
    s.conf += conf;
    if (r.choice === key) s.correct += 1;
  }
  return sums.map((s, i) => ({
    lo: i * width,
    hi: (i + 1) * width,
    n: s.n,
    meanConfidence: s.n > 0 ? s.conf / s.n / 100 : 0,
    accuracy: s.n > 0 ? s.correct / s.n : 0,
  }));
}
