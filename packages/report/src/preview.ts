/**
 * The PREVIEW CARD — what a visitor who has not taken part may see of somebody
 * else's run (docs/ADR-profile-and-type.md §16.5).
 *
 * The line this file draws, and it is the whole design: a preview may reveal
 * the SHAPE of what people made, and nothing that functions as an answer. So
 * this is an ALLOWLIST in the same sense as `sharePayloadFrom` — a hand-listed
 * set of fields, built by naming each one, never a `pick()` or an omission
 * over the payload. The difference matters on the day somebody adds a new
 * opt-in section: it must appear on the WALL automatically and must NOT appear
 * here automatically, and a redaction-shaped implementation would do the
 * opposite.
 *
 * Withheld, and every one of them for a stated reason: the `site` artefact (a
 * worked answer to a brief the reader has not attempted — the one case where
 * prior sight moves a number rather than a mood), the owner's `note` (their own
 * words, approved for the wall, not for a public page), the share token (a
 * capability, and a capability does not belong on a cacheable indexed page),
 * `process` (the owner's own behaviour figures, opt-in for the wall), and
 * anything item-derived, which the payload never carried in the first place.
 */
import type { TrackId } from "@ailx/session";
import type { SharePayload } from "./share.js";

export interface PreviewPole {
  readonly track: TrackId;
  readonly letter: string;
  readonly label: string;
  /** Absent on a v1/v2 card, which therefore renders no meter. */
  readonly strength?: number;
}

export interface PreviewCard {
  readonly code: string;
  readonly name: string;
  readonly tagline: string;
  readonly poles: readonly PreviewPole[];
  /** Track SHAPE: four aggregate 0-100 values. Never per item. */
  readonly tracks: Readonly<Record<TrackId, number>>;
  readonly band: string;
  /** One UTC day, or null when its owner did not opt that section in. */
  readonly completedOn: string | null;
}

/** One published card, reduced to the safe list. Pure: no clock, no store. */
export function previewCardFrom(payload: SharePayload): PreviewCard {
  return {
    code: payload.playerType.code,
    name: payload.playerType.name,
    tagline: payload.playerType.tagline,
    poles: payload.playerType.poles.map((pole) => ({
      track: pole.track,
      letter: pole.letter,
      label: pole.label,
      ...(typeof pole.strength === "number" ? { strength: pole.strength } : {}),
    })),
    tracks: { ...payload.tracks },
    band: payload.band,
    completedOn: payload.completedOn,
  };
}

/** How many cards the preview strip shows: two rows of three on a phone. */
export const PREVIEW_CARD_COUNT = 6;
