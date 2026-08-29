import { ImageResponse } from "next/og";
import { handleViewShare } from "@ailx/backend";
import { withApiContext, type ShareRouteContext } from "../../../../../lib/server/api";
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
 * page shows.
 */
export async function GET(_req: Request, { params }: ShareRouteContext): Promise<Response> {
  const { token } = await params;
  try {
    const result = await withApiContext((ctx) => handleViewShare(ctx, token));
    if (result.status !== 200) {
      return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    }
    const payload = (result.body.share as { payload: SharePayload }).payload;
    return new ImageResponse(shareCardElement(payload), {
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
