/**
 * Public-origin resolution for server mode.
 *
 * The T1 serve route bakes the serving origin into two security-critical
 * places: the sandbox CSP allowlist (`sandbox` without `allow-same-origin`
 * gives the page an OPAQUE origin, so `'self'` matches nothing and the
 * explicit origin term is load-bearing) and the 308 trailing-slash redirect
 * candidates follow. Behind any reverse proxy (ngrok, Cloud Run, Vercel, a
 * CDN) `new URL(req.url).origin` is the INTERNAL origin, so both break.
 *
 * Precedence, deliberately fail-safe:
 *   1. `AILX_PUBLIC_ORIGIN` — an operator-supplied, validated absolute origin.
 *   2. `x-forwarded-proto` / `x-forwarded-host` — ONLY when `AILX_TRUST_PROXY`
 *      is enabled. These headers are attacker-controlled on a direct hit;
 *      reflecting them unguarded into a redirect Location or a CSP allowlist
 *      is host-header injection / CSP widening.
 *   3. The request URL's own origin (the pre-existing behaviour).
 *
 * Junk in either input is ignored rather than thrown: a bad value must not
 * 500 every hosted site, and the fallback is never attacker-controlled.
 */

import { normalizeOrigin } from "../origin";

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/** Pure: is this env value an explicit opt-in? */
export function isEnabled(value: string | undefined): boolean {
  return value !== undefined && TRUTHY.has(value.trim().toLowerCase());
}

/**
 * The origin predicate itself lives in `lib/origin.ts` because the CLIENT
 * seam (`lib/mode.ts`, which validates `NEXT_PUBLIC_AILX_API_BASE`) needs the
 * identical rule and may not import `lib/server/**`. Re-exported so existing
 * server callers keep one import site.
 */
export { normalizeOrigin } from "../origin";

/** First entry of a possibly comma-separated forwarded header value. */
function firstValue(raw: string | null | undefined): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const first = raw.split(",")[0]?.trim();
  return first === undefined || first === "" ? undefined : first;
}

/**
 * Pure: the origin this response will actually be fetched from by a browser.
 * `headers` is only consulted when proxy trust is explicitly enabled.
 */
export function resolvePublicOrigin(
  env: Readonly<Record<string, string | undefined>>,
  url: URL,
  headers: Headers,
): string {
  const configured = normalizeOrigin(env.AILX_PUBLIC_ORIGIN);
  if (configured !== null) return configured;

  if (isEnabled(env.AILX_TRUST_PROXY)) {
    const host = firstValue(headers.get("x-forwarded-host"));
    if (host !== undefined) {
      const proto = firstValue(headers.get("x-forwarded-proto"))?.toLowerCase() ?? url.protocol.replace(":", "");
      const forwarded = normalizeOrigin(`${proto}://${host}`);
      if (forwarded !== null) return forwarded;
    }
  }

  return url.origin;
}
