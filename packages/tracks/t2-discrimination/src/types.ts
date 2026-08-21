/**
 * T2 · Authenticity Discrimination — types.
 * Spec §T2: swipe/judgement deck over content-addressed items, confidence
 * as a second response, replay phase teaching rationale + provenance.
 */

export type T2ItemType =
  | "media-image"
  | "media-video"
  | "media-audio"
  | "message-email"
  | "message-page"
  | "provenance";

export interface T2Item {
  /** Content-addressed: sha256(canonical_json(item-sans-id)) upstream. */
  id: string;
  type: T2ItemType;
  /** Question stem shown above the material. */
  stem: string;
  /** HTML-safe text, or an inline SVG data-uri rendered as an image. */
  material: string;
  /** Response options. Binary blocks use exactly two. */
  options: ReadonlyArray<string>;
  /** Index into options of the correct answer. */
  key: number;
  /**
   * Index into options that counts as the SIGNAL call (synthetic / hostile)
   * for signal-detection scoring. Ignored for provenance items.
   */
  signal?: number;
  /** 0 (easy) .. 1 (hard). Drives difficulty weighting. */
  difficulty: number;
  /** Shown in the replay phase. */
  rationale: string;
  /** Provenance teaching point shown in the replay phase. */
  teaching?: string;
  /** Fixed exposure in seconds (declared measurement decision). */
  exposureSeconds?: number;
}

export interface T2Config {
  items: ReadonlyArray<T2Item>;
  /** Score allocation, spec §T2 "Score allocation". Defaults 60/25/15. */
  weights: {
    sensitivity: number;
    calibration: number;
    provenance: number;
  };
}

export interface T2Response {
  itemId: string;
  /** Index into options; -1 when the exposure lapsed with no response. */
  choice: number;
  /** 0..100 confidence slider. */
  confidence: number;
  latencyMs: number;
}

export interface T2Artifact {
  responses: ReadonlyArray<T2Response>;
}

export interface T2Session {
  attemptId: string;
  startedItemIds: string[];
}
