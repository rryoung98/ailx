import { handleModerationCase, handleModerationComment } from "@ailx/backend";
import { apiRoute } from "../../../../lib/server/api";

/**
 * The moderator's case: read the whole trail, or append to it.
 *
 * Both verbs go through `withReviewer` inside the handler, so an anonymous
 * caller gets 401 and a signed-in stranger 403 — the same server-side gate
 * the dashboard page uses, never a UI condition. The author recorded on a
 * comment is the VERIFIED caller; a body field claiming otherwise is ignored.
 */
export type CaseRouteContext = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctxParams: CaseRouteContext): Promise<Response> {
  const { id } = await ctxParams.params;
  return apiRoute(req, (ctx, headers) => handleModerationCase(ctx, headers, id, process.env));
}

export async function POST(req: Request, ctxParams: CaseRouteContext): Promise<Response> {
  const { id } = await ctxParams.params;
  return apiRoute(req, (ctx, headers, body) =>
    handleModerationComment(ctx, headers, id, body, process.env),
  );
}
