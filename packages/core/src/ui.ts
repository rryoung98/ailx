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
  value: number;        // rubric band value
  evidence: string;
  modelId: string;      // e.g. 'demo-judge@1' or 'gemini-3.1-pro@20260801'
}
