import type { Judgment, ScoreInputs } from "@ailx/core";
import type { T4Artifact, T4Config, T4Final, T4Score } from "./types.js";

/**
 * T4 · Generative Direction — a 0-100 SHOWCASE INDEX. NOT a score.
 *
 * T4 issues no points and carries no composite weight (`SCORE_ALLOCATION.t4`
 * in `@ailx/core`, `scored: false`). The runner, the brief and the public
 * gallery stay — they are good product — but four things made T4
 * indefensible as a hundred points of measurement:
 *
 *  - **It duplicated T1.** Forty points of blinded pairwise comparative merit
 *    on the same Bradley-Terry machinery, twenty points of process evidence
 *    from a prompt log, ten of provenance hygiene, and the same `[Proxy]`
 *    claim type. §03 mapped T1 to "Create with AI 1-3" and T4 to "Create with
 *    AI 1, 2, 4" — an overlap, not a distinction.
 *  - **It could never enter the population statistic.** 70 of its 100 points
 *    (comparative 40 + blind viewer 30) need human panels that a probability
 *    panel structurally cannot supply: panellists are paid once and do not
 *    come back to judge each other. A compressed T4 block would have yielded
 *    craft and provenance — 30 points measuring prompt-log shape and metadata
 *    hygiene — which is not T4.
 *  - **Its governance model does not survive scale.** The spec commits to a
 *    human approving every asset before it is publicly visible. At four
 *    assets a candidate and N = 50,000 that is 200,000 approvals, ~1,100
 *    person-hours. Correct for a 45-person summit; not a growth plan.
 *  - **It was the largest single block of judge-resolved points.** 96 of its
 *    100 points resolved through stored judgment values, including the one
 *    objective component — brief compliance — whose defence was that a HUMAN
 *    panel decides it, and which `plugin.ts` routed to a model.
 *
 * The one thing T4 measured that nothing else does — did the artefact
 * communicate what it was meant to communicate — moves into T3 as a rubric
 * dimension over material that is cheaper, compressible and already
 * collected.
 *
 * WHY THE FUNCTION STILL EXISTS. The index is useful research data, it is
 * free to keep, and deleting it would throw away the only way to compute the
 * T1-T4 correlation that would settle the redundancy question empirically.
 * It is recorded in the attempt, rendered as "showcase, not scored", and
 * excluded from every composite. Its internal 30/40/20/10 proportions are
 * LOCAL constants — deliberately not in the allocation table, because the
 * allocation table is what issues points.
 *
 * PURE — spec §14 purity rule. Consumes STORED judgments only.
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

/**
 * Showcase-index proportions. Local on purpose — see the module comment.
 * They sum to 100 so the index reads on the familiar 0-100 scale.
 */
export const T4_SHOWCASE_WEIGHTS = {
  "brief-fit": 30,
  comparative: 40,
  craft: 20,
  provenance: 10,
} as const;

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

  const W = T4_SHOWCASE_WEIGHTS;
  const raw: Record<string, number> = {
    "brief-fit": round3(W["brief-fit"] * briefFit),
    comparative: round3(W.comparative * comparative),
    craft: round3(W.craft * craft),
    provenance: round3(W.provenance * provenance),
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
    W["brief-fit"] * briefFit + W.comparative * comparative +
      W.craft * craft + W.provenance * provenance,
  );
  return { raw, scaled };
}
