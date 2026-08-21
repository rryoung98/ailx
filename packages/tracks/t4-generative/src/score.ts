import type { Judgment, ScoreInputs } from "@ailx/core";
import type { T4Artifact, T4Config, T4Final, T4Score } from "./types.js";

/**
 * PURE score() for T4 — spec §T4 "Score allocation" + §14 purity rule.
 * Consumes STORED judgments only.
 *
 * - 30 pts brief compliance & communicative accuracy ('brief-fit')
 * - 40 pts comparative merit                          ('comparative')
 * - 20 pts direction & craft evidence:
 *     50% steering efficiency — improvement per iteration, computed from
 *         stored per-DRAFT judge values ('generation', sample = draft index)
 *     30% direction-note judgment              ('direction-note')
 *     20% final-quota efficiency — how much of the hard deliverable quota
 *         (three final images + one video, spec §T4) was actually delivered
 * - 10 pts provenance & disclosure hygiene            ('provenance')
 */

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function checkRange(j: Judgment): number {
  if (!Number.isFinite(j.value) || j.value < 0 || j.value > 1) {
    throw new Error(
      `t4 judgment out of range: dimension=${j.dimension} sample=${j.sample} value=${j.value} (expected normalized [0,1])`,
    );
  }
  return j.value;
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
    .map(checkRange)
    .sort((a, b) => a - b);
  if (vals.length === 0) return 0;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 === 1 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

/** Stored per-draft judge values, ordered by draft index. */
export function generationSeries(
  judgments: ReadonlyArray<Judgment>,
): number[] {
  return judgments
    .filter((j) => j.dimension === "generation")
    .slice()
    .sort((a, b) => a.sample - b.sample)
    .map(checkRange);
}

/**
 * Steering efficiency in [0,1] over the DRAFT series: was iteration
 * diagnostic or random?
 * 60% normalized gain from the first draft to the promoted one,
 * 40% fraction of steps that improved on the running best.
 * Fewer than two drafts -> no iteration evidence -> 0.
 */
export function steeringEfficiency(
  series: number[],
  promotedIndex: number,
): number {
  if (series.length < 2) return 0;
  const first = series[0];
  const chosen = series[Math.min(Math.max(promotedIndex, 0), series.length - 1)];
  const headroom = 1 - first;
  const gain = headroom <= 0 ? (chosen >= first ? 1 : 0) : clamp01((chosen - first) / headroom);
  let improving = 0;
  let best = series[0];
  for (let i = 1; i < series.length; i++) {
    if (series[i] > best) {
      improving++;
      best = series[i];
    }
  }
  const improvingFrac = improving / (series.length - 1);
  return clamp01(0.6 * gain + 0.4 * improvingFrac);
}

/**
 * Final-quota efficiency in [0,1] — F9. The deliverable is the quota
 * (spec §T4: three final images + one video). Credit is the delivered
 * fraction of the hard final quota; drafts are unlimited and cost nothing.
 */
export function quotaEfficiency(
  finals: { images: ReadonlyArray<T4Final>; video?: T4Final },
  cfg: Pick<T4Config, "finalImageQuota" | "finalVideoQuota">,
): number {
  const quota = cfg.finalImageQuota + cfg.finalVideoQuota;
  if (quota <= 0) return 0;
  const delivered =
    Math.min(finals.images.length, cfg.finalImageQuota) +
    Math.min(finals.video ? 1 : 0, cfg.finalVideoQuota);
  return clamp01(delivered / quota);
}

/** Draft index whose promotion the steering series should be read toward. */
export function promotedDraftIndex(artifact: T4Artifact): number {
  const promoted: number[] = [
    ...artifact.chosenSet
      .map((i) => artifact.finals.images[i])
      .filter((f): f is T4Final => !!f)
      .map((f) => f.fromDraftIndex),
    ...(artifact.finals.video ? [artifact.finals.video.fromDraftIndex] : []),
  ];
  if (promoted.length === 0) return artifact.drafts.length - 1;
  return Math.max(...promoted);
}

export function scoreT4(
  inputs: ScoreInputs<T4Artifact>,
  cfg: T4Config,
): T4Score {
  const { judgments, artifact } = inputs;

  const briefFit = medianForDimension(judgments, "brief-fit");
  const comparative = medianForDimension(judgments, "comparative");
  const provenance = medianForDimension(judgments, "provenance");
  const note = medianForDimension(judgments, "direction-note");

  const series = generationSeries(judgments);
  const steering = steeringEfficiency(series, promotedDraftIndex(artifact));
  const quota = quotaEfficiency(artifact.finals, cfg);
  const craft = 0.5 * steering + 0.3 * note + 0.2 * quota;

  const raw: Record<string, number> = {
    "brief-fit": round3(30 * briefFit),
    comparative: round3(40 * comparative),
    craft: round3(20 * craft),
    provenance: round3(10 * provenance),
    // Diagnostic sub-signals, reported but already folded into craft:
    "craft.steering": round3(steering),
    "craft.note": round3(note),
    "craft.quota": round3(quota),
    // Deliverable structure diagnostics (F9):
    "finals.images": artifact.finals.images.length,
    "finals.video": artifact.finals.video ? 1 : 0,
    "drafts.count": artifact.drafts.length,
  };
  const scaled = round3(
    30 * briefFit + 40 * comparative + 20 * craft + 10 * provenance,
  );
  return { raw, scaled };
}
