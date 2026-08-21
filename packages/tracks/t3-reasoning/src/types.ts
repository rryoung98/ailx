/**
 * T3 · AI-Assisted Reasoning — types.
 * Spec §T3: instrumented assistant seeded with known-incorrect outputs;
 * RSR / RAIR reliance constructs; xAPI-shaped transcript with revision_of.
 */

export interface T3PlantedError {
  id: string;
  /** Trigger topic: the claim surfaces when a prompt mentions this. */
  topic: string;
  /** The plausible-but-wrong claim the assistant will assert. */
  claim: string;
  /** What the primary source actually says (shown in the end-of-track reveal). */
  truth: string;
}

export interface T3CorrectAdvice {
  id: string;
  topic: string;
  /** Correct, source-grounded claim — adopting it after resistance is RAIR. */
  claim: string;
}

export interface T3Config {
  title: string;
  /** Decision brief the candidate must answer. */
  brief: string;
  sourceTitle: string;
  /** Primary-source excerpt (demo-scale stand-in for the 50-70 page doc). */
  sourceExcerpt: string;
  plantedErrors: ReadonlyArray<T3PlantedError>;
  correctAdvice: ReadonlyArray<T3CorrectAdvice>;
  minWords: number;
  weights: {
    rsr: number;       // planted-error detection, 25
    analysis: number;  // judged analysis quality, 45
    process: number;   // transcript process quality, 20
    rair: number;      // appropriate reliance, 10
  };
}

/** One xAPI-ish transcript row. Append-only; revisionOf builds the chain. */
export interface T3Turn {
  seq: number;
  verb: "prompted" | "assisted" | "revised" | "regenerated" | "verified"
    | "challenged" | "accepted" | "submitted";
  /** e.g. 'prompt:3', 'draft:rev-2', 'claim:pe-1', 'source' */
  object: string;
  text?: string;
  /** For 'revised'/'regenerated': the object this supersedes. */
  revisionOf?: string;
  /** Claim ids (planted or correct-advice) embedded in an assistant turn. */
  claimIds?: ReadonlyArray<string>;
  clientTs: string;
}

export interface T3Artifact {
  transcript: ReadonlyArray<T3Turn>;
  finalAnswer: string;
}

export interface T3Session {
  attemptId: string;
}
