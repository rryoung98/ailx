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
  /**
   * Post-submit PRESENTATION screens (T2's replay, T3's reveal, T4's
   * delivery gallery): the scored work is already captured and nothing the
   * candidate does on the screen can change the score. The runner calls
   * this with a short screen id when such a screen opens and with `null`
   * when it closes; the session engine freezes the track clock for exactly
   * that interval (append-only `paused`/`resumed`, so the trail stays
   * recomputable). Working time is unaffected — never call it while the
   * candidate can still change a scored input.
   */
  onPresentation?(screen: string | null): void;
  /**
   * How a model call is issued.
   *
   * The host attaches WHO is asking; the runner builds WHAT is asked. No host
   * passes a provider key, because no host has one (TEN-62): in the hosted
   * build this fetch carries the sitting's identity to the exam service's
   * model gateway, which spends a key it holds sealed against that identity.
   * Undefined means "use the browser's own fetch" — the static export, whose
   * endpoint is a capped proxy or a local server, and every bare unit test.
   *
   * WHICH endpoint is not passed here: the runner reads the one shared
   * browser slot (`ailx:llm-base-url`), which the run-start panel owns.
   */
  modelFetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /**
   * Told when the runner gives up on the endpoint mid-run and falls back to
   * the offline demo assist. It is not a disconnection: a key the service
   * holds is still held. The static export uses it to clear the stored slot.
   */
  onModelDisconnect?(): void;
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
