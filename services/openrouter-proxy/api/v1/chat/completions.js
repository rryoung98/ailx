/**
 * AILX shared-demo OpenRouter proxy (Vercel serverless).
 *
 * Holds the operator's OpenRouter key server-side so visitors can try AILX
 * with zero setup. Hard guards, in order:
 *   1. CORS: only the AILX origins may call it.
 *   2. Per-IP rate limit (best-effort, in-memory per warm instance).
 *   3. Global budget: refuses once the key's OpenRouter-reported usage
 *      exceeds SHARED_BUDGET_USD (checked live, cached 60s) — this is the
 *      backstop that survives cold starts.
 *   4. Model allowlist: one cheap text model, image models for T4.
 *   5. Payload caps: max_tokens clamped, streaming off, n forced to 1.
 *
 * Env: OPENROUTER_KEY (secret), SHARED_BUDGET_USD (default "5").
 */
import { applyCors, clampMaxTokens, clientIp, createRateLimiter } from "../../_lib/guards.js";

export const config = { maxDuration: 60 };

const ALLOWED_MODELS = new Set([
  "openai/gpt-4.1-nano",
  "google/gemini-3.1-flash-image",
  "google/gemini-3.1-flash-image-lite",
]);
const MAX_TOKENS = 8000;
const PER_IP_PER_HOUR = 60;

const limiter = createRateLimiter({ windowMs: 3600_000, max: PER_IP_PER_HOUR });
let budgetCache = { at: 0, blocked: false, usage: 0 };

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
  if (applyCors(req, res, ["POST"])) return;

  const key = process.env.OPENROUTER_KEY;
  if (!key) return res.status(500).json({ error: "proxy not configured" });

  const ip = clientIp(req);
  if (limiter.isLimited(ip)) {
    return res.status(429).json({ error: "shared demo rate limit — try again later or bring your own key" });
  }
  limiter.record(ip);

  if (await overBudget(key)) {
    return res.status(402).json({ error: "shared demo budget exhausted — bring your own OpenRouter key" });
  }

  const body = req.body ?? {};
  if (typeof body.model !== "string" || !ALLOWED_MODELS.has(body.model)) {
    return res.status(400).json({ error: `model not in shared-demo allowlist` });
  }
  body.stream = false;
  body.max_tokens = clampMaxTokens(body.max_tokens, MAX_TOKENS);
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
