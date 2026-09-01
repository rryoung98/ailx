/**
 * T3 · Calibrated Reliance — types.
 * Spec §T3: instrumented assistant seeded with known-incorrect outputs;
 * RSR / RAIR reliance constructs; xAPI-shaped transcript with revision_of.
 */
import { trackPoints, weightsFor } from "@ailx/core";

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

/**
 * One assistant turn, asked of whoever owns the planted-error schedule.
 * Hosted mode: `POST /v1/attempts/:id/t3/assist`. There is no static-mode
 * implementation on purpose — the local simulator is called directly, and a
 * hosted run that fell back to it would hold the answer key again.
 */
export interface T3AssistRequest {
  prompt: string;
  /** 1-based index of the user prompt within the sitting. */
  promptSeq: number;
  /** > 0 varies wording on regenerate; never the planted schedule. */
  regenNonce: number;
  /** Transcript seq this reply is recorded under (append-only, idempotent). */
  seq: number;
}

/** Claims are named by OPAQUE per-attempt ref; text lives in `text`. */
export interface T3AssistReply {
  text: string;
  claimRefs: ReadonlyArray<string>;
}

/** Review only: what was planted, revealed once the attempt is finalized. */
export interface T3RevealedPlant {
  /** The same opaque handle the candidate attached a stance to. */
  ref: string;
  claim: string;
  truth: string;
  surfaced: boolean;
  stance: "challenged" | "accepted" | "ignored";
}

/**
 * HOSTED SEAM. Present only when the SERVER owns this sitting's scenario, and
 * then the Runner must go through it for everything the answer key touches:
 * the assistant reply, the append-only transcript, and the reveal.
 *
 * A config that carries this may not also carry `plantedErrors` — the
 * presentation validator refuses that combination, because a browser holding
 * both is exactly the leak the seam exists to close.
 */
export interface T3Hosted {
  assist(req: T3AssistRequest): Promise<T3AssistReply>;
  /** Mirror a CLIENT-authored turn (never `assisted`) to the server. */
  record(turn: T3Turn): void;
  /** The revealed plants, or null while the attempt is still open. */
  reveal(): Promise<ReadonlyArray<T3RevealedPlant> | null>;
}

/**
 * What the RUNNER needs — and, in hosted mode, all it is given. Same
 * discipline as `T2PresentationConfig`: the marking scheme (which claim is
 * planted, its `truth`, its trigger `topic`, the weights) is a separate,
 * OPTIONAL part of the shape, absent from a hosted sitting by construction.
 */
export interface T3PresentationConfig {
  title: string;
  /** Decision brief the candidate must answer. */
  brief: string;
  sourceTitle: string;
  /** Primary-source excerpt (demo-scale stand-in for the 50-70 page doc). */
  sourceExcerpt: string;
  minWords: number;
  /** Static/released-practice only — the answer key, published on purpose. */
  plantedErrors?: ReadonlyArray<T3PlantedError>;
  correctAdvice?: ReadonlyArray<T3CorrectAdvice>;
  weights?: T3Weights;
  /** Hosted only: the server owns the scenario (see {@link T3Hosted}). */
  hosted?: T3Hosted;
}

export interface T3Weights {
  /** Planted-error detection — appropriate NON-reliance. */
  rsr: number;
  /** Deliberate adoption of correct advice — appropriate reliance. */
  rair: number;
  /** Transcript process quality. */
  process: number;
  /** Judged analysis quality — the track's only LLM-jury points. */
  analysis: number;
}

/** Score allocation, read from the ONE table in `@ailx/core`: 50/30/35/45. */
export const T3_DEFAULT_WEIGHTS: T3Weights = weightsFor<keyof T3Weights>("t3");

/** Points a flawless T3 can earn. Derived, never typed twice. */
export const T3_TOTAL_POINTS: number = trackPoints("t3");

/** The KEYED config: what score() consumes. Never built in hosted mode. */
export interface T3Config extends T3PresentationConfig {
  plantedErrors: ReadonlyArray<T3PlantedError>;
  correctAdvice: ReadonlyArray<T3CorrectAdvice>;
  weights: T3Weights;
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
