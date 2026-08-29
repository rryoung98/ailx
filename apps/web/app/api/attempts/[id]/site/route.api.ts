import { handleUploadSite } from "@ailx/backend/t1";
import { apiRoute, type AttemptRouteContext } from "../../../../../lib/server/api";
import { getSnapshotStore } from "../../../../../lib/server/site";

/**
 * POST /api/attempts/:id/site?seq=N — body: the submission ZIP bytes.
 * Client timestamp comes from x-ailx-client-ts (same log convention as other
 * responses); validation of both happens in the handler.
 */
export async function POST(req: Request, { params }: AttemptRouteContext): Promise<Response> {
  const { id } = await params;
  const seq = Number(new URL(req.url).searchParams.get("seq"));
  return apiRoute(
    req,
    (ctx, headers, body) =>
      handleUploadSite({ ...ctx, snapshots: getSnapshotStore() }, headers, id, {
        zip: body as Uint8Array,
        seq,
        clientTs: headers["x-ailx-client-ts"] ?? "",
      }),
    { rawBody: true },
  );
}
