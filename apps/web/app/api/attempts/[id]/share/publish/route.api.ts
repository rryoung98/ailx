import { handlePublishShare } from "@ailx/backend";
import { apiRoute, type AttemptRouteContext } from "../../../../../../lib/server/api";

/**
 * POST /api/attempts/:id/share/publish — the candidate submits their own live
 * share link to the public gallery.
 *
 * Owner-authenticated (a stranger's attempt reads as 404, no existence leak),
 * and the request carries NO body on purpose: whether this auto-publishes or
 * stops at `submitted` for a human is derived from the stored payload
 * (docs/SHARING.md §3), never from anything the client can say.
 */
export async function POST(req: Request, { params }: AttemptRouteContext): Promise<Response> {
  const { id } = await params;
  return apiRoute(req, (ctx, headers) => handlePublishShare(ctx, headers, id));
}
