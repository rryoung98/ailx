import { handleCreateAttempt } from "@ailx/backend";
import { apiRoute } from "../../../lib/server/api";

/**
 * Deck sampling now travels on `ApiContext.instrument` (wired once in
 * `lib/server/api.ts`), not on a per-route callback: the sampler and the keys
 * it samples over have one owner (docs/ARCHITECTURE.md §3).
 */
export async function POST(req: Request): Promise<Response> {
  return apiRoute(req, handleCreateAttempt);
}
