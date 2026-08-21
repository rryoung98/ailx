/**
 * Preview sandboxing — spec §12.
 *
 * The live preview iframe is rendered with sandbox="allow-scripts" and NO
 * allow-same-origin, so the document gets an opaque origin: no cookies, no
 * localStorage, no same-origin XHR. On top of that we inject a CSP <meta>
 * as the exfiltration kill switch: default-src 'none', with only inline
 * script/style and data: images allowed. No fetch, no XHR, no WebSocket,
 * no beacon, no form submission, no external subresources.
 */

export const SANDBOX_ATTR = "allow-scripts";

export const PREVIEW_CSP =
  "default-src 'none'; " +
  "script-src 'unsafe-inline'; " +
  "style-src 'unsafe-inline'; " +
  "img-src data:; " +
  "media-src data:; " +
  "font-src data:; " +
  "connect-src 'none'; " +
  "form-action 'none'; " +
  "base-uri 'none'";

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;

/**
 * Wrap candidate HTML for use as iframe srcdoc.
 *
 * SECURITY (F4): the candidate HTML is NEVER inspected — no regex search
 * for <head> or <html>, which was bypassable with a fake occurrence such
 * as `<!-- <head> -->`. Instead we always emit our own static document
 * shell whose <head> contains the CSP meta, and place the candidate HTML
 * strictly AFTER it, inside <body>. The HTML parser applies a
 * Content-Security-Policy meta as long as it is parsed before any
 * candidate content, and stray <html>/<head>/<body> tags inside body are
 * merged or ignored by the parser — they can never un-apply the policy.
 * The returned string therefore starts with a constant trusted prefix and
 * the first byte of candidate input always appears after the CSP meta.
 */
export function buildPreviewSrcdoc(candidateHtml: string): string {
  return `<!doctype html><html><head>${CSP_META}</head><body>${candidateHtml}</body></html>`;
}
