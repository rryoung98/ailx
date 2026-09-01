/**
 * T2 · Synthetic-Media Discrimination — types.
 * Spec §T2: swipe/judgement deck over content-addressed items, confidence
 * as a second response, replay phase teaching rationale + provenance.
 */
import { trackPoints, weightsFor } from "@ailx/core";

/** The four scored components of T2. Keys match the allocation table. */
export interface T2Weights {
  /** Sensitivity, d′ — how well signal and noise are told apart. */
  sensitivity: number;
  /** Criterion placement, |c| — how far the decision threshold sits from unbiased. */
  criterion: number;
  /** Brier calibration over the confidence taps. */
  calibration: number;
  /** Difficulty-weighted accuracy on the untimed provenance block. */
  provenance: number;
}

/** Score allocation, read from the ONE table in `@ailx/core`. */
export const T2_DEFAULT_WEIGHTS: T2Weights = weightsFor<keyof T2Weights>("t2");

/** Points a flawless T2 can earn. Derived, never typed twice. */
export const T2_TOTAL_POINTS: number = trackPoints("t2");

export type T2ItemType =
  | "media-image"
  | "media-video"
  | "media-audio"
  | "message-email"
  | "message-page"
  | "provenance";

/**
 * The fields a candidate may HOLD while sitting the deck — everything needed
 * to present an item and nothing that gives its answer away.
 *
 * This is split out of {@link T2Item} because a hosted sitting is served by
 * `GET /api/attempts/:id/items`, which redacts `key` and `rationale` until
 * the attempt is finalized (docs/ARCHITECTURE.md §4). Presentation must be
 * constructible from those bytes alone; a validator that demanded a key would
 * demand exactly the secret the browser is not allowed to have.
 *
 * `signal` stays here on purpose: it names which OPTION means "AI /
 * synthetic / hostile", which is a property of the option list, not of this
 * item's answer.
 */
export interface T2PresentedItem {
  /** Content-addressed: sha256(canonical_json(item-sans-id)) upstream. */
  id: string;
  type: T2ItemType;
  /** Question stem shown above the material. */
  stem: string;
  /** HTML-safe text, or an inline SVG data-uri rendered as an image. */
  material: string;
  /** Response options. Binary blocks use exactly two. */
  options: ReadonlyArray<string>;
  /**
   * Index into options that counts as the SIGNAL call (synthetic / hostile)
   * for signal-detection scoring. Ignored for provenance items.
   */
  signal?: number;
  /** 0 (easy) .. 1 (hard). Drives difficulty weighting. */
  difficulty: number;
  /** Fixed exposure in seconds (declared measurement decision). */
  exposureSeconds?: number;
}

/**
 * A presented item PLUS the marking scheme: what `score()` consumes and what
 * the replay phase teaches. Server-side during a hosted sitting; published on
 * purpose in the released-practice tier the static demo runs on.
 */
export interface T2Item extends T2PresentedItem {
  /** Index into options of the correct answer. */
  key: number;
  /** Shown in the replay phase. */
  rationale: string;
  /** Provenance teaching point shown in the replay phase. */
  teaching?: string;
}

/** True when this item carries its own marking scheme (review/demo content). */
export function isRevealedT2Item(item: T2PresentedItem): item is T2Item {
  const it = item as Partial<T2Item>;
  return typeof it.key === "number" && typeof it.rationale === "string";
}

/**
 * What the RUNNER needs: a deck to present and the scale facts it renders.
 * Constructible with no `key` and no `rationale` — that is the point.
 */
export interface T2PresentationConfig {
  items: ReadonlyArray<T2PresentedItem>;
  /**
   * Score allocation, spec §T2 "Score allocation".
   * Defaults come from the ONE allocation table in `@ailx/core`
   * ({@link T2_DEFAULT_WEIGHTS}): 25 / 15 / 25 / 15 of 80 points.
   */
  weights: T2Weights;
  /**
   * d′ that earns full sensitivity points. Defaults to D_PRIME_CEILING
   * (3.0, spec §T2). Short demo decks pass the deck's ATTAINABLE corrected
   * d′ here: the log-linear correction caps a perfect run well below 3.0 on
   * small binary blocks, which would silently truncate the 0-100 scale.
   */
  dPrimeCeiling?: number;
  /**
   * Signed d′ that earns ZERO sensitivity points. Defaults to
   * {@link D_PRIME_FLOOR} (−1.0). It is NEGATIVE on purpose — see the
   * floor-spike note on {@link D_PRIME_FLOOR}.
   */
  dPrimeFloor?: number;
}

/**
 * What `score()` consumes: the same config, with every item's marking scheme
 * present. Server-side (or the released-practice tier) only.
 */
export interface T2Config extends T2PresentationConfig {
  items: ReadonlyArray<T2Item>;
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
