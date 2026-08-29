import {
  handleCreateShare,
  handleGetShare,
  handleRevokeShare,
} from "@ailx/backend";
import { apiRoute, type AttemptRouteContext } from "../../../../../lib/server/api";

/**
 * The candidate's own share link for one attempt. Every verb is
 * owner-authenticated (a stranger's attempt reads as 404, no existence leak).
 *
 *  POST   — create the unlisted link; body { includeSite?: boolean }. The
 *           plaintext token is returned HERE AND NOWHERE ELSE.
 *  GET    — the owner's view: status, anonymous view count, frozen payload.
 *  DELETE — revoke. The link stops resolving immediately.
 */
export async function POST(req: Request, { params }: AttemptRouteContext): Promise<Response> {
  const { id } = await params;
  return apiRoute(req, (ctx, headers, body) => handleCreateShare(ctx, headers, id, body));
}

export async function GET(req: Request, { params }: AttemptRouteContext): Promise<Response> {
  const { id } = await params;
  return apiRoute(req, (ctx, headers) => handleGetShare(ctx, headers, id));
}

export async function DELETE(req: Request, { params }: AttemptRouteContext): Promise<Response> {
  const { id } = await params;
  return apiRoute(req, (ctx, headers) => handleRevokeShare(ctx, headers, id));
}
