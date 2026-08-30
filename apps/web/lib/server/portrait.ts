/**
 * The player-type character, as bytes the OG rasterizer can draw.
 *
 * `next/og` (satori) has no DOM and no stylesheet: an `<img>` in the card
 * tree needs a data URL or a fetchable absolute URL, and a raster format —
 * JPEG or PNG, never SVG or WebP. The cast is JPEG for exactly that reason.
 *
 * We inline the bytes here rather than handing satori a URL so the failure
 * mode is ours: a CDN hiccup returns `null` and the card renders without a
 * portrait (the code, name and tagline are still on it), instead of throwing
 * inside the rasterizer and turning one share link into a 500.
 *
 * The read is one same-origin GET per character per warm instance; only
 * SUCCESSES are memoised, so a transient failure does not permanently
 * un-draw a character.
 */
import { playerCharacter } from "@ailx/report";
import { assetUrl } from "../mode";

const cache = new Map<string, string>();

export async function characterDataUrl(code: string, origin: string): Promise<string | null> {
  const character = playerCharacter(code);
  if (character === null) return null;
  const url = `${origin}${assetUrl(`/${character.src}`)}`;
  const hit = cache.get(url);
  if (hit !== undefined) return hit;
  try {
    const response = await fetch(url);
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.startsWith("image/")) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    const data = `data:${type};base64,${bytes.toString("base64")}`;
    cache.set(url, data);
    return data;
  } catch (err) {
    console.error("[ailx character portrait]", err);
    return null;
  }
}
