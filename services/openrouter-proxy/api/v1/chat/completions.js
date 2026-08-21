/**
 * AILX shared-demo OpenRouter proxy (Vercel serverless).
 *
 * Holds the operator's OpenRouter key server-side so visitors can try AILX
 * with zero setup. Hard guards, in order:
 *   1. CORS: only the AILX origins may call it.
 *   2. Model allowlist: one cheap text model, image models for T4.
 *   3. Payload caps: max_tokens clamped, streaming off, 1 image per call.
 *   4. Per-IP rate limit (best-effort, in-memory per warm instance).
 *   5. Global budget: refuses once the key's OpenRouter-reported usage
 *      exceeds SHARED_BUDGET_USD (checked live, cached 60s) — this is the
 *      backstop that survives cold starts.
 *
 * Env: OPENROUTER_KEY (secret), SHARED_BUDGET_USD (default "5").
 */
export const config = { maxDuration: 60 };

const ALLOWED_ORIGINS = new Set([
  "https://rryoung98.github.io",
  "http://localhost:3199",
  "http://localhost:3000",
]);
const ALLOWED_MODELS = new Set([
  "openai/gpt-4.1-nano",
  "google/gemini-3.1-flash-image",
  "google/gemini-3.1-flash-image-lite",
]);
const MAX_TOKENS = 8000;
const PER_IP_PER_HOUR = 60;

const ipHits = new Map(); // ip -> number[] (timestamps)
let budgetCache = { at: 0, blocked: false, usage: 0 };

function cors(req) {
  const origin = req.headers.origin ?? "";
  const ok = ALLOWED_ORIGINS.has(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : "https://rryoung98.github.io",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Max-Age": "86400",
  };
}

async function overBudget(key) {
  const now = Date.now();
  if (now - budgetCache.at < 60_000) return budgetCache.blocked;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const j = await res.json();
    const usage = Number(j?.data?.usage_weekly ?? 0); // weekly window matches the key's own weekly reset
    const cap = Number(process.env.SHARED_BUDGET_USD ?? "5");
    budgetCache = { at: now, blocked: usage >= cap, usage };
  } catch {
    // If the check itself fails, keep the last verdict.
    budgetCache.at = now;
  }
  return budgetCache.blocked;
}

export default async function handler(req, res) {
  const headers = cors(req);
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.OPENROUTER_KEY;
  if (!key) return res.status(500).json({ error: "proxy not configured" });

  // Per-IP rate limit (best effort).
  const ip = (req.headers["x-forwarded-for"] ?? "?").split(",")[0].trim();
  const now = Date.now();
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (hits.length >= PER_IP_PER_HOUR) {
    return res.status(429).json({ error: "shared demo rate limit — try again later or bring your own key" });
  }
  hits.push(now);
  ipHits.set(ip, hits);
  if (ipHits.size > 10_000) ipHits.clear();

  if (await overBudget(key)) {
    return res.status(402).json({ error: "shared demo budget exhausted — bring your own OpenRouter key" });
  }

  const body = req.body ?? {};
  if (!ALLOWED_MODELS.has(body.model)) {
    return res.status(400).json({ error: `model not in shared-demo allowlist` });
  }
  body.stream = false;
  body.max_tokens = Math.min(Number(body.max_tokens ?? MAX_TOKENS), MAX_TOKENS);
  if (body.n) body.n = 1;

  const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://rryoung98.github.io/ailx/",
      "X-Title": "AILX shared demo",
    },
    body: JSON.stringify(body),
  });
  const text = await upstream.text();
  res.status(upstream.status).setHeader("content-type", "application/json");
  return res.send(text);
}
