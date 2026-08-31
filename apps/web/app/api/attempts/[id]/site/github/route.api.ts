import { githubClientId, handleGithubExport } from "@ailx/backend/t1";
import { apiRoute, requestOrigin, type AttemptRouteContext } from "../../../../../../lib/server/api";
import { getSnapshotStore } from "../../../../../../lib/server/site";

/**
 * POST /api/attempts/:id/site/github — redeem the device code and, once the
 * candidate has approved on GitHub, create the repository and push the site.
 *
 * 202 means "still waiting for them"; the client polls at the interval the
 * start route returned. The access token exists only inside this call.
 */
export async function POST(req: Request, { params }: AttemptRouteContext): Promise<Response> {
  const { id } = await params;
  const publicOrigin = await requestOrigin(req);
  return apiRoute(req, (ctx, headers, body) =>
    handleGithubExport(
      { ...ctx, snapshots: getSnapshotStore(), githubClientId: githubClientId(process.env) },
      headers,
      id,
      // The README's live link must name THIS deployment, never a value a
      // caller supplied: the origin is resolved server-side and overrides.
      { ...(typeof body === "object" && body !== null ? body : {}), publicOrigin },
    ),
  );
}
