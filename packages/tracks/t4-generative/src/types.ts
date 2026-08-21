/** Types for T4 · Generative Direction (spec §T4). */

export interface T4Config {
  /** Communicative brief: names what the viewer should understand. */
  brief: string;
  /** Stated audience. */
  audience: string;
  /**
   * Hard final-render quotas — spec §T4: drafts are unlimited on a fast
   * model; FINAL renders are quota-limited to three images and one video.
   */
  finalImageQuota: number;
  finalVideoQuota: number;
  /** Max chars for the direction note. */
  noteMaxChars: number;
}

export interface T4Session {
  attemptId: string;
  trackId: string;
}

/**
 * One unlimited-model draft generation. Order matters for steering.
 * A draft carries EITHER `svg` (deterministic demo render / legacy data)
 * OR `dataUri` (real OpenRouter model output, stored recompressed
 * ≤ DRAFT_MAX_BYTES). At least one is always present; old checkpoints and
 * artifacts (svg only, no modelId) decode unchanged.
 */
export interface T4Draft {
  /** 0-based draft index — order matters for steering efficiency. */
  index: number;
  prompt: string;
  /** Deterministic demo render (SVG markup) of the prompt. */
  svg?: string;
  /** Real-model render (data:image/... URI; drafts store ≤200KB copies). */
  dataUri?: string;
  /** Model that produced this draft (real id, or the labeled demo id). */
  modelId?: string;
  clientTs: string;
}

/**
 * A quota-consuming final render, promoted from a draft. Carries EITHER
 * `asset` (SVG markup — demo image, or the simulated video wrapper) OR
 * `dataUri` (full-resolution real model image). Old data (asset only)
 * decodes unchanged.
 */
export interface T4Final {
  kind: "image" | "video";
  /** Which draft was promoted. */
  fromDraftIndex: number;
  prompt: string;
  /**
   * image: SVG markup; video: animated-SVG markup (demo simulation of the
   * one-video quota — a labeled, animated still).
   */
  asset?: string;
  /** Full-resolution real-model image (finals keep the original bytes). */
  dataUri?: string;
  /** Model that produced this final (real id, or the labeled demo id). */
  modelId?: string;
  clientTs: string;
}

export interface T4Finals {
  /** Up to finalImageQuota entries. */
  images: T4Final[];
  /** At most one (finalVideoQuota). */
  video?: T4Final;
}

export interface T4Artifact {
  /** Full draft chain, in order (unlimited). */
  drafts: T4Draft[];
  /** Quota-limited final deliverables. */
  finals: T4Finals;
  /** Indices into finals.images composing the delivered set. */
  chosenSet: number[];
  /** Direction note: what the work should communicate and why it does. */
  note: string;
  /** AI-generation disclosure statement attached to the delivered set. */
  disclosed: boolean;
}

export interface T4Score {
  raw: Record<string, number>;
  scaled: number;
}

/**
 * Judgment dimensions consumed by score(), values NORMALIZED to [0,1]:
 *  - 'brief-fit'    blind-viewer agreement with the brief's stated intent
 *  - 'comparative'  Bradley–Terry scaled position from blinded pairwise
 *  - 'generation'   per-DRAFT judge value; `sample` = draft index
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
