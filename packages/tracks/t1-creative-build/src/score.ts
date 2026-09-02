import type { Judgment, ScoreInputs } from "@ailx/core";
import { medianForDimension as medianForDimensionCore } from "@ailx/core";
import { T1_DIMENSIONS, T1_WEIGHTS } from "./types.js";
import type { T1Artifact, T1Config, T1Score } from "./types.js";

/**
 * PURE score() for T1 — spec §T1 "Score allocation" + §14 purity rule.
 * Consumes STORED judgments and the stored artifact; model calls happened in
 * pipeline() stages. Weights come from the ONE allocation table in
 * `@ailx/core`, so this file cannot disagree with the spec.
 *
 * - 40 pts functional & accessibility gates  (dimension 'functional')
 * - 60 pts comparative visual merit          (dimension 'comparative')
 * - 20 pts technical ambition                (dimension 'ambition')
 * - 15 pts design rationale                  (dimension 'rationale')
 * - 25 pts prompt-log process signal         (MODEL-FREE, from the artifact)
 *
 * The last one is new, and it is the point of T1's promotion to flagship.
 * The process signal was computed here and then thrown away: `raw` carried it
 * as a diagnostic and no component consumed it. That left T1 scoring an
 * artefact and nothing else — so a candidate who had shipped HTML for ten
 * years beat a candidate who had not, with the same model, and the one piece
 * of evidence that separates DIRECTING a model from ALREADY KNOWING HOW was
 * collected and discarded.
 *
 * It is a modest 25 of 160 on purpose. Process traces have weak convergent
 * validity in the stealth-assessment literature (reported correlations with
 * external criteria range roughly r = .1-.6), so the signal earns points as
 * corroborating behaviour, never as a substitute for the artefact.
 */

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Median across judge samples — robust to a single outlier sample, and
 * ORDER-INVARIANT: stored judgments arrive in whatever order the database
 * returns them, so the arithmetic may not depend on that order. The one
 * implementation lives in `@ailx/core` (`judgments.ts`) and T4 shares it;
 * this used to be a near-identical private copy. The "t1" label keeps the
 * out-of-range message naming its track, which is load-bearing for debugging.
 */
export function medianForDimension(
  judgments: ReadonlyArray<Judgment>,
  dimension: string,
): number {
  return medianForDimensionCore(judgments, dimension, "t1");
}

/** Distinct prompts, and completed prompt→revise cycles, for full credit. */
export const PROCESS_FULL_CREDIT_PROMPTS = 3;
export const PROCESS_FULL_CREDIT_CYCLES = 3;

/**
 * Process signal from the stored prompt log, in [0,1] — 25 SCORED points.
 *
 * It rewards evidence of an actual iteration loop: distinct instructions to
 * the assistant, each followed by a change to the artefact. Two deliberate
 * strictnesses, because this is now worth points and anything worth points
 * gets gamed:
 *
 *  - **Distinct prompts.** Prompts are keyed on trimmed, case-folded text, so
 *    pressing send on the same instruction ten times counts once. An entry
 *    with NO recorded prompt text shares the empty key with every other such
 *    entry and therefore also counts once — a declared rule, and the strict
 *    direction: the alternative pays for text nobody stored.
 *  - **Ordered cycles.** A `revised` entry only closes a cycle if a NEW
 *    distinct prompt is still open ahead of it in log order. Six alternating
 *    entries with one prompt text are one cycle, not three. The prompt log is
 *    append-only, so array order is event order.
 *
 * Half the signal is breadth (did the candidate direct the model more than
 * once), half is closure (did the direction actually change the artefact).
 * Pure: derived from stored artifact data only, no clock, no judge.
 */
export function processSignal(artifact: T1Artifact): number {
  const seen = new Set<string>();
  let distinctPrompts = 0;
  let cycles = 0;
  let openPrompt = false;
  for (const e of artifact.promptLog) {
    if (e.kind === "prompted") {
      const key = (e.prompt ?? "").trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      distinctPrompts++;
      openPrompt = true;
    } else if (e.kind === "revised" && openPrompt) {
      cycles++;
      openPrompt = false;
    }
  }
  if (distinctPrompts === 0) return 0;
  return clamp01(
    0.5 * Math.min(1, distinctPrompts / PROCESS_FULL_CREDIT_PROMPTS) +
      0.5 * Math.min(1, cycles / PROCESS_FULL_CREDIT_CYCLES),
  );
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
  const signal = processSignal(inputs.artifact);
  const process = T1_WEIGHTS.process * signal;
  raw.process = round3(process);
  // The unit signal stays in raw next to its points: an audit that wants to
  // recompute the component by hand needs the multiplicand, not just the
  // product.
  raw["process.signal"] = round3(signal);
  scaled += process;
  return { raw, scaled: round3(scaled) };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
