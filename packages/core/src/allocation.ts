/**
 * SCORE ALLOCATION — the one place the instrument's point budget is written.
 *
 * Spec §04 makes a safety claim about how a score is resolved: "no track is
 * scored the same way as any other", so a discovered flaw in one scoring
 * MECHANISM cannot compromise the whole examination. That claim is a number,
 * and a number in prose goes stale the moment code moves. It went stale: the
 * spec said 40-45 points of 400 were exposed to LLM-judge methodology while
 * the built system resolved 241 of 400 through stored judge values.
 *
 * So the allocation lives here, as data, next to the plugin interface every
 * track already imports — and `AILX-Spec-2026.1.md` §04 is checked against it
 * by `packages/core/test/spec-allocation.test.ts`, which parses §04's
 * mechanism table and asserts it against this data. The allocation NUMBERS
 * themselves are pinned separately by `packages/core/test/allocation.test.ts`.
 * Track weights, the report's component tables and the composite's track
 * weights all derive from it. There is no second copy to drift.
 *
 * The four resolution mechanisms are deliberately distinct, and the
 * distinction is the whole point of the design principle:
 *
 *  - `model-free`   arithmetic on stored response/transcript data. No model,
 *                   no rater, no rubric. Recomputable by hand.
 *  - `machine-gate` an objectively checkable property (does it render, is the
 *                   contrast ratio met, is the required element present). A
 *                   vision model may FIND the evidence, but the finding is
 *                   checkable without trusting the model's taste.
 *  - `human-cj`     blinded forced-choice pairwise comparison by humans,
 *                   fitted with Bradley-Terry. No model in the loop.
 *  - `llm-judge`    a locked-rubric LLM jury. The mechanism §04's safety
 *                   claim is about.
 *
 * `implemented` is the honesty flag. A component whose measurement does not
 * exist yet is marked false HERE, so the spec, the report and any audit read
 * the same list rather than inferring existence from a stub that returns a
 * number.
 */

/** How a component's points are resolved. See the module comment. */
export type Resolution = "model-free" | "machine-gate" | "human-cj" | "llm-judge";

export const RESOLUTIONS: readonly Resolution[] = [
  "model-free",
  "machine-gate",
  "human-cj",
  "llm-judge",
] as const;

export interface ComponentAllocation {
  /** Stable key. For judged components this is the judgment `dimension`. */
  readonly key: string;
  /**
   * `criteria[].id` in the instrument package's `rubric.yaml`. The published
   * allocation a candidate is entitled to see is the same allocation score()
   * uses, and `packages/content-tools/test/instrument-demo-2026.1.test.ts`
   * checks the two against each other rather than against a typed copy.
   */
  readonly rubricId: string;
  readonly label: string;
  readonly points: number;
  readonly resolvedBy: Resolution;
  /**
   * False when the measurement the spec describes does not exist in code.
   * A false here is a claim the instrument may not make.
   */
  readonly implemented: boolean;
  /** Why `implemented` is false, or what the component actually consumes. */
  readonly note?: string;
}

export interface TrackAllocation {
  readonly code: "T1" | "T2" | "T3" | "T4";
  readonly construct: string;
  /**
   * False for a SHOWCASE track: it is still run, still recorded and still
   * reported, but it contributes no points and no composite weight.
   */
  readonly scored: boolean;
  /** Share of the composite. Proportional to `points`; scored tracks sum to 1. */
  readonly compositeWeight: number;
  readonly components: readonly ComponentAllocation[];
}

/**
 * T1 · Creative Build — 160 pts, the flagship.
 *
 * `process` is new and it is the point of the promotion: the prompt-log
 * signal `score.ts` already computed was reported and then discarded, so the
 * only evidence separating "directed a model well" from "already knew how to
 * build a website" earned nothing.
 */
const T1: TrackAllocation = {
  code: "T1",
  construct: "Directed creative build — take a brief to a shipped artefact with a model",
  scored: true,
  compositeWeight: 0.4,
  components: [
    {
      key: "functional",
      rubricId: "functional-gates",
      label: "Functional & accessibility gates",
      points: 40,
      resolvedBy: "machine-gate",
      implemented: false,
      note:
        "No contrast, viewport, landmark or keyboard check exists. Today the " +
        "dimension is a stored judgment median like any other.",
    },
    {
      key: "comparative",
      rubricId: "comparative-merit",
      label: "Comparative visual merit",
      points: 60,
      resolvedBy: "human-cj",
      implemented: false,
      note:
        "Bradley-Terry is not implemented anywhere in either repository. The " +
        "stage id 'pairwise-comparative' enqueues to the human-cj queue; no " +
        "fit consumes it.",
    },
    {
      key: "ambition",
      rubricId: "technical-ambition",
      label: "Technical ambition",
      points: 20,
      resolvedBy: "llm-judge",
      implemented: true,
    },
    {
      key: "rationale",
      rubricId: "design-rationale",
      label: "Design rationale",
      points: 15,
      resolvedBy: "llm-judge",
      implemented: true,
    },
    {
      key: "process",
      rubricId: "process-signal",
      label: "Prompt-log process signal",
      points: 25,
      resolvedBy: "model-free",
      implemented: true,
    },
  ],
};

/**
 * T2 · Synthetic-Media Discrimination — 80 pts, demoted and renamed.
 *
 * The construct is NOT "AI literacy": the reliable variance in a d' score is
 * a mixture of a training-resistant perceptual aptitude, familiarity with
 * this year's generators, and occupational exposure. The component that does
 * move with instruction is the CRITERION, and it used to be excluded from the
 * point total by design. It is now scored.
 */
const T2: TrackAllocation = {
  code: "T2",
  construct:
    "Synthetic-media discrimination — sensitivity AND criterion, not AI literacy",
  scored: true,
  compositeWeight: 0.2,
  components: [
    {
      key: "sensitivity",
      rubricId: "sensitivity",
      label: "Sensitivity (d')",
      points: 25,
      resolvedBy: "model-free",
      implemented: true,
    },
    {
      key: "criterion",
      rubricId: "criterion",
      label: "Criterion placement (|c|)",
      points: 15,
      resolvedBy: "model-free",
      implemented: true,
    },
    {
      key: "calibration",
      rubricId: "calibration",
      label: "Calibration (Brier)",
      points: 25,
      resolvedBy: "model-free",
      implemented: true,
    },
    {
      key: "provenance",
      rubricId: "provenance-reasoning",
      label: "Provenance reasoning",
      points: 15,
      resolvedBy: "model-free",
      implemented: true,
    },
  ],
};

/**
 * T3 · Calibrated Reliance — 160 pts, the centre of the instrument.
 *
 * The named construct is knowing when NOT to use the model, measured
 * two-tailed: RSR is the non-reliance half (did you reject seeded wrong
 * output), RAIR is the positive half (did you adopt correct advice after
 * deliberating). Over-reliance and under-reliance are both failures, so the
 * reported index is signed and the two halves carry points separately.
 */
const T3: TrackAllocation = {
  code: "T3",
  construct:
    "Calibrated reliance — when to use the model and when not to, measured two-tailed",
  scored: true,
  compositeWeight: 0.4,
  components: [
    {
      key: "rsr",
      rubricId: "planted-error-detection",
      label: "Planted-error detection (RSR)",
      points: 50,
      resolvedBy: "model-free",
      implemented: true,
    },
    {
      key: "rair",
      rubricId: "appropriate-reliance",
      label: "Deliberate adoption of correct advice (RAIR)",
      points: 30,
      resolvedBy: "model-free",
      implemented: true,
    },
    {
      key: "process",
      rubricId: "process-quality",
      label: "Process quality",
      points: 35,
      resolvedBy: "model-free",
      implemented: true,
    },
    {
      key: "analysis",
      rubricId: "analysis-quality",
      label: "Analysis quality",
      points: 45,
      resolvedBy: "llm-judge",
      implemented: false,
      note:
        "The heterogeneous three-family jury is one stub returning three " +
        "seeded samples, and the ~200-example human-labelled calibration set " +
        "the QWK 0.708-0.712 result depends on does not exist.",
    },
  ],
};

/**
 * T4 · Generative Direction — SHOWCASE, 0 scored points.
 *
 * Demoted rather than deleted: the runner, the brief and the public gallery
 * are good product and they stay. What it may no longer do is issue points.
 * It duplicated T1's construct and T1's Bradley-Terry machinery, 70 of its
 * 100 points needed human panels a probability panel cannot supply, and its
 * governance model (a human approves every published asset) does not survive
 * the cohort sizes the population statistic needs.
 *
 * `score()` still runs and still records a 0-100 SHOWCASE INDEX in the raw
 * record — it is useful research data and it costs nothing to keep — but it
 * is not a score of record and it carries no composite weight.
 */
const T4: TrackAllocation = {
  code: "T4",
  construct: "Generative direction — unscored showcase",
  scored: false,
  compositeWeight: 0,
  components: [],
};

export type AllocatedTrackId = "t1" | "t2" | "t3" | "t4";

export const SCORE_ALLOCATION: Readonly<Record<AllocatedTrackId, TrackAllocation>> = {
  t1: T1,
  t2: T2,
  t3: T3,
  t4: T4,
};

export const ALLOCATED_TRACK_IDS: readonly AllocatedTrackId[] = ["t1", "t2", "t3", "t4"];

/** Track ids that issue points and carry composite weight. */
export const SCORED_TRACK_IDS: readonly AllocatedTrackId[] = ALLOCATED_TRACK_IDS.filter(
  (t) => SCORE_ALLOCATION[t].scored,
);

/** Total points for one track. 0 for a showcase track. */
export function trackPoints(id: AllocatedTrackId): number {
  return SCORE_ALLOCATION[id].components.reduce((s, c) => s + c.points, 0);
}

/** The instrument total. Spec §04 quotes it; the test below pins it. */
export const TOTAL_POINTS: number = ALLOCATED_TRACK_IDS.reduce(
  (s, t) => s + trackPoints(t),
  0,
);

/**
 * Points resolved by each mechanism, across the scored instrument.
 * This is the §04 safety claim, computed rather than asserted.
 */
export function pointsByResolution(): Record<Resolution, number> {
  const out = { "model-free": 0, "machine-gate": 0, "human-cj": 0, "llm-judge": 0 };
  for (const t of ALLOCATED_TRACK_IDS) {
    for (const c of SCORE_ALLOCATION[t].components) out[c.resolvedBy] += c.points;
  }
  return out;
}

/** Points a track resolves through one mechanism. */
export function trackPointsByResolution(
  id: AllocatedTrackId,
  resolution: Resolution,
): number {
  return SCORE_ALLOCATION[id].components
    .filter((c) => c.resolvedBy === resolution)
    .reduce((s, c) => s + c.points, 0);
}

/**
 * Points whose measurement does not exist yet. The instrument may report
 * these as a band with a stated error; it may not report them as a
 * measurement of the thing the spec names.
 */
export function unimplementedPoints(): number {
  let n = 0;
  for (const t of ALLOCATED_TRACK_IDS) {
    for (const c of SCORE_ALLOCATION[t].components) if (!c.implemented) n += c.points;
  }
  return n;
}

/** Weights per component key, for a track's `score()`. */
export function weightsFor<K extends string>(
  id: AllocatedTrackId,
): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const c of SCORE_ALLOCATION[id].components) out[c.key as K] = c.points;
  return out;
}
