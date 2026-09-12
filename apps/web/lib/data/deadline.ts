"use client";

/**
 * ONE bound on every network read this browser makes.
 *
 * A socket that opens and then stalls never rejects. Until this module there
 * was no `AbortSignal.timeout` anywhere in `apps/web` (TEN-210), so every
 * careful `catch` in the codebase was dead on the ONE failure a degraded
 * service actually produces: not a refusal, not an outage, a hang. /progress,
 * /world and /gallery said `Loading...` for as long as the tab was open, the
 * credential and share panels said `Checking...`, and a hosted sitting's
 * mirror queue stopped at the first request that never came back.
 *
 * The bound lives here rather than at each call site for the reason every
 * seam in `lib/data` exists: seventeen hand-written timeouts would be
 * seventeen chances to disagree about what "too long" means, and about
 * whether a timeout is an error a reader is told about or a retry nobody
 * sees. It is one number per CALL CLASS, and the class is named at the call
 * site, because the right bound is a property of what the request is FOR —
 * a poll is not a finalize is not an upload.
 *
 * NOT `AbortSignal.timeout()`, deliberately. That call is fine, but it cannot
 * be combined with a caller's own signal without `AbortSignal.any()`, it
 * cannot be cancelled when the request finishes early, and it cannot be
 * driven by a test's fake timers on every runtime this app is built against.
 * A controller plus one `setTimeout` does all three, and it aborts with a
 * `TimeoutError` — the same `name` the platform uses — so {@link isTimeout}
 * can tell "we gave up waiting" from "the component unmounted".
 */

/**
 * What a request is FOR. The bound follows from that, and from nothing else.
 *
 * - `read` — a page's own data (`/progress`, `/world`, `/gallery`, a share, a
 *   credential). A cold Cloud Run start is measured at 1213 ms
 *   (docs/ADR-redis.md), so 10 s is eight cold starts: long enough that a
 *   slow service still answers, short enough that a reader is told something
 *   inside the time they would otherwise sit staring at a spinner.
 * - `poll` — a read that will be made again on its own. It must be the
 *   SHORTEST bound in this table: a poll that outlives its own interval
 *   stacks requests on a service that is already struggling. Missing one tick
 *   costs nothing, because the next tick asks again.
 * - `write` — a POST that carries a candidate's work (a log entry, a
 *   transcript turn, a practice submission). Longer than a read because
 *   giving up early on a write loses work rather than a render, and the
 *   server's seq idempotency makes a re-send safe.
 * - `finalize` — the one POST that makes a sitting scored. The server issues
 *   every track score inside it (TEN-66), so it is doing real work while the
 *   browser waits and it gets the longest bound of any single request. It is
 *   still bounded: an unbounded finalize is exactly TEN-206.
 * - `upload` — a body measured in megabytes (the T1 site archive). The bound
 *   is a slow uplink's problem, not a server's, so it is generous.
 * - `model` — a generation. A large model answering a long prompt takes tens
 *   of seconds legitimately; this bound exists to stop "for ever", not to
 *   police latency.
 * - `content` — the deck or the dealt form a track is about to present. It is
 *   more than one request and the CLOCK IS HELD while it runs, so waiting
 *   costs the candidate nothing and the bound is generous; what it buys is
 *   that a dead socket ends in a retry button instead of an empty screen.
 * - `beacon` — fire-and-forget telemetry (funnel steps, share views). It may
 *   never outlive the interaction that produced it, and nobody is waiting for
 *   the answer, so it gets the tightest bound in the table after `poll`.
 */
export type CallClass =
  | "read"
  | "poll"
  | "write"
  | "finalize"
  | "upload"
  | "model"
  | "content"
  | "beacon";

/** The whole timeout policy, in one table. Milliseconds. */
export const CALL_TIMEOUT_MS: Readonly<Record<CallClass, number>> = Object.freeze({
  read: 10_000,
  poll: 4_000,
  write: 15_000,
  finalize: 45_000,
  upload: 120_000,
  model: 120_000,
  content: 20_000,
  beacon: 3_000,
});

/**
 * A live deadline. `signal` goes on the request; `settle()` cancels the timer
 * once the request is done, so a finished call leaves nothing pending.
 */
export interface Deadline {
  readonly signal: AbortSignal;
  settle(): void;
}

/**
 * The reason a deadline aborts with.
 *
 * `name` matches the platform's own (`AbortSignal.timeout()` aborts with a
 * `TimeoutError` `DOMException`), so {@link isTimeout} is true of both. The
 * MESSAGE is written to be readable by a candidate, because several surfaces
 * quote a failure's `message` straight into their copy: "the Foray service did
 * not answer in 20s" is a fact somebody can act on, and `content request gave
 * up after 20000ms` is not. The class is kept as a field for logs.
 */
export class TimeoutAbortError extends Error {
  constructor(
    readonly callClass: CallClass,
    readonly ms: number,
  ) {
    super(`the Foray service did not answer in ${Math.round(ms / 1000)}s`);
    this.name = "TimeoutError";
  }
}

/**
 * True when this failure is "we stopped waiting", and not "the caller went
 * away". Checked by `name`, so a platform `AbortSignal.timeout()` reason and
 * ours are the same fact to every caller.
 */
export function isTimeout(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "TimeoutError";
}

/**
 * Bound one request.
 *
 * `outer` is the caller's own signal — TanStack's unmount signal, a runner's
 * cancel button — and it still wins: aborting it aborts this one with the
 * caller's reason, which is how `serviceFetch` keeps telling "unmounted" from
 * "timed out". Passing an already-aborted `outer` produces an already-aborted
 * deadline and starts no timer.
 */
export function deadline(callClass: CallClass, outer?: AbortSignal): Deadline {
  const ms = CALL_TIMEOUT_MS[callClass];
  const controller = new AbortController();
  if (outer?.aborted === true) {
    controller.abort(outer.reason);
    return { signal: controller.signal, settle: () => {} };
  }
  const timer = setTimeout(() => controller.abort(new TimeoutAbortError(callClass, ms)), ms);
  const onOuter = () => {
    clearTimeout(timer);
    controller.abort(outer?.reason);
  };
  outer?.addEventListener("abort", onOuter, { once: true });
  return {
    signal: controller.signal,
    settle: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuter);
    },
  };
}

/**
 * `fetch` with a deadline on it, for the call sites that want nothing else
 * from this module. The timer is cleared as soon as the RESPONSE HEADERS
 * arrive — reading the body is the caller's own affair, and a body that
 * streams for longer than the bound is not the failure this guards against.
 *
 * A timed-out call rejects with {@link TimeoutAbortError}, so a caller that
 * already has a `catch` gets a bounded failure for free, and one that wants
 * to say WHICH failure it was asks {@link isTimeout}.
 */
export async function fetchWithDeadline(
  callClass: CallClass,
  input: string,
  init: RequestInit = {},
  outer?: AbortSignal,
): Promise<Response> {
  const d = deadline(callClass, outer);
  try {
    return await fetch(input, { ...init, signal: d.signal });
  } finally {
    d.settle();
  }
}

/**
 * Bound a PROMISE rather than a request — for the one caller that has a whole
 * operation to bound (several requests behind one seam function) instead of a
 * single `fetch` it can hand a signal to.
 *
 * It rejects with {@link TimeoutAbortError} and leaves `p` running, because it
 * cannot cancel what it did not start; the transport bound underneath is what
 * actually stops the sockets. This exists so the number still comes out of the
 * one table above, and the exam page's hand-rolled `withTimeout` — the only
 * bound in `apps/web` before TEN-210, and a bound on exactly one call — could
 * be deleted rather than copied.
 */
export function withDeadline<T>(callClass: CallClass, p: Promise<T>): Promise<T> {
  const ms = CALL_TIMEOUT_MS[callClass];
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new TimeoutAbortError(callClass, ms)), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(id);
        reject(err);
      },
    );
  });
}

/**
 * What a reader is told when we stopped waiting. A different sentence from
 * "it refused" and from "it could not be reached", because it is a different
 * fact: the service is there and is too slow to use, which is a state a
 * reload can genuinely fix.
 */
export const TIMEOUT_COPY =
  "The Foray service did not answer in time, so this page has nothing to show. It is slow rather than down — reload to ask again.";
