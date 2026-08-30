/**
 * The player-type CAST: one character per code, and the line it says to you.
 *
 * `playerType.ts` decides WHICH of the sixteen types a run is, and owns the
 * name and the tagline. This module owns the face and the voice, because the
 * player-type card is the surface people actually share (docs/UX-DIRECTION.md:
 * "the player-type card is our owl") and four letters do not travel in a feed.
 *
 * The picture is never the only carrier of meaning. Every surface that draws
 * a character also prints the code, the name and the tagline as text, and the
 * asset carries alt text that describes the drawing rather than repeating the
 * type — so the card still works with images off, in a text-only reader, and
 * for a screen-reader user (FRONTEND.md a11y rules).
 *
 * The data is GENERATED into `characterCast.ts` from
 * `instruments/characters/2026.1/`; this module is the hand-written half: the
 * shape, the lookup, and the reason both exist.
 */
import { CHARACTER_CAST, CHARACTER_STYLE_PROMPT } from "./characterCast.js";

export interface CharacterCredit {
  /** Only value today; the field exists so a hand-drawn cast can replace one. */
  origin: "generated";
  model: string;
  provider: string;
  /**
   * This character's own line of the prompt. The shared style paragraph is
   * carried once as `CHARACTER_STYLE_PROMPT`; `characterPrompt()` rebuilds
   * the exact string the model was given.
   */
  subject: string;
  author: string;
  license: string;
  generated: string;
  vetted: string;
  derivative: string;
  /** The quoted provider term that lets us republish the picture. */
  rights_basis: string;
}

export interface PlayerCharacter {
  /** The four-letter player-type code this character belongs to. */
  code: string;
  /** Stable, human-readable id for the drawing (also the ledger key). */
  slug: string;
  /** Path under `apps/web/public`, without a leading slash or basePath. */
  src: string;
  /** Describes the DRAWING. Never states the verdict — the text does that. */
  alt: string;
  /** What this character says to you about your run. Honest, never flattering. */
  voice: string;
  credit: CharacterCredit;
}

const BY_CODE: ReadonlyMap<string, PlayerCharacter> = new Map(
  CHARACTER_CAST.map((c) => [c.code, c]),
);

/**
 * The character for a type code, or `null`.
 *
 * Null rather than throw: a share payload is FROZEN JSON that may have been
 * written by an older build, and an unknown code must degrade to a card
 * without a picture — never a 500 on somebody's share link or a blank
 * gallery wall.
 */
export function playerCharacter(code: string): PlayerCharacter | null {
  return BY_CODE.get(code) ?? null;
}

/** The full prompt a character was drawn from — style preamble plus subject. */
export function characterPrompt(character: PlayerCharacter): string {
  return `${CHARACTER_STYLE_PROMPT} ${character.credit.subject}`;
}

export { CHARACTER_CAST, CHARACTER_CAST_VERSION, CHARACTER_STYLE_PROMPT } from "./characterCast.js";
