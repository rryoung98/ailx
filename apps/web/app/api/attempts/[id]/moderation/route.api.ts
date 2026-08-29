import { handleCandidateReply, handleCandidateThread } from "@ailx/backend";
import { apiRoute, type AttemptRouteContext } from "../../../../../lib/server/api";

/**
 * The CANDIDATE's half of a moderation case, scoped to an attempt they own.
 *
 * There is no case id here on purpose: the share is resolved through
 * `getShareForAttempt`, which re-checks ownership, so a participant can only
 * ever read or answer the decision about their own submission. What comes
 * back carries the shared messages and the author's ROLE — never the
 * moderator's identity, and never an internal note.
 */
export async function GET(req: Request, ctxParams: AttemptRouteContext): Promise<Response> {
  const { id } = await ctxParams.params;
  return apiRoute(req, (ctx, headers) => handleCandidateThread(ctx, headers, id));
}

export async function POST(req: Request, ctxParams: AttemptRouteContext): Promise<Response> {
  const { id } = await ctxParams.params;
  return apiRoute(req, (ctx, headers, body) => handleCandidateReply(ctx, headers, id, body));
}
