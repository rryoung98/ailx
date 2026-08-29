import { handleVerifyCredential } from "@ailx/backend";
import { requestOrigin, withApiContext } from "../../../../lib/server/api";

/**
 * GET /api/credentials/:code — the machine-readable twin of /verify/:code,
 * and the credential's `credentialStatus` endpoint.
 *
 * UNAUTHENTICATED by design: a credential is a public claim, which is why
 * this route cannot go through `apiRoute` (that adapter 401s anonymous
 * callers). Never cached — a revocation must be visible the moment it lands,
 * and a cache would keep vouching for a withdrawn credential.
 *
 * Indexable, unlike a share link: a verification page is exactly the thing a
 * stranger should be able to find.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }): Promise<Response> {
  const { code } = await params;
  try {
    const origin = await requestOrigin(req);
    const result = await withApiContext((ctx) => handleVerifyCredential(ctx, code, origin));
    return Response.json(result.body, {
      status: result.status,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json",
      },
    });
  } catch (err) {
    console.error("[ailx credential]", err);
    return Response.json(
      { error: { code: "internal", message: "internal server error" } },
      { status: 500 },
    );
  }
}
