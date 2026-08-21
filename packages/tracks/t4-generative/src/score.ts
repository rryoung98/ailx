import type { Judgment, ScoreInputs } from "@ailx/core";
import type { T4Artifact, T4Config, T4Score } from "./types.js";

/**
 * PURE score() for T4 — spec §T4 "Score allocation" + §14 purity rule.
 * Consumes STORED judgments only.
 *
 * - 30 pts brief compliance & communicative accuracy ('brief-fit')
 * - 40 pts comparative merit                          ('comparative')
 * - 20 pts direction & craft evidence:
 *     50% steering efficiency — improvement per iteration, computed from
 *         stored per-generation judge values ('generation', sample = index)
 *     30% direction-note judgment              ('direction-note')
 *     20% quota efficiency from the stored prompt chain
 * - 10 pts provenance & disclosure hygiene            ('provenance')
 */

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

export function medianForDimension(
  judgments: ReadonlyArray<Judgment>,
  dimension: string,
): number {
  const vals = judgments
    .filter((j) => j.dimension === dimension)
    .map((j) => clamp01(j.value))
    .sort((a, b) => a - b);
  if (vals.length === 0) return 0;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 === 1 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

/** Stored per-generation judge values, ordered by generation index. */
export function generationSeries(
  judgments: ReadonlyArray<Judgment>,
): number[] {
  return judgments
    .filter((j) => j.dimension === "generation")
    .slice()
    .sort((a, b) => a.sample - b.sample)
    .map((j) => clamp01(j.value));
}

/**
 * Steering efficiency in [0,1]: was iteration diagnostic or random?
 * 60% normalized gain from first generation to the chosen one,
 * 40% fraction of steps that improved on the running best.
 * Fewer than two generations -> no iteration evidence -> 0.
 */
export function steeringEfficiency(
  series: number[],
  chosenIndex: number,
): number {
  if (series.length < 2) return 0;
  const first = series[0];
  const chosen = series[Math.min(Math.max(chosenIndex, 0), series.length - 1)];
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
 * Quota efficiency in [0,1]: knowing when to stop is part of the construct
 * (spec §13 — "generation quota as a resource"). Full credit for using at
 * least two but no more than the quota; a single generation shows no
 * iteration; exceeding quota is clamped by the UI but penalized if stored.
 */
export function quotaEfficiency(used: number, quota: number): number {
  if (used <= 0) return 0;
  if (used === 1) return 0.5;
  if (used <= quota) return 1;
  return clamp01(1 - (used - quota) / quota);
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
  const steering = steeringEfficiency(series, artifact.chosenIndex);
  const quota = quotaEfficiency(artifact.generations.length, cfg.maxGenerations);
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
  };
  const scaled = round3(
    30 * briefFit + 40 * comparative + 20 * craft + 10 * provenance,
  );
  return { raw, scaled };
}
