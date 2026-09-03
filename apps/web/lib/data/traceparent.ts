/**
 * ONE trace id per service call, and NO tracing SDK in the browser.
 *
 * The OpenTelemetry web SDK costs tens of kB before it has sent a single
 * span, and the default build of this app is a static export on GitHub Pages
 * that has no exam service to trace at all. So the browser does the one part
 * that only it can do — mint a W3C trace context and put it on the wire — and
 * the exam service, which already wraps every handler, does the rest. A
 * request and the server work it caused land in ONE trace; the page ships a
 * few hundred bytes of hex.
 *
 * The format is W3C Trace Context `traceparent`:
 *
 *   00-<32 hex trace-id>-<16 hex span-id>-<2 hex flags>
 *
 * Both ids are random and MUST NOT be all zeroes. `01` in the flags says
 * "sampled" — a HINT, and a hint a stranger can forge, so the service must
 * not obey it: a plain `ParentBasedSampler` would let any caller pin sampling
 * to 1 and decide our trace bill. The private repo's sampler caps a REMOTE
 * parent with its own ratio for exactly that reason. Nothing here can turn
 * tracing on for a deployment that has no exporter.
 *
 * Dependency-free on purpose (`crypto.getRandomValues`, no `uuid`, no
 * `@opentelemetry/*`), and it carries NOTHING about the person: no identity,
 * no token, no answer, no item. It is 16 random bytes and 8 more.
 */

import type { StorageLike } from "@ailx/session";
import { authHeaders } from "./authHeaders";

/** The W3C header name. Lower case, because `fetch` lower-cases it anyway. */
export const TRACEPARENT_HEADER = "traceparent";

/** Version `00` is the only one specified; flags `01` means "sampled". */
const VERSION = "00";
const SAMPLED = "01";

/**
 * `crypto.getRandomValues` or null. Node before 19, a server render and a
 * browser with a locked-down `crypto` all have to be survivable: a missing
 * trace id is a missing trace, never a broken request, and never a
 * `Math.random()` id pretending to be one.
 */
function randomHex(bytes: number): string | null {
  const webCrypto = typeof globalThis === "undefined" ? undefined : globalThis.crypto;
  if (webCrypto === undefined || typeof webCrypto.getRandomValues !== "function") return null;
  const buf = new Uint8Array(bytes);
  webCrypto.getRandomValues(buf);
  let hex = "";
  for (const byte of buf) hex += byte.toString(16).padStart(2, "0");
  // All-zero ids are INVALID per the spec, and a random 16 bytes is zero once
  // in 2^128 — cheap to check, and a silently invalid header is worse than
  // none because a collector drops it without telling anyone.
  return /^0+$/.test(hex) ? null : hex;
}

/**
 * One `traceparent` value, or null where no usable randomness exists.
 *
 * A fresh trace per call, deliberately. The browser has no span processor to
 * hold a parent in, so pretending several calls share one trace would be a
 * lie the service could not correct.
 */
export function newTraceparent(): string | null {
  const traceId = randomHex(16);
  const spanId = randomHex(8);
  if (traceId === null || spanId === null) return null;
  return `${VERSION}-${traceId}-${spanId}-${SAMPLED}`;
}

/**
 * The trace headers for ONE request, spreadable into any `fetch` init.
 * Empty where there is no randomness, so the call still goes out.
 */
export function traceHeaders(): Record<string, string> {
  const traceparent = newTraceparent();
  return traceparent === null ? {} : { [TRACEPARENT_HEADER]: traceparent };
}

/**
 * The headers EVERY call to the exam service sends: WHO (identity, from
 * `authHeaders`) and WHICH TRACE (a fresh `traceparent`).
 *
 * One composition, because the alternative is fifteen call sites each
 * deciding whether tracing applies to them — and the one that forgets is
 * invisible, not broken. `apps/web/test/traceparent.test.ts` fails if a
 * service call goes back to `authHeaders()` on its own.
 *
 * Identity wins a name collision, and cannot lose one: nothing here writes an
 * `authorization` or `x-ailx-dev-user` key.
 */
export async function serviceHeaders(storage: StorageLike): Promise<Record<string, string>> {
  return { ...traceHeaders(), ...(await authHeaders(storage)) };
}
