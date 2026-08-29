import { SITE_INDEX, canonicalSitePath } from "@ailx/backend";
import { handleServeSite } from "@ailx/backend/t1";
import { withApiContext } from "../../../../../lib/server/api";
import { getSnapshotStore } from "../../../../../lib/server/site";
import { resolvePublicOrigin } from "../../../../../lib/server/origin";

type SiteRouteContext = { params: Promise<{ digest: string; path?: string[] }> };

/**
 * GET /api/site/:digest/*path — serves a stored submission snapshot. No auth:
 * the 256-bit content digest is the capability, and every response carries the
 * §12 sandbox headers (see sandboxHeaders in @ailx/backend). It DOES take a DB
 * session: bytes are servable only while a `responses` row records the digest
 * (handleServeSite's reachability rule), so nothing unattributed is ever
 * hosted here.
 *
 * Directory-ish requests (bare digest, or any trailing slash) 308 ONCE to the
 * canonical `.../index.html` — see site-url.ts for why the trailing-slash form
 * is not a stable target (it 308s back here: an infinite loop, staging P0).
 * The canonical URL ends in a real file name, so no framework rewrites it and
 * the next hop is the 200.
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
  const requested = url.pathname.endsWith("/") ? `${segments.join("/")}/` : segments.join("/");
  if (canonicalSitePath(requested) !== requested) {
    // The path minus any trailing slash is exactly what was asked for, still
    // percent-encoded, so appending the index name needs no re-encoding.
    return Response.redirect(`${origin}${url.pathname.replace(/\/+$/, "")}/${SITE_INDEX}`, 308);
  }
  try {
    const result = await withApiContext((ctx) =>
      handleServeSite({ db: ctx.db, snapshots: getSnapshotStore() }, origin, digest, requested),
    );
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
