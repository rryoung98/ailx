import { handleCreateSiteUpload } from "@ailx/backend/t1";
import { apiRoute, type AttemptRouteContext } from "../../../../../../lib/server/api";
import { getSnapshotStore, getUploadStaging } from "../../../../../../lib/server/site";

/**
 * POST /api/attempts/:id/site/upload-ticket — ask for permission to
 * upload one candidate site straight to the object store, bypassing
 * the platform request-body cap (docs/DEPLOY.md §5.1). No body.
 *
 * The ticket is not an acceptance: the bytes still have to pass the
 * validator at /site/finalize before anything is recorded or stored.
 */
export async function POST(req: Request, { params }: AttemptRouteContext): Promise<Response> {
  const { id } = await params;
  return apiRoute(req, (ctx, headers) =>
    handleCreateSiteUpload(
      { ...ctx, snapshots: getSnapshotStore(), staging: getUploadStaging() },
      headers,
      id,
    ),
  );
}
