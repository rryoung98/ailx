import {
  handleGetCredential,
  handleIssueCredential,
  handleRevokeCredential,
} from "@ailx/backend";
import { apiRoute, requestOrigin, type AttemptRouteContext } from "../../../../../lib/server/api";

/**
 * The holder's own credential for one attempt. Every verb is
 * owner-authenticated (a stranger's attempt reads as 404, no existence leak).
 *
 *  POST   — issue, or return the live one. Idempotent: a credential code is
 *           published on a CV, so re-issuing would silently orphan it.
 *  GET    — the holder's view: the code, the verification path, and the exact
 *           five fields LinkedIn's certification form asks for.
 *  DELETE — revoke; body { reason? }. The code keeps resolving and starts
 *           saying it is revoked, which is what a verifier needs to see.
 *
 * The absolute origin is resolved from AILX_PUBLIC_ORIGIN, never guessed from
 * the Host header: it is baked into the credential URL a holder publishes.
 */
export async function POST(req: Request, { params }: AttemptRouteContext): Promise<Response> {
  const { id } = await params;
  const origin = await requestOrigin(req);
  return apiRoute(req, (ctx, headers) => handleIssueCredential(ctx, headers, id, origin));
}

export async function GET(req: Request, { params }: AttemptRouteContext): Promise<Response> {
  const { id } = await params;
  const origin = await requestOrigin(req);
  return apiRoute(req, (ctx, headers) => handleGetCredential(ctx, headers, id, origin));
}

export async function DELETE(req: Request, { params }: AttemptRouteContext): Promise<Response> {
  const { id } = await params;
  return apiRoute(req, (ctx, headers, body) => handleRevokeCredential(ctx, headers, id, body));
}
