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
 *  POST   — create the unlisted link; body { sections?, note? }. The section
 *           selection is re-normalized and applied SERVER-SIDE; the body can
 *           never supply a payload, a site path or a status.
 *  GET    — the owner's view: status, token, anonymous view count, frozen
 *           payload, and a reviewer's refusal reason when there is one. The
 *           token is returned so a lost link is recoverable, never revoked.
 *  DELETE — revoke. The link stops resolving immediately, everywhere.
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
