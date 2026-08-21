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
 * Wrap candidate HTML for use as iframe srcdoc, injecting the CSP meta as
 * early as possible so it governs every subresource in the document.
 */
export function buildPreviewSrcdoc(candidateHtml: string): string {
  const headOpen = /<head(\s[^>]*)?>/i.exec(candidateHtml);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    return candidateHtml.slice(0, at) + CSP_META + candidateHtml.slice(at);
  }
  const htmlOpen = /<html(\s[^>]*)?>/i.exec(candidateHtml);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return (
      candidateHtml.slice(0, at) +
      `<head>${CSP_META}</head>` +
      candidateHtml.slice(at)
    );
  }
  // Fragment: give it a full document shell.
  return `<!doctype html><html><head>${CSP_META}</head><body>${candidateHtml}</body></html>`;
}
