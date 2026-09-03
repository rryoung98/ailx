import type { Judgment, ScoreInputs } from "@ailx/core";
import { medianForDimension as medianForDimensionCore, round3 } from "@ailx/core";
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
 *   135 points. The prompt log earns NONE of them — see {@link processSignal}.
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
 * Process signal from the stored prompt log, in [0,1] — DIAGNOSTIC, ZERO
 * POINTS. Reported in `raw` as `process.signal` and consumed by no component.
 *
 * It was worth 25 of T1's 160 points for one day (TEN-31). TEN-80's evidence
 * spike removed the points and kept the number, and the reasoning has to live
 * next to the formula so nobody scores it again:
 *
 *  - **Nothing validates it.** No published study validates a volume-monotone
 *    process score of AI-assisted work against an independent outcome. The
 *    cell is empty, and the emptiness is the finding.
 *  - **Where volume was measured, it was null-to-negative.** Ziegler et al.
 *    (MAPS '22, arXiv:2205.06537, n ~ 2,000): raw completions `shown`
 *    r = 0.01 (p = 0.75) while the RATIO `accepted_per_shown` reached
 *    rho = 0.24; dialogue turns r = -0.01 against expert-rated artefact
 *    quality; help-seeking volume r = -0.46 with learning gain (Aleven et al.,
 *    ITS '04).
 *  - **The programmes that score process score it the other way round.**
 *    PISA 2012 problem solving gives full credit only BELOW a click budget;
 *    USMLE Step 3 CCS states plainly that an unnecessary and excessive order
 *    DECREASES the score. This formula has no zero region and no negative
 *    region — it is monotone in volume, which is the shape those programmes
 *    penalise. NAEP and PIAAC collect process data and do not score it.
 *  - **Our own constants made it worse.** Full credit at three distinct
 *    strings and three closed cycles, with distinctness by exact trimmed,
 *    case-folded text, so the component saturates almost immediately and
 *    stops discriminating — while the candidate who solves the brief in two
 *    precise prompts is docked points for efficiency.
 *
 * Collecting is defensible; scoring is the trap. So it stays here, computed
 * and stored, exactly as it was — it is research data, and a measure nobody
 * is paid for is a measure worth studying. `.research/ten-80-process-evidence.md`
 * has the full source ledger.
 *
 * The formula itself is UNCHANGED, so a stored `process.signal` from before
 * this decision still means what it meant. It counts distinct instructions to
 * the assistant, each followed by a change to the artefact:
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
  // DIAGNOSTIC ONLY, and deliberately after `scaled` is complete: it is added
  // to `raw` and to nothing else, so no prompt-log volume can move the score.
  // See {@link processSignal} for why (TEN-80).
  raw["process.signal"] = round3(processSignal(inputs.artifact));
  return { raw, scaled: round3(scaled) };
}

