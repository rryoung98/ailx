/**
 * Shared blob listing for the gallery handlers.
 *
 * Lives under api/_lib/ so Vercel does not deploy it as a function. Both the
 * listing handler and the vote handler count votes, and they must count them
 * the same way: one paginating helper, one page cap.
 */
import { list } from "@vercel/blob";

// 25 pages x 1000 blobs. Past that, counts are deliberately truncated
// rather than looping forever on a hostile/degenerate store.
export const MAX_LIST_PAGES = 25;

/** Every blob under `prefix`, following the cursor up to the page cap. */
export async function listAll(prefix) {
  const blobs = [];
  let cursor;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const res = await list({ prefix, limit: 1000, cursor });
    blobs.push(...res.blobs);
    if (!res.hasMore) break;
    cursor = res.cursor;
  }
  return blobs;
}
