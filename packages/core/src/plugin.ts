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
 * Inputs to score() are STORED artefacts and STORED judgments.
 * Model calls happen in pipeline() stages; their outputs are persisted
 * and replayed here. That is what makes re-scoring deterministic.
 */
export interface ScoreInputs<Artifact> {
  artifact: Artifact;
  judgments: ReadonlyArray<Judgment>;
  rubricVersion: string;
}

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
