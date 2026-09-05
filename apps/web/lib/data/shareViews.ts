"use client";
/**
 * THE PER-LINK VIEW COUNTER — the browser half of docs/SHARING.md §6.
 *
 * `POST /v1/share/:token/views` has been mounted and anonymous in the exam
 * service since the page migration (docs/ARCHITECTURE.md §10.3) and had NO
 * caller here, so `share_views` stayed empty and every admin surface that
 * reads it showed a zero it had no way to earn. This module is that caller,
 * and nothing more.
 *
 * It is NOT the funnel, and the two are not redundant. `funnel_events`
 * carries no share token on purpose — a capability in a metrics table is a
 * leak with a retention policy — so the funnel can only ever say
 * opens-over-creates in AGGREGATE. This says WHICH link travelled, which is
 * the question an owner and the gallery queue actually ask.
 *
 * Four rules, each one a promise the share view already makes to a reader:
 *
 *  - ANONYMOUS. No identity header, no cookie, no trace header, no body. The
 *    read beside it is a capability read (`identity: "anonymous"`), and a
 *    counter that knew who was counting would be a tracker. Sending no header
 *    at all also keeps the request CORS-simple, so it costs no preflight.
 *  - ONLY WHEN THE CARD RESOLVED. The caller is mounted inside the resolved
 *    branch of the share view, so a 404, a revoked token or an outage posts
 *    nothing. Crawler previews never get this far: they fetch metadata and
 *    run no effect.
 *  - ONCE PER TOKEN PER BROWSING SESSION, through the funnel's own
 *    session-scoped dedupe (`funnel().once`). Strict mode's double mount, a
 *    re-render and a reload are one view.
 *  - FIRE AND FORGET, AND SILENT WITHOUT A BACKEND. It returns void, swallows
 *    every failure and reads no response. With `NEXT_PUBLIC_AILX_API_BASE`
 *    unset there is no service to post to, so nothing is sent at all — the
 *    GitHub Pages export does not have this page anyway.
 *
 * THE TOKEN IS NEVER LOGGED, and never stored. Nothing here builds a message
 * out of the URL, and the dedupe key is a DIGEST of the token rather than the
 * token, so the capability does not end up sitting in a metrics record in
 * sessionStorage next to the funnel's own keys.
 */
import { apiPath } from "@ailx/contract";
import { apiBase, apiOrigin } from "../mode";
import { funnel } from "./funnel";

/**
 * A short, stable, NON-REVERSIBLE-ENOUGH key for one token.
 *
 * FNV-1a, not a hash anybody should lean on: it exists so the dedupe record
 * is not a copy of the capability, not to protect a secret. A collision would
 * cost one uncounted view in one tab, which is why 32 bits is plenty.
 */
export function shareViewKey(token: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `share_view:${hash.toString(16).padStart(8, "0")}`;
}

/**
 * Where the count goes, or null for "this build has no backend".
 *
 * `apiOrigin()` is the test, exactly as it is for the funnel sink: this repo
 * has no API routes of its own (AGENTS.md, the repository split), so no
 * origin means no service and no request.
 */
function endpoint(token: string): string | null {
  return apiOrigin() === "" ? null : `${apiBase()}${apiPath("countShareView", { token })}`;
}

/**
 * Count ONE view of this card. Synchronous, returns void, never throws.
 *
 * The response is deliberately not read: the page already printed the count
 * the service served it, and a number that changed under the reader is not
 * worth a re-render. A refusal (404 on a token revoked between the read and
 * this call, a 429 from the anonymous limiter, an offline browser) is simply
 * a view that was not counted — a small hole in a chart, never a broken page,
 * and never a retry.
 */
export function countShareView(token: string): void {
  try {
    const url = endpoint(token);
    if (url === null) return;
    if (!funnel().once(shareViewKey(token))) return;
    void fetch(url, {
      method: "POST",
      keepalive: true,
      // Anonymous by construction: no cookie, no identity header, no body.
      credentials: "omit",
    }).catch(() => undefined);
  } catch {
    // Blocked, offline, or a browser that refuses the call. Drop it.
  }
}
