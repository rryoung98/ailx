import { githubClientId, handleGithubExportStart } from "@ailx/backend/t1";
import { apiRoute, type AttemptRouteContext } from "../../../../../../../lib/server/api";
import { getSnapshotStore } from "../../../../../../../lib/server/site";

/**
 * POST /api/attempts/:id/site/github/start — begin GitHub's device flow.
 *
 * 501 when AILX_GITHUB_CLIENT_ID is unset: a deployment without it offers
 * Download only, which is the ladder degrading exactly as designed.
 */
export async function POST(req: Request, { params }: AttemptRouteContext): Promise<Response> {
  const { id } = await params;
  return apiRoute(req, (ctx, headers) =>
    handleGithubExportStart(
      { ...ctx, snapshots: getSnapshotStore(), githubClientId: githubClientId(process.env) },
      headers,
      id,
    ),
  );
}
