import { handleStartPractice } from "@ailx/backend";
import { apiRoute } from "../../../lib/server/api";

/**
 * POST /api/practice — deal an unscored practice drill.
 *
 * The DECK IS DEALT SERVER-SIDE and recorded before a single answer is taken,
 * so the submit can refuse an answer to a card this session was never shown.
 * It draws only from the practice corpus (@ailx/report `samplePracticeDeck`);
 * the scored item bank is not reachable from here.
 */
export async function POST(req: Request): Promise<Response> {
  return apiRoute(req, (ctx, headers) => handleStartPractice(ctx, headers));
}
