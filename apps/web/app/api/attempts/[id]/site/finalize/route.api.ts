import { handleFinalizeSiteUpload } from "@ailx/backend/t1";
import { apiRoute, type AttemptRouteContext } from "../../../../../../lib/server/api";
import { getSnapshotStore, getUploadStaging } from "../../../../../../lib/server/site";

/**
 * POST /api/attempts/:id/site/finalize — body: { uploadId, seq }.
 * Accepts a staged client-direct upload: the server reads those
 * bytes back and validates them exactly as it validates a POSTed
 * ZIP, so a direct upload is never a way around the validator.
 */
export async function POST(req: Request, { params }: AttemptRouteContext): Promise<Response> {
  const { id } = await params;
  return apiRoute(req, (ctx, headers, body) => {
    const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    return handleFinalizeSiteUpload(
      { ...ctx, snapshots: getSnapshotStore(), staging: getUploadStaging() },
      headers,
      id,
      {
        uploadId: b.uploadId,
        seq: Number(b.seq),
        clientTs: headers["x-ailx-client-ts"] ?? "",
      },
    );
  });
}
