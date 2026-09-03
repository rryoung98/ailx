/**
 * The REQUEST HEADERS a browser is allowed to send to the exam service.
 *
 * WHY THIS IS A CONTRACT AND NOT A LIST IN EACH REPO. The frontend is served
 * from one origin (GitHub Pages, or Vercel) and the exam service from
 * another (Cloud Run), so every call the app makes is CROSS-ORIGIN and is
 * preflighted. A header the service does not name in
 * `Access-Control-Allow-Headers` is not stripped — the browser refuses the
 * whole request before it is sent, and the app sees a bare "Failed to fetch"
 * that names nothing.
 *
 * That happened on 2026-09-03. The browser started sending a W3C
 * `traceparent` on every service call (docs/ADR-otel.md) while the service's
 * allow-list was four strings typed out in the private repo. Every seeded
 * end-to-end spec died, and the hosted app could not load a deck, sync a run
 * or publish a T1 site. Two half-lists, one outage.
 *
 * So there is ONE list. The browser side may send nothing outside it, and the
 * service side builds its CORS allow-list FROM it — this package is vendored
 * into the private repo and compared byte for byte in CI, so the two halves
 * can no longer drift.
 *
 * Lower case, because `fetch` lower-cases a header name anyway and the
 * comparison a preflight does is case-insensitive; one spelling keeps the
 * assertions below simple.
 */

import { DEV_USER_HEADER } from "./identity.js";

/**
 * W3C Trace Context. Minted per call in the browser and continued by the
 * service, which is the only reason a request and the server work it caused
 * land in one trace. Carries nothing about the person: it is random hex.
 */
export const TRACEPARENT_HEADER = "traceparent";

/**
 * The client's own clock at the moment it made the call, ISO-8601. The store
 * records it next to the server's, so a run written from a badly-set device
 * is still orderable and the disagreement is visible rather than silent.
 */
export const CLIENT_TS_HEADER = "x-ailx-client-ts";

/** Bearer token (Clerk). The dev twin is `DEV_USER_HEADER`. */
export const AUTHORIZATION_HEADER = "authorization";

/** Set on every request with a body: JSON, or the T1 snapshot's ZIP bytes. */
export const CONTENT_TYPE_HEADER = "content-type";

/**
 * EVERY header the browser may put on a call to the exam service, and
 * therefore exactly what the service must allow in a preflight response.
 *
 * Adding a header to a request without adding it here is the failure this
 * constant exists to prevent, so both sides assert against it:
 * `apps/web/test/traceparent.test.ts` fails when the app sends a name that is
 * not on this list, and the private repo's CORS setup reads the list itself.
 */
export const BROWSER_REQUEST_HEADERS: readonly string[] = Object.freeze([
  CONTENT_TYPE_HEADER,
  AUTHORIZATION_HEADER,
  DEV_USER_HEADER,
  CLIENT_TS_HEADER,
  TRACEPARENT_HEADER,
]);

/** Is this a header the service will accept cross-origin? Case-insensitive. */
export function isAllowedRequestHeader(name: string): boolean {
  return BROWSER_REQUEST_HEADERS.includes(name.trim().toLowerCase());
}
