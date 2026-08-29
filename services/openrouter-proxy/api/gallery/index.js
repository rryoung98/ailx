/**
 * AILX T4 gallery — submissions (Vercel Blob, public store).
 *
 * GET  → list newest 60 submissions + vote counts (cursor-paginated blob
 *        listing, hard-capped at MAX_LIST_PAGES pages as a runaway guard).
 * POST → share a T4 final set: 1-3 images (dataURI, each ≤ 450KB decoded),
 *        direction note ≤ 800 chars, model id. Per-IP rate limited.
 *
 * Votes are a HUMAN AESTHETIC SIGNAL, deliberately outside the scored
 * instrument: the composite never reads this store.
 */
import { put, list } from "@vercel/blob";
import { applyCors, clientIp, createRateLimiter } from "../_lib/guards.js";

const MAX_IMG_BYTES = 450 * 1024;
const SUBMITS_PER_IP_PER_DAY = 6;
// 25 pages x 1000 blobs. Past that, counts are deliberately truncated
// rather than looping forever on a hostile/degenerate store.
const MAX_LIST_PAGES = 25;

const limiter = createRateLimiter({ windowMs: 86400_000, max: SUBMITS_PER_IP_PER_DAY });

async function listAll(prefix) {
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

export default async function handler(req, res) {
  if (applyCors(req, res, ["GET", "POST"])) return;

  if (req.method === "GET") {
    const [subs, votes] = await Promise.all([listAll("gallery/subs/"), listAll("gallery/votes/")]);
    const counts = {};
    for (const v of votes) {
      const id = v.pathname.split("/")[2]?.split("-vote-")[0];
      if (id) counts[id] = (counts[id] ?? 0) + 1;
    }
    const items = subs
      .sort((a, b) => (a.pathname < b.pathname ? 1 : -1))
      .slice(0, 60)
      .map((b) => {
        const id = b.pathname.split("/")[2].replace(/\.json$/, "");
        return { id, url: b.url, votes: counts[id] ?? 0 };
      });
    res.setHeader("cache-control", "s-maxage=15, stale-while-revalidate=60");
    return res.status(200).json({ items });
  }

  const ip = clientIp(req);
  const now = Date.now();
  if (limiter.isLimited(ip, now)) {
    return res.status(429).json({ error: "daily share limit reached" });
  }

  const { images, note, model } = req.body ?? {};
  if (!Array.isArray(images) || images.length < 1 || images.length > 3) {
    return res.status(400).json({ error: "1-3 images required" });
  }
  const stored = [];
  const id = `${(8e12 - now).toString(36)}-${Math.random().toString(36).slice(2, 8)}`; // sorts newest-first
  for (let i = 0; i < images.length; i++) {
    const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(images[i] ?? "");
    if (!m) return res.status(400).json({ error: `image ${i + 1}: not a png/jpeg/webp dataURI` });
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > MAX_IMG_BYTES) return res.status(413).json({ error: `image ${i + 1} over ${MAX_IMG_BYTES / 1024}KB` });
    const blob = await put(`gallery/img/${id}-${i}.${m[1] === "jpeg" ? "jpg" : m[1]}`, buf, {
      access: "public", contentType: `image/${m[1]}`, addRandomSuffix: false,
    });
    stored.push(blob.url);
  }
  const doc = {
    id,
    ts: new Date().toISOString(),
    images: stored,
    note: String(note ?? "").slice(0, 800),
    model: String(model ?? "").slice(0, 80),
    disclosure: "AI-generated image set shared from an AILX T4 run.",
  };
  await put(`gallery/subs/${id}.json`, JSON.stringify(doc), {
    access: "public", contentType: "application/json", addRandomSuffix: false,
  });
  limiter.record(ip, now);
  return res.status(201).json({ id, images: stored });
}
