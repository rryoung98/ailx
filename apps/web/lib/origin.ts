/**
 * Origin validation, shared by the client and the server.
 *
 * Two independent surfaces need the SAME rule for "is this an absolute
 * http(s) origin, and what is its canonical spelling":
 *
 *  - `lib/server/origin.ts` bakes `AILX_PUBLIC_ORIGIN` into the T1 sandbox
 *    CSP allowlist and the 308 redirect Location.
 *  - `lib/mode.ts` reads `NEXT_PUBLIC_AILX_API_BASE` to decide whether the
 *    browser calls its own `/api` routes or a separate exam service.
 *
 * A second copy of this predicate would be a second security policy, so
 * there is one. This module is pure and isomorphic: no node built-ins, no
 * env, no I/O — a client bundle may import it.
 */

/**
 * Pure: validate an absolute http(s) origin and return it normalized (lowercase
 * scheme/host, default port dropped, IPv6 literals bracketed), or null.
 * Rejects credentials, any path beyond `/`, query, fragment, and non-http(s)
 * schemes. A single trailing slash is tolerated and normalized away.
 */
export function normalizeOrigin(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") return null;
  // A URL with no authority (e.g. "http:foo") yields an "null" opaque origin.
  if (url.origin === "null" || url.hostname === "") return null;
  return url.origin;
}
