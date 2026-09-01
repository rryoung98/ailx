/** Types for T1 · Creative Build (spec §T1, §12, §14). */

import { trackPoints, weightsFor } from "@ailx/core";

export interface T1Config {
  /** Brief shown to the candidate. */
  brief: string;
  /** Required content elements — machine-checkable brief compliance. */
  requiredElements: string[];
  /** Max chars for the design-rationale self report (spec: ~200 words). */
  selfReportMaxChars: number;
}

export interface T1Session {
  attemptId: string;
  trackId: string;
}

export interface PromptLogEntry {
  /** 'prompted' — asked the assistant; 'revised' — the artifact changed after. */
  kind: "prompted" | "revised";
  prompt?: string;
  /** Which model produced/drove this entry (e.g. 'demo-assist@1' or an OpenRouter model id). */
  modelId?: string;
  /** ISO timestamp captured client-side (never read inside score()). */
  clientTs: string;
}

export interface T1Artifact {
  /** Single self-contained HTML document. */
  html: string;
  /** Required submission artifact, not a confession (spec §T1). */
  promptLog: PromptLogEntry[];
  /** 200-word statement of intent. */
  selfReport: string;
}

export interface T1Score {
  raw: Record<string, number>;
  scaled: number;
}

/**
 * Judgment dimensions consumed by score(), all values in [0,1]:
 *  - 'functional'   screening gate findings (render, viewports, contrast,
 *                   landmarks, keyboard, perf budget, brief elements)
 *  - 'comparative'  Bradley–Terry scaled position from blinded pairwise
 *                   human judgement (stored, never computed here)
 *  - 'ambition'     technical ambition confirmed purposeful by judge
 *  - 'rationale'    coherence of stated intent vs delivered artifact
 *
 * NOT a judgment dimension: 'process'. It is derived from the stored prompt
 * log by {@link processSignal} with no judge in it at all, which is the whole
 * reason it now carries points.
 */
export const T1_DIMENSIONS = [
  "functional",
  "comparative",
  "ambition",
  "rationale",
] as const;

export type T1Dimension = (typeof T1_DIMENSIONS)[number];
export type T1Component = T1Dimension | "process";

/**
 * Score allocation — spec §T1, derived from the ONE allocation table in
 * `@ailx/core` so this file cannot drift from the spec or from the report's
 * component list. 160 points: 40 gates, 60 comparative, 20 ambition,
 * 15 rationale, 25 process.
 */
export const T1_WEIGHTS: Record<T1Component, number> = weightsFor<T1Component>("t1");

/** Points a flawless T1 can earn. Derived, never typed twice. */
export const T1_TOTAL_POINTS: number = trackPoints("t1");
