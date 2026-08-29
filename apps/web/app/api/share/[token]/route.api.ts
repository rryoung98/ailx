import { handleViewShare } from "@ailx/backend";
import { withApiContext, type ShareRouteContext } from "../../../../lib/server/api";

/**
 * GET /api/share/:token — the machine-readable twin of the /s/:token page.
 * UNAUTHENTICATED by design: the token is the capability, which is why this
 * route cannot go through `apiRoute` (that adapter 401s anonymous callers).
 *
 * Not indexed and not cached: a revoked link must stop being served the
 * moment it is revoked, and a cache would keep answering for it.
 */
export async function GET(_req: Request, { params }: ShareRouteContext): Promise<Response> {
  const { token } = await params;
  try {
    const result = await withApiContext((ctx) => handleViewShare(ctx, token));
    return Response.json(result.body, {
      status: result.status,
      headers: { "x-robots-tag": "noindex", "cache-control": "no-store" },
    });
  } catch (err) {
    console.error("[ailx share]", err);
    return Response.json(
      { error: { code: "internal", message: "internal server error" } },
      { status: 500 },
    );
  }
}
