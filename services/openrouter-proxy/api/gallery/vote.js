/** One vote per IP per submission: pathname collision makes re-votes idempotent. */
import { put } from "@vercel/blob";
import { createHash } from "node:crypto";
import { applyCors, clientIp } from "../_lib/guards.js";

export default async function handler(req, res) {
  if (applyCors(req, res, ["POST"])) return;
  const { id } = req.body ?? {};
  if (typeof id !== "string" || !/^[a-z0-9-]{6,40}$/.test(id)) {
    return res.status(400).json({ error: "bad id" });
  }
  const ip = clientIp(req);
  const voter = createHash("sha256").update(`${ip}|ailx-gallery-salt`).digest("hex").slice(0, 12);
  await put(`gallery/votes/${id}-vote-${voter}.json`, "1", {
    access: "public", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true,
  });
  return res.status(200).json({ ok: true });
}
