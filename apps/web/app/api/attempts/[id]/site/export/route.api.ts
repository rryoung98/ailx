import {
  handleExportSite,
  isSiteExportZip,
  siteExportHeaders,
} from "@ailx/backend/t1";
import { apiRoute, type AttemptRouteContext } from "../../../../../../lib/server/api";
import { getSnapshotStore } from "../../../../../../lib/server/site";

/**
 * GET /api/attempts/:id/site/export — the candidate's own T1 site as the ZIP
 * it was scored as (docs/FUTURE-TRACKS.md: offboard, do not grow an IDE).
 *
 * The success body is bytes, not JSON, so this route answers with a raw
 * Response — still through `apiRoute`, which authenticates before anything
 * else happens. The handler then refuses an attempt the caller does not own:
 * the served-site capability digest is explicitly NOT authorization to copy
 * somebody's work out of AILX.
 */
export async function GET(req: Request, { params }: AttemptRouteContext): Promise<Response> {
  const { id } = await params;
  return apiRoute(req, async (ctx, headers) => {
    const result = await handleExportSite({ ...ctx, snapshots: getSnapshotStore() }, headers, id);
    if (!isSiteExportZip(result)) return result;
    return new Response(result.zip, { status: 200, headers: siteExportHeaders(result.filename) });
  });
}
