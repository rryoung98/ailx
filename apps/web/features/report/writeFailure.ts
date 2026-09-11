"use client";

/**
 * WHAT A WRITE PANEL MET, AND WHETHER PRESSING THE BUTTON AGAIN CAN HELP.
 *
 * The four end-of-sitting writes — issue a credential, revoke it, create a
 * share link, publish it — used to collapse every failure into one sentence
 * and throw the status away: `if (!res.ok) throw new Error(String(res.status))`
 * and then `catch { setPhase("error") }`. A 403, a 409 and a 429 all read as
 * "That did not reach the exam service … Try again in a moment.", so a
 * candidate retried a permanent answer for ever (TEN-234).
 *
 * The READ seam already keeps these apart: `lib/data/serviceFetch.ts` reports
 * a non-200 as `missing` WITH its status and the service's own reason, and a
 * thrown fetch as `error`. This is the same distinction for a WRITE, plus the
 * one extra fact a button needs that a page does not — whether a retry can
 * change the answer.
 *
 * PURE apart from reading the response body: no state, no clock, no copy
 * rendered here. The panels own their own reassurance sentence ("Your sitting
 * is saved", "Your link is untouched") because it is a different fact in each
 * of them, and it is passed in rather than guessed at.
 */
import { isTimeout } from "../../lib/data/deadline";
import { refusalReason } from "../../lib/data/serviceFetch";

/**
 * THREE FACTS, AND THEY ARE NOT INTERCHANGEABLE.
 *
 *  - `refused` — the call LANDED and the service said no. It carries the
 *    status, and the service's own sentence when it sent the frozen envelope.
 *  - `timeout` — we stopped waiting. The service is slow rather than down,
 *    and the write may or may not have happened.
 *  - `unreachable` — a thrown fetch: offline, DNS, a blocked origin. Nothing
 *    was reached, so there is nothing to quote.
 *  - `unreadable` — the service answered 2xx and the body was not the shape
 *    this panel needs. It is OUR bug, not the reader's connection, and
 *    `serviceFetch` says the same thing about a read (`SERVICE_INVALID_COPY`).
 *    It landed in the "did not reach" branch before TEN-234, because the
 *    panels threw an `Error` for it into the same catch as an offline fetch.
 */
export type WriteFailure =
  | { readonly kind: "refused"; readonly status: number; readonly reason?: string }
  | { readonly kind: "timeout" }
  | { readonly kind: "unreachable" }
  | { readonly kind: "unreadable" };

/**
 * Whether pressing the button again could plausibly answer differently.
 *
 * A 429 is a refusal that EXPIRES, a 408 is the service's own timeout, and a
 * 5xx is the service failing rather than refusing — all three are worth
 * another press. Every other 4xx is the service's settled answer about this
 * request: 401 (we do not know you), 403 (not yours), 404 (no such attempt),
 * 409 (already done). Retrying those produces the same status, so the panel
 * must not offer it.
 */
export function mayRetry(failure: WriteFailure): boolean {
  if (failure.kind !== "refused") return true;
  const { status } = failure;
  return status === 408 || status === 429 || status >= 500;
}

/** A non-2xx response, read into a failure. Quotes only the frozen envelope. */
export async function refusedBy(res: Response): Promise<WriteFailure> {
  return { kind: "refused", status: res.status, ...(await refusalReason(res)) };
}

/** A 2xx whose body was not the shape the caller needs. Our bug, said so. */
export const UNREADABLE: WriteFailure = { kind: "unreadable" };

/** A thrown call, read into a failure. Only two things it can be. */
export function threwAs(err: unknown): WriteFailure {
  return isTimeout(err) ? { kind: "timeout" } : { kind: "unreachable" };
}

/**
 * The sentence a candidate reads, in the panel's own words for the safe part.
 *
 * @param failure what happened.
 * @param safety what is UNHARMED by it, in the panel's own terms — "Your
 *   sitting is saved.", "Your link is untouched." It is the panel's fact and
 *   not this module's, so it is passed rather than chosen here.
 * @param service what was being talked to, for the sentence that names it —
 *   "the exam service", "the gallery".
 */
export function writeFailureCopy(
  failure: WriteFailure,
  safety: string,
  service: string,
): string {
  if (failure.kind === "timeout") {
    return `${capitalize(service)} did not answer in time, so nothing changed. It is slow rather than down — ${safety} Try again.`;
  }
  if (failure.kind === "unreachable") {
    return `That did not reach ${service}. ${safety} Try again in a moment.`;
  }
  if (failure.kind === "unreadable") {
    return `${capitalize(service)} answered with something this page could not read, so nothing is shown from it. That is our bug, not your connection. ${safety}`;
  }
  const said = failure.reason === undefined ? "" : ` It said: ${failure.reason}`;
  const reached = `${capitalize(service)} was reached and refused this (HTTP ${failure.status}).${said}`;
  return mayRetry(failure)
    ? `${reached} ${safety} Try again in a moment.`
    : `${reached} ${safety} That is its answer for this request, so pressing the button again will not change it.`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
