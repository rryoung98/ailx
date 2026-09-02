import { ImageResponse } from "next/og";
import { apiPath } from "@ailx/contract";
import type { SharePayload } from "@ailx/report";
import { pageOrigin, serverApiBase } from "../../../../lib/server/page";
import { characterDataUrl } from "../../../../lib/server/portrait";
import {
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  shareCardElement,
} from "../../../../lib/shareCardArt";

/**
 * GET /s/:token/card.png — the og:image for a share view.
 *
 * WHY THIS ROUTE SURVIVED THE SPLIT, when every other route handler in this
 * app was deleted. It is not an exam handler and never was: it reads nothing
 * but the already-public share payload, holds no key, touches no database and
 * makes no policy decision. What it does is RASTERIZE — it is the frontend's
 * own Open Graph image, and rendering the frontend's pictures is the
 * frontend's job. Pushing it into `services/api` would put React and satori
 * inside the exam service image, which that repo is deliberately kept free of
 * (packages/track-t2/test/no-ui.test.ts is the same rule from the other side).
 *
 * It also moved OUT of `/api/`, deliberately. That prefix now means "the exam
 * service" and nothing else, so `app/api/**` is empty and a CI guard can say
 * so absolutely instead of carrying an exception. Nothing stored breaks:
 * `shareCardPath()` is computed when the page renders its meta tags, never
 * frozen into an issued payload — unlike `/api/site/<digest>`, which is.
 *
 * Unauthenticated for the same reason the view is: the token is the
 * capability. A revoked or unknown token 404s rather than rendering a
 * placeholder, so a revoked card also disappears from every social cache that
 * re-fetches it. Rendered from the FROZEN payload, so the preview shows
 * exactly what the page shows.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const notFound = (): Response =>
    new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
  try {
    // Over HTTP to the exam service, exactly as the page does — this app has
    // no store to read and no handler to call.
    const res = await fetch(`${await serverApiBase()}${apiPath("shareView", { token })}`, {
      cache: "no-store",
    });
    if (!res.ok) return notFound();
    const payload = ((await res.json()) as { share: { payload: SharePayload } }).share.payload;
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
