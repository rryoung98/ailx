/** Types for T1 · Creative Build (spec §T1, §12, §14). */

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
  /** Required submission artefact, not a confession (spec §T1). */
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
 *  - 'rationale'    coherence of stated intent vs delivered artefact
 */
export const T1_DIMENSIONS = [
  "functional",
  "comparative",
  "ambition",
  "rationale",
] as const;

/** Score allocation — spec §T1 "Score allocation". */
export const T1_WEIGHTS: Record<(typeof T1_DIMENSIONS)[number], number> = {
  functional: 30,
  comparative: 40,
  ambition: 20,
  rationale: 10,
};
