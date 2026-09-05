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

  useEffect(() => {
    if (!live || identityStatus === "pending") return;
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
    setRound((r) => r + 1);
  }, []);

  if (!live) return IDLE;
  return {
    scores,
    failure,
    bounded,
    // "Reading" is the state before the first answer of ANY kind: a page that
    // called this a lock would tell a finished candidate to finish their run.
    reading: scores === undefined && failure === null,
    arrived,
    checkAgain,
  };
}
