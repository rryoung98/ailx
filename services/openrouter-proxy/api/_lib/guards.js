/**
 * Shared request guards for every proxy handler: one CORS policy, one
 * rate-limiter implementation, one numeric clamp. Lives under api/_lib/
 * so Vercel does not deploy it as a function.
 */

// ---------------------------------------------------------------- CORS
export const PROD_ORIGIN = "https://rryoung98.github.io";
// Single localhost policy for local dev: plain http, localhost or 127.0.0.1,
// any port. Anchored so e.g. http://localhost.evil.com is rejected.
const LOCALHOST_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

export function isAllowedOrigin(origin) {
  return origin === PROD_ORIGIN || LOCALHOST_RE.test(origin);
}

/**
 * Sets CORS headers and handles the OPTIONS preflight and method check.
 * Returns true when the request was fully handled (caller must return).
 * @param {string[]} methods allowed methods, e.g. ["POST"]
 */
export function applyCors(req, res, methods) {
  const origin = req.headers.origin ?? "";
  res.setHeader("Access-Control-Allow-Origin", isAllowedOrigin(origin) ? origin : PROD_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", [...methods, "OPTIONS"].join(", "));
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  if (!methods.includes(req.method)) {
    res.status(405).json({ error: `${methods.join(" or ")} only` });
    return true;
  }
  return false;
}

// ---------------------------------------------------------- rate limiting
/** First hop of x-forwarded-for; "?" groups requests with no header. */
export function clientIp(req) {
  return String(req.headers["x-forwarded-for"] ?? "?").split(",")[0].trim();
}

/**
 * In-memory sliding-window limiter (best effort, per warm instance).
 * Bounded: expired timestamps are pruned per entry, and when the map
 * exceeds maxIps, expired entries are swept and then the oldest-inserted
 * entries evicted — one busy IP never resets everyone else's window.
 */
export function createRateLimiter({ windowMs, max, maxIps = 10_000 }) {
  const hits = new Map(); // ip -> number[] (ascending timestamps)

  function liveHits(ip, now) {
    const arr = hits.get(ip);
    if (!arr) return [];
    const live = arr.filter((t) => now - t < windowMs);
    if (live.length === 0) hits.delete(ip);
    else if (live.length !== arr.length) hits.set(ip, live);
    return live;
  }

  return {
    /** True when ip is at/over the limit. Does not record a hit. */
    isLimited(ip, now = Date.now()) {
      return liveHits(ip, now).length >= max;
    },
    /** Record one hit for ip. Call only after isLimited() said no. */
    record(ip, now = Date.now()) {
      const live = liveHits(ip, now);
      live.push(now);
      hits.set(ip, live);
      if (hits.size > maxIps) {
        for (const [k, arr] of hits) {
          if (now - arr[arr.length - 1] >= windowMs) hits.delete(k);
        }
        for (const k of hits.keys()) {
          if (hits.size <= maxIps) break;
          hits.delete(k);
        }
      }
    },
    /** Tracked-IP count (for tests). */
    size: () => hits.size,
  };
}

// ------------------------------------------------------------- clamping
/**
 * Clamp a user-supplied max_tokens to [1, cap]. Absent, non-numeric,
 * NaN, and non-finite inputs all fall back to cap (never forwarded raw:
 * NaN serializes to null in JSON, which lifts the cap upstream).
 */
export function clampMaxTokens(value, cap) {
  if (value == null) return cap;
  if (typeof value === "string" && value.trim() === "") return cap;
  const n = Number(value);
  if (!Number.isFinite(n)) return cap;
  return Math.min(Math.max(1, Math.floor(n)), cap);
}
