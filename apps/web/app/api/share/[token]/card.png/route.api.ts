import { ImageResponse } from "next/og";
import { handleViewShare } from "@ailx/backend";
import { pageOrigin, withApiContext, type ShareRouteContext } from "../../../../../lib/server/api";
import { characterDataUrl } from "../../../../../lib/server/portrait";
import {
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  shareCardElement,
} from "../../../../../lib/shareCardArt";
import type { SharePayload } from "@ailx/report";

/**
 * GET /api/share/:token/card.png — the og:image for a share view.
 *
 * Unauthenticated for the same reason the view is: the token is the
 * capability. Revoked/unknown tokens 404 rather than rendering a placeholder,
 * so a revoked card also disappears from every social cache that re-fetches.
 * Rendered from the FROZEN payload, so the preview shows exactly what the
 * page shows — including the player-type character, fetched same-origin and
 * inlined as bytes because satori cannot read a stylesheet or an SVG.
 */
export async function GET(_req: Request, { params }: ShareRouteContext): Promise<Response> {
  const { token } = await params;
  try {
    const result = await withApiContext((ctx) => handleViewShare(ctx, token));
    if (result.status !== 200) {
      return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    }
    const payload = (result.body.share as { payload: SharePayload }).payload;
    // The character is loaded HERE, not inside the card tree, so the tree
    // stays pure and a failed read degrades to a portrait-less card.
    const portrait = await characterDataUrl(payload.playerType.code, await pageOrigin());
    return new ImageResponse(shareCardElement(payload, portrait), {
      width: SHARE_CARD_WIDTH,
      height: SHARE_CARD_HEIGHT,
      headers: {
        // Short cache: long enough for a scraper burst, short enough that a
        // revoked link stops previewing quickly.
        "cache-control": "public, max-age=300",
        "x-robots-tag": "noindex",
      },
    });
  } catch (err) {
    console.error("[ailx share card]", err);
    return new Response("card unavailable", { status: 500, headers: { "content-type": "text/plain" } });
  }
}
