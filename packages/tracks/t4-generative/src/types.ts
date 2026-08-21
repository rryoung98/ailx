/** Types for T4 · Generative Direction (spec §T4). */

export interface T4Config {
  /** Communicative brief: names what the viewer should understand. */
  brief: string;
  /** Stated audience. */
  audience: string;
  /** Final-render quota — "generation quota as a resource" (spec §13). */
  maxGenerations: number;
  /** Max chars for the direction note. */
  noteMaxChars: number;
}

export interface T4Session {
  attemptId: string;
  trackId: string;
}

export interface T4Generation {
  /** 0-based generation index — order matters for steering efficiency. */
  index: number;
  prompt: string;
  /** Deterministic demo render (SVG markup) of the prompt. */
  svg: string;
  clientTs: string;
}

export interface T4Artifact {
  /** Full prompt chain, in order. */
  generations: T4Generation[];
  /** Index into generations of the candidate's chosen output. */
  chosenIndex: number;
  /** Direction note: what the work should communicate and why it does. */
  note: string;
}

export interface T4Score {
  raw: Record<string, number>;
  scaled: number;
}

/**
 * Judgment dimensions consumed by score(), values in [0,1]:
 *  - 'brief-fit'    blind-viewer agreement with the brief's stated intent
 *  - 'comparative'  Bradley–Terry scaled position from blinded pairwise
 *  - 'generation'   per-generation judge value; `sample` = generation index
 *                   (feeds steering efficiency)
 *  - 'direction-note' coherence/diagnosticity of the direction note
 *  - 'provenance'   disclosure & attribution hygiene
 */
export const T4_DIMENSIONS = [
  "brief-fit",
  "comparative",
  "craft",
  "provenance",
] as const;

/** Score allocation — spec §T4 "Score allocation". */
export const T4_WEIGHTS: Record<(typeof T4_DIMENSIONS)[number], number> = {
  "brief-fit": 30,
  comparative: 40,
  craft: 20,
  provenance: 10,
};
