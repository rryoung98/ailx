/**
 * The T1 live-site URL convention — shared by the server (the `path` returned
 * by the upload handler, the serve route) and the client (the link the UI
 * shows). It lives in the client-safe barrel, not `./t1`, because that
 * subpath pulls in node:fs/zlib.
 *
 * CANONICAL URL: `/api/site/<digest>/index.html`, never `/api/site/<digest>/`.
 * The trailing-slash form is not a stable URL: Next.js (`trailingSlash: false`)
 * 308s it back to the bare digest, so a route that 308s the bare digest to the
 * slash form is an infinite loop. Naming index.html explicitly gives a URL that
 * (a) no framework rewrites, and (b) still resolves a page's relative asset
 * URLs (`app.js`) under `/api/site/<digest>/` — which is what the trailing
 * slash was for. No candidate byte is touched (no injected <base> tag).
 */

export const SITE_INDEX = "index.html";

/**
 * `payload.kind` of the append-only `responses` row that records a T1 site
 * submission. Defined here (client-safe) rather than in `./t1`, because the
 * share pipeline must find an attempt's snapshot digest without pulling in
 * node:zlib. One definition; `./t1` re-exports it.
 */
export const T1_SITE_RESPONSE_KIND = "t1-site-snapshot";

/**
 * The file a snapshot request resolves to: directory-ish requests ("" or a
 * trailing slash) mean the directory index. The serve route redirects such
 * requests to the canonical form; the serve handler resolves them directly so
 * a non-HTTP caller sees the same mapping.
 */
export function canonicalSitePath(path: string): string {
  return path === "" || path.endsWith("/") ? `${path}${SITE_INDEX}` : path;
}

/** Canonical live URL for a snapshot. `apiRoot` carries any basePath prefix. */
export function siteUrlPath(digest: string, apiRoot = "/api"): string {
  return `${apiRoot}/site/${digest}/${SITE_INDEX}`;
}
