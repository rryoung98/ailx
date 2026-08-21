import type { Judgment, ScoreInputs } from "@ailx/core";
import { T1_DIMENSIONS, T1_WEIGHTS } from "./types.js";
import type { T1Artifact, T1Config, T1Score } from "./types.js";

/**
 * PURE score() for T1 — spec §T1 "Score allocation" + §14 purity rule.
 * Consumes STORED judgments only; model calls happened in pipeline() stages.
 *
 * - 30 pts functional & accessibility gates  (dimension 'functional')
 * - 40 pts comparative visual merit          (dimension 'comparative')
 * - 20 pts technical ambition                (dimension 'ambition')
 * - 10 pts design rationale                  (dimension 'rationale' — ALL
 *          10 points come from the judged coherence dimension; the stored
 *          prompt-log process signal is reported as a diagnostic only and
 *          adds no points)
 */

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Median across judge samples — robust to a single outlier sample.
 * Judgment values are NORMALIZED to [0, 1] by contract (JudgeResponse.value);
 * anything outside that range is invalid stored data and throws rather than
 * silently clamping into full credit (F10).
 */
export function medianForDimension(
  judgments: ReadonlyArray<Judgment>,
  dimension: string,
): number {
  const vals = judgments
    .filter((j) => j.dimension === dimension)
    .map((j) => {
      if (!Number.isFinite(j.value) || j.value < 0 || j.value > 1) {
        throw new Error(
          `t1 judgment out of range: dimension=${j.dimension} sample=${j.sample} value=${j.value} (expected normalized [0,1])`,
        );
      }
      return j.value;
    })
    .sort((a, b) => a - b);
  if (vals.length === 0) return 0;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 === 1 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

/**
 * Process signal from the stored prompt log, in [0,1].
 * DIAGNOSTIC ONLY (F8): reported in raw as 'process.signal', never added to
 * any point component. Rewards evidence of an actual iteration loop:
 * prompting the assistant AND revising afterwards. Log-only presence (no
 * revision) earns half signal. Pure: derived from stored artifact data only.
 */
export function processSignal(artifact: T1Artifact): number {
  const prompted = artifact.promptLog.filter((e) => e.kind === "prompted").length;
  const revised = artifact.promptLog.filter((e) => e.kind === "revised").length;
  if (prompted === 0 && revised === 0) return 0;
  const loop = Math.min(prompted, revised); // completed prompt→revise cycles
  return clamp01(0.5 * Math.min(1, prompted / 2) + 0.5 * Math.min(1, loop / 2));
}

export function scoreT1(
  inputs: ScoreInputs<T1Artifact>,
  _cfg: T1Config,
): T1Score {
  const raw: Record<string, number> = {};
  let scaled = 0;
  for (const dim of T1_DIMENSIONS) {
    const unit = medianForDimension(inputs.judgments, dim);
    const pts = T1_WEIGHTS[dim] * unit;
    raw[dim] = round3(pts);
    scaled += pts;
  }
  // Reported diagnostic only — contributes zero points (F8).
  raw["process.signal"] = round3(processSignal(inputs.artifact));
  return { raw, scaled: round3(scaled) };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
