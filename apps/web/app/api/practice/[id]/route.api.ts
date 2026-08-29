import { handleSubmitPractice } from "@ailx/backend";
import { apiRoute } from "../../../../lib/server/api";

/** Next 15 dynamic-segment params for /api/practice/[id]. */
type PracticeRouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/practice/:id — submit the whole drill.
 *
 * Answers are graded, and the streak day is earned or refused, on the SERVER
 * (@ailx/backend `submitPractice`). The client sends choices and its UTC
 * offset; it never sends a grade, an elapsed time, or a streak.
 */
export async function POST(req: Request, { params }: PracticeRouteContext): Promise<Response> {
  const { id } = await params;
  return apiRoute(req, (ctx, headers, body) => handleSubmitPractice(ctx, headers, id, body));
}
