import { handleGetAttempt } from "@ailx/backend";
import { apiRoute, type AttemptRouteContext } from "../../../../lib/server/api";

export async function GET(req: Request, { params }: AttemptRouteContext): Promise<Response> {
  const { id } = await params;
  return apiRoute(req, (ctx, headers) => handleGetAttempt(ctx, headers, id));
}
