"use client";

/**
 * THE ONE READ OF THE SERVICE'S SCORES OF RECORD.
 *
 * The polling lived inside the panel, so the panel was the only thing that
 * knew what the exam service had scored. The report's UNLOCK GATE read the
 * local event log instead, and a finalized, service-scored sitting therefore
 * stayed locked for ever while the panel underneath it showed the scores
 * (TEN-128). One hook, one read, one source of truth: the page calls it and
 * hands the result to both the gate and the panel.
 *
 * The bound, the cadence and the arrival announcement are unchanged — see
 * `scoresOfRecord.ts` for why each exists.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiPath } from "@ailx/contract";
import type { TrackId } from "@ailx/session";
import { useIdentity } from "../../lib/auth/identityState";
import { serviceFetch } from "../../lib/data/serviceFetch";
import { isServerMode } from "../../lib/mode";
import {
  DEFAULT_POLL_MS,
  POLL_BOUND_MS,
  parseAttemptScores,
  pollDelayMs,
  type AttemptScores,
} from "./scoresOfRecord";

/**
 * HOW LONG THIS PAGE WAITS BEFORE IT STOPS SAYING IT IS READING.
 *
 * The read cannot fire while the identity is `pending` — a request sent
 * before `ClerkTokenBridge` registers carries no token and the service
 * refuses it, and a 401 does not fix itself on a retry. But a Clerk that
 * mounts and never publishes leaves the identity pending for ever, and
 * `reading` hid every link on the report while it lasted: "Checking what the
 * exam service has issued…", no scores, no way out (TEN-128). After this
 * wait the page stops CALLING it a read; the effect still fires the moment an
 * identity arrives, so nothing is given up, and the gate falls back to this
 * browser's own log meanwhile.
 */
export const IDENTITY_WAIT_MS = 8_000;

/** What went wrong on the LAST read. The previous answer stays on screen. */
export type ReadFailure = { kind: "missing"; status: number } | { kind: "error" };

export interface ScoresView {
  /** undefined: nothing read yet. null: the service returned no `scores`. */
  readonly scores: AttemptScores | null | undefined;
  readonly failure: ReadFailure | null;
  /** True once this page stopped saying a judged score is coming. */
  readonly bounded: boolean;
  /** True while the first read of a hosted sitting is still in flight. */
  readonly reading: boolean;
  /**
   * True once a request has actually gone out for this attempt. It stays
   * FALSE in the static export, and while the identity is pending — the read
   * cannot fire without one — so a page that says nothing came back can tell
   * that apart from never having asked (TEN-128).
   */
  readonly asked: boolean;
  /** Tracks that went from "being judged" to scored while this page was open. */
  readonly arrived: readonly TrackId[];
  readonly checkAgain: () => void;
}

/** The static export has no exam service: nothing is read and nothing claimed. */
const IDLE: ScoresView = {
  scores: undefined,
  failure: null,
  bounded: false,
  reading: false,
  asked: false,
  arrived: [],
  checkAgain: () => undefined,
};

export function useScoresOfRecord(attemptId: string | null): ScoresView {
  const [scores, setScores] = useState<AttemptScores | null | undefined>(undefined);
  const [failure, setFailure] = useState<ReadFailure | null>(null);
  const [bounded, setBounded] = useState(false);
  /** Bumped by "Check again": restarts the read AND the bound. */
  const [round, setRound] = useState(0);
  const [arrived, setArrived] = useState<TrackId[]>([]);
  /** The tracks the LAST read said were pending — the arrival comparison. */
  const wasPending = useRef<Set<TrackId>>(new Set());
  const serverMode = isServerMode();
  const live = serverMode && attemptId !== null;
  /**
   * The one `serviceFetch` outside `useService`, so it needs the same guard:
   * a read fired before `ClerkTokenBridge` registers carries no token, the
   * service refuses it, and this hook STOPS on a 401 because a 401 "will not
   * fix itself on a retry". `reading` stays true meanwhile, so the page says
   * it is still reading rather than claiming there is nothing of record.
   */
  const identityStatus = useIdentity().status;
  /**
   * True once this page has waited `IDENTITY_WAIT_MS` for an ANSWER OF ANY
   * KIND — an identity, or the first read that identity allows.
   *
   * LATCHED: set once and never cleared. An answer that arrives afterwards
   * would otherwise put the page back into `reading`, so the candidate would
   * watch the one link they had appear and then vanish.
   *
   * IT IS NOT CONDITIONAL ON `pending`, AND THAT IS THE POINT. It was, and
   * two 8-second timers then raced: `identityState` resolves a Clerk that
   * never publishes to the asserted dev identity after `IDENTITY_DEADLINE_MS`
   * (TEN-214, #72), which is the SAME 8 seconds. The identity moved off
   * `pending` first, this effect's cleanup cleared its own timer before it
   * could fire, the latch never closed — and `reading` stayed true through a
   * first read that had not answered. That is the TEN-128 dead end again:
   * "Checking what the exam service has issued…", no scores, no link.
   *
   * Bounding the CLAIM in time rather than the identity covers both: a
   * pending identity and a slow first read leave the page saying it has not
   * heard, which is true of each, instead of saying it is still reading.
   *
   * WHICH DEPLOYMENTS REACH WHICH BRANCH, because the race is not the whole
   * story and the answer differs by build:
   *
   *  - STATIC EXPORT (no Clerk): `armDeadline` returns early on
   *    `!isClerkEnabled()`, so no identity is ever published. The latch here
   *    is the ONLY thing that ends `reading`, and the gate falls back to this
   *    browser's own log. That is the case `stops calling itself reading when
   *    no answer ever comes` pins, and it is why this latch is not deletable
   *    in favour of `identityState`'s deadline.
   *  - HOSTED, Clerk publishes in time: normal path, read fires with a Bearer.
   *  - HOSTED, Clerk never publishes: `identityState` publishes the asserted
   *    DEV identity at `IDENTITY_DEADLINE_MS` and a read fires WITHOUT a
   *    bearer token. `identityState`'s own comment says "the service accepts
   *    it" — that was true when it was written and is NOT true of a Clerk
   *    deployment now: the exam service refuses dev auth outright on anything
   *    `publiclyReachable` can see (ailx-backend `7bb2407`, TEN-237). So that
   *    read 401s, and this page reports `{kind:"missing", status:401}` about a
   *    request that was never going to land. Filed separately — the repair
   *    belongs in `identityState`, not here, because the wrong FALLBACK is the
   *    defect and every caller of it is affected, not just this page.
   *
   * THE SEPARATION THAT SETTLES IT, and it is one sentence:
   * **TEN-214's deadline exists to end the WAIT, not to authorise a REQUEST.**
   * Ending the wait is right and this page depends on it. Firing a read under
   * an identity the candidate does not have is a consequence neither PR
   * designed: against a Clerk service that read 401s, and against a
   * dev-accepting service it SUCCEEDS AS A DIFFERENT PARTICIPANT and then
   * 404s on an attempt that account does not own. Both are transient —
   * `identityStatus` is a dep of the read effect, so asserted -> signed-in
   * fires a second, real read — and both beat a permanent dead end. But the
   * honest description of the 8-second answer is "an answer about a request
   * made under a fallback identity", not simply "an answer".
   */
  const [identityWaited, setIdentityWaited] = useState(false);
  /** True once a request has really gone out. Latched for the same reason. */
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    if (!live || identityWaited) return;
    const timer = window.setTimeout(() => setIdentityWaited(true), IDENTITY_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [live, identityWaited]);

  useEffect(() => {
    if (!live || identityStatus === "pending") return;
    setAsked(true);
    let cancelled = false;
    let timer = 0;
    const startedAt = Date.now();

    const schedule = (ms: number): void => {
      // The bound is measured in TIME, not in reads, so it holds whatever
      // cadence the service asks for.
      if (Date.now() - startedAt + ms > POLL_BOUND_MS) {
        setBounded(true);
        return;
      }
      timer = window.setTimeout(() => void read(), ms);
    };

    const read = async (): Promise<void> => {
      const res = await serviceFetch(apiPath("getAttempt", { id: attemptId }), { identity: "required" });
      if (cancelled) return;
      if (res.state === "ready") {
        const parsed = parseAttemptScores(res.data);
        setFailure(null);
        setScores(parsed);
        const nowScored = (parsed?.tracks ?? []).filter(
          (t) => t.state === "scored" && wasPending.current.has(t.trackId),
        );
        if (nowScored.length > 0) {
          setArrived((prev) => [...new Set([...prev, ...nowScored.map((t) => t.trackId)])]);
        }
        wasPending.current = new Set(
          (parsed?.tracks ?? []).filter((t) => t.state === "pending_judging").map((t) => t.trackId),
        );
        // Nothing owed: stop. This is the ordinary way polling ends.
        if (parsed?.pending === true) schedule(pollDelayMs(parsed));
        return;
      }
      if (res.state === "missing") {
        // 401/404 will not fix itself on a retry, so stop rather than loop.
        setFailure({ kind: "missing", status: res.status });
        return;
      }
      if (res.state === "error") {
        // Offline or a blip: keep the last good answer on screen and try
        // again, still inside the same bound.
        setFailure({ kind: "error" });
        schedule(DEFAULT_POLL_MS);
      }
    };

    void read();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [attemptId, round, live, identityStatus]);

  const checkAgain = useCallback(() => {
    setBounded(false);
    /* The PREVIOUS read's failure is not this one's. Left standing, the
       report said "the last read did not land" while a retry was in flight,
       which describes a request that has not answered yet — the same
       confusion `scores ?? null` caused (TEN-128). The last good ANSWER
       stays: only the failure is cleared.

       WHY THAT IS SAFE, AND WHAT IT DEPENDS ON. Clearing the failure makes
       `reading` true again while the retry is out, and the gate offers no
       link while reading — so an UNFINISHED sitting loses its Continue for
       the length of the retry. Acceptable because the candidate pressed the
       button, and because it is BOUNDED: `serviceFetch` wraps every read in
       `deadline("read")`, 10 s (`lib/data/deadline.ts`), so even a retry
       that never answers resolves into a failure and the link comes back.
       Remove that deadline and the link goes for ever. */
    setFailure(null);
    setRound((r) => r + 1);
  }, []);

  if (!live) return IDLE;
  return {
    scores,
    failure,
    bounded,
    // "Reading" is the state before the first answer of ANY kind: a page that
    // called this a lock would tell a finished candidate to finish their run.
    // It is BOUNDED, because a read that never starts is not a read: an
    // identity stuck at `pending` used to leave the report with no scores
    // and no link at all (TEN-128).
    reading: scores === undefined && failure === null && !identityWaited,
    asked,
    arrived,
    checkAgain,
  };
}
