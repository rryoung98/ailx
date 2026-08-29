import { handleServeSite } from "@ailx/backend/t1";
import { getSnapshotStore } from "../../../../../lib/server/site";
import { resolvePublicOrigin } from "../../../../../lib/server/origin";

type SiteRouteContext = { params: Promise<{ digest: string; path?: string[] }> };

/**
 * GET /api/site/:digest/*path — serves a stored submission snapshot. No auth
 * or DB: the 256-bit content digest is the capability, and every response
 * carries the §12 sandbox headers (see sandboxHeaders in @ailx/backend).
 * The bare-digest URL redirects to its trailing-slash form so relative asset
 * URLs inside the page resolve under the snapshot prefix.
 */
export async function GET(req: Request, { params }: SiteRouteContext): Promise<Response> {
  const { digest, path } = await params;
  const url = new URL(req.url);
  // Behind a proxy req.url carries the internal origin, which would poison
  // both the redirect Location and the CSP allowlist. Resolve once and use the
  // same value for both: an absolute Location keeps the two in lockstep, so a
  // misconfigured origin fails visibly instead of silently blocking assets.
  const origin = resolvePublicOrigin(process.env, url, req.headers);
  const segments = path ?? [];
  if (segments.length === 0 && !url.pathname.endsWith("/")) {
    return Response.redirect(`${origin}${url.pathname}/`, 308);
  }
  try {
    const result = await handleServeSite(getSnapshotStore(), origin, digest, segments.join("/"));
    // Our snapshot bytes are always ArrayBuffer-backed; the cast bridges the
    // lib.dom BodyInit typing, which rejects Uint8Array<ArrayBufferLike>.
    const body = result.data === null ? "not found" : (result.data as Uint8Array<ArrayBuffer>);
    return new Response(body, { status: result.status, headers: result.headers });
  } catch (err) {
    console.error("[ailx site]", err);
    return new Response("internal server error", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
