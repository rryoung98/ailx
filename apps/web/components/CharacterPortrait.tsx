/**
 * The player-type CHARACTER on screen — the one component every surface uses.
 *
 * Report, share view, gallery tile and the reviewer queue all draw the same
 * face at different sizes, so the lookup, the alt text and the sizing rule
 * live here once. (The OG card cannot use this: `next/og` rasterizes a
 * separate element tree with no DOM and no stylesheet — see `shareCardArt`.)
 *
 * THE PICTURE IS NEVER THE MESSAGE. Every caller prints the code, the name
 * and the tagline as text next to it; the portrait carries alt text that
 * describes the DRAWING, so nothing is lost with images off or in a screen
 * reader. An unknown code renders nothing rather than a broken tile.
 */
import { playerCharacter } from "@ailx/report";
import { assetUrl } from "../lib/mode";

export function CharacterPortrait({
  code,
  size = 96,
  className = "",
}: {
  code: string;
  size?: number;
  className?: string;
}) {
  const character = playerCharacter(code);
  if (character === null) return null;
  return (
    <img
      className={`character-portrait ${className}`.trim()}
      src={assetUrl(`/${character.src}`)}
      alt={character.alt}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      loading="lazy"
      decoding="async"
    />
  );
}

/**
 * What the character says about your run. Honest by construction: the lines
 * are written per type in `instruments/characters/2026.1/cast.json` and match
 * the tagline's register — a weak run is told so.
 */
export function CharacterVoice({ code, className = "" }: { code: string; className?: string }) {
  const character = playerCharacter(code);
  if (character === null) return null;
  return <p className={`character-voice ${className}`.trim()}>{character.voice}</p>;
}
