/**
 * One vote per IP per submission: pathname collision makes re-votes idempotent.
 *
 * The response carries the vote COUNT, not a bare acknowledgement. TEN-131:
 * this route answered `{"ok":true}` whether the vote was new or a repeat, so
 * /wall added one to its own number and the next load took it away again — a
 * write that looked lost and was not. The count it returns is the count the
 * next listing reports.
 */
import { put } from "@vercel/blob";
import { createHash } from "node:crypto";
import { applyCors, clientIp } from "../_lib/guards.js";
import { listAll } from "../_lib/blobs.js";

export default async function handler(req, res) {
  if (applyCors(req, res, ["POST"])) return;
  const { id } = req.body ?? {};
  if (typeof id !== "string" || !/^[a-z0-9-]{6,40}$/.test(id)) {
    return res.status(400).json({ error: "bad id" });
  }
  const ip = clientIp(req);
  const voter = createHash("sha256").update(`${ip}|ailx-gallery-salt`).digest("hex").slice(0, 12);
  const pathname = `gallery/votes/${id}-vote-${voter}.json`;
  await put(pathname, "1", {
    access: "public", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true,
  });
  // Read back what is now stored. The store promises no read-after-write, so
  // a listing that has not caught up must not drop the vote we just wrote.
  const stored = await listAll(`gallery/votes/${id}-vote-`);
  const votes = stored.some((b) => b.pathname === pathname) ? stored.length : stored.length + 1;
  return res.status(200).json({ ok: true, votes });
}
