import { handleReviewDecision, handleReviewQueue } from "@ailx/backend";
import { apiRoute } from "../../../../lib/server/api";

/**
 * The reviewer API twin of /review.
 *
 * `apiRoute` authenticates before it buffers a body; `handleReview*` then
 * re-checks the AILX_REVIEWERS allowlist server-side, so an authenticated
 * stranger gets 403 and an anonymous one gets 401. The approver recorded on
 * the row is the VERIFIED caller — never a field in this request.
 */
export async function GET(req: Request): Promise<Response> {
  return apiRoute(req, (ctx, headers) => handleReviewQueue(ctx, headers, process.env));
}

export async function POST(req: Request): Promise<Response> {
  return apiRoute(req, (ctx, headers, body) => handleReviewDecision(ctx, headers, body, process.env));
}
