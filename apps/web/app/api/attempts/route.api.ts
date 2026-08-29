import { handleCreateAttempt } from "@ailx/backend";
import { t2DeckRecords } from "../../../lib/instrument";
import { apiRoute } from "../../../lib/server/api";

export async function POST(req: Request): Promise<Response> {
  // Content-aware deck sampler: the backend stays content-agnostic; the web
  // host wires in the committed instrument snapshot. Pure + deterministic —
  // the recorded deck is re-derivable from (attempt id, bank sha) alone.
  return apiRoute(req, (ctx, headers, body) =>
    handleCreateAttempt({ ...ctx, sampleDecks: t2DeckRecords }, headers, body),
  );
}
