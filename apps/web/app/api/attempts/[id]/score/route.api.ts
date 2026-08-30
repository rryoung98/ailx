import { handleScoreTrack } from "@ailx/backend";
import { apiRoute, type AttemptRouteContext } from "../../../../../lib/server/api";

/**
 * POST /api/attempts/:id/score — the server-issued T2 score.
 *
 * The browser holds no answer keys in hosted mode, so it cannot compute this
 * itself: see `handleScoreTrack`.
 */
export async function POST(req: Request, { params }: AttemptRouteContext): Promise<Response> {
  const { id } = await params;
  return apiRoute(req, (ctx, headers, body) => handleScoreTrack(ctx, headers, id, body));
}
