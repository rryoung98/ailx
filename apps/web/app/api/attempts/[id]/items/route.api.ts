import { handleGetItems } from "@ailx/backend";
import { apiRoute, type AttemptRouteContext } from "../../../../../lib/server/api";

/**
 * GET /api/attempts/:id/items — the deck this attempt was dealt, redacted.
 *
 * `key` and `rationale` are ABSENT while the attempt is open and present only
 * after `attempts.finalized_at` is set. Nothing about the phase is read from
 * the request: see `handleGetItems`.
 */
export async function GET(req: Request, { params }: AttemptRouteContext): Promise<Response> {
  const { id } = await params;
  return apiRoute(req, (ctx, headers) => handleGetItems(ctx, headers, id));
}
