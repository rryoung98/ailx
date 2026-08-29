import { handleCreateAttempt } from "@ailx/backend";
import { apiRoute } from "../../../lib/server/api";

export async function POST(req: Request): Promise<Response> {
  return apiRoute(req, (ctx, headers, body) => handleCreateAttempt(ctx, headers, body));
}
