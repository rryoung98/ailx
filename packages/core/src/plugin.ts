/**
 * Track plugin interface — spec §14 "Track plugin interface", apiVersion 2.
 * Adding a track means a new package directory and a plugin implementation.
 * Zero platform changes.
 */

export interface TrackCtx {
  attemptId: string;
  trackId: string;
  locale: "en" | "ja" | "ko";
  /** Append-only event emitter (xAPI-shaped). */
  emit(event: TrackEvent): Promise<void>;
}

export interface TrackEvent {
  verb: "prompted" | "revised" | "regenerated" | "submitted" | string;
  object: string;
  result?: unknown;
  context?: Record<string, unknown>;
  clientTs: string;
}

export interface Upload {
  kind: string;
  bytes?: Uint8Array;
  json?: unknown;
}

export interface StageSpec {
  /** e.g. 'capture', 'judge-t1', 'aggregate' */
  id: string;
  queue: string;
  /** Retry/rate config is data, not code. */
  maxAttempts: number;
}

/**
 * Inputs to score() are STORED artifacts and STORED judgments.
 * Model calls happen in pipeline() stages; their outputs are persisted
 * and replayed here. That is what makes re-scoring deterministic.
 *
 * READ THIS BEFORE BUILDING THE T3/T4 JUDGING PIPELINE.
 *
 * An LLM judge is NOT reproducible, not even at temperature 0 (batching,
 * kernel and serving-stack non-determinism; see Lau, arXiv 2603.04417). So the
 * repo invariant — "any score ever issued is byte-identically recomputable
 * from stored inputs" — is only true because the judge's OUTPUT *is* one of
 * those stored inputs. Judging is an evidence-COLLECTION step inside
 * pipeline(); its result is persisted, content-addressed with judgmentId(),
 * and replayed. score() never calls a judge, so:
 *
 *   re-SCORING is reproducible.  re-JUDGING is not.
 *
 * Both halves of that sentence have to be said out loud. A pipeline that
 * re-invokes the judge on audit and compares numbers will disagree with
 * itself, and that would be our failure, not the auditor's.
 */
export interface ScoreInputs<Artifact> {
  artifact: Artifact;
  judgments: ReadonlyArray<Judgment>;
  rubricVersion: string;
}

/**
 * One stored judge output — an INPUT to score(), never something score()
 * derives. Immutable once written: a re-judge is a NEW row under a new
 * rubricVersion (or a new sample), never an update, for the same reason an
 * edited item is a new item.
 */
export interface Judgment {
  dimension: string;
  sample: number;
  value: number;
  evidence?: string;
  modelId: string;
}

export interface TrackScore {
  raw: Record<string, number>;
  scaled: number;
}

export interface TrackPlugin<Config, Session, Artifact, Score extends TrackScore> {
  readonly id: string;
  readonly apiVersion: 2;

  /** CI gate at build time. Throws on invalid config. */
  validateConfig(raw: unknown): Config;
  startSession(ctx: TrackCtx, cfg: Config): Promise<Session>;
  /** Idempotent. */
  ingest(ctx: TrackCtx, s: Session, payload: Upload): Promise<Artifact>;
  /** Declares async stages the platform must enqueue. Data, not code. */
  pipeline(cfg: Config): StageSpec[];
  /** PURE. No network, no clock, no randomness. Same inputs -> same score. */
  score(inputs: ScoreInputs<Artifact>, cfg: Config): Score;

  /** Lazy UI loader — the platform must not hardcode track imports. */
  ui?: () => Promise<{ Runner: unknown }>;
}
