import type { TrackEvent } from "./plugin.js";

/**
 * Contract between the platform session engine (apps/web) and each track's
 * client Runner component. Static-site mode: everything runs in-browser.
 */
export interface TrackUIProps {
  attemptId: string;
  locale: "en" | "ja" | "ko";
  /** Track config parsed from the instrument package. */
  config: unknown;
  /** Emit an xAPI-shaped event (append-only). */
  onEvent(event: TrackEvent): void;
  /** Called exactly once with the track's final artifact payload. */
  onComplete(artifact: unknown): void;
  /** Seconds remaining, managed by the session engine. */
  secondsRemaining: number;
  /**
   * Checkpoint persistence. The runner MUST call onCheckpoint with a
   * JSON-serializable snapshot of its in-progress state after every
   * meaningful mutation, and MUST rehydrate from `checkpoint` when
   * remounting (pause veil, reload, resume). A timed-out track is scored
   * from the last checkpoint, never from a sentinel.
   */
  checkpoint?: unknown;
  onCheckpoint?(state: unknown): void;
}

/**
 * Judge adapter — pipeline stages call judges; score() only ever sees the
 * stored Judgment rows. In the static showcase a DeterministicDemoJudge
 * implements this; on GCP a Vertex adapter does.
 */
export interface JudgeAdapter {
  judge(req: JudgeRequest): Promise<JudgeResponse>;
}

export interface JudgeRequest {
  trackId: string;
  dimension: string;
  rubricVersion: string;
  prompt: string;
  /** Serialized artifact/evidence given to the judge. */
  material: unknown;
  sample: number;
}

export interface JudgeResponse {
  /**
   * Normalized rubric value in [0, 1]. Adapters that think in bands must
   * divide by their band maximum before returning. Consumers reject values
   * outside [0, 1].
   */
  value: number;
  evidence: string;
  modelId: string;      // e.g. 'demo-judge@1' or 'gemini-3.1-pro@20260801'
}
