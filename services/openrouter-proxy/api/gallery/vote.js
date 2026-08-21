/** One vote per IP per submission: pathname collision makes re-votes idempotent. */
import { put, head } from "@vercel/blob";
import { createHash } from "node:crypto";

function corsHeaders(req) {
  const origin = req.headers.origin ?? "";
  const ok = origin === "https://rryoung98.github.io" || origin.startsWith("http://localhost");
  return {
    "Access-Control-Allow-Origin": ok ? origin : "https://rryoung98.github.io",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
  };
}

export default async function handler(req, res) {
  for (const [k, v] of Object.entries(corsHeaders(req))) res.setHeader(k, v);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { id } = req.body ?? {};
  if (!/^[a-z0-9-]{6,40}$/.test(id ?? "")) return res.status(400).json({ error: "bad id" });
  const ip = (req.headers["x-forwarded-for"] ?? "?").split(",")[0].trim();
  const voter = createHash("sha256").update(`${ip}|ailx-gallery-salt`).digest("hex").slice(0, 12);
  await put(`gallery/votes/${id}-vote-${voter}.json`, "1", {
    access: "public", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true,
  });
  return res.status(200).json({ ok: true });
}
