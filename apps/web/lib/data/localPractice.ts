"use client";
/**
 * The browser half of the anonymous practice ledger: localStorage, a clock,
 * and the one network call that hands the ledger to an account.
 *
 * The RULES live in `@ailx/report`'s `localPractice.ts` — what a day is, what
 * bounds it, what a claim may contain, and why the days live here at all.
 * This module owns only the impure half (FRONTEND.md §2.2): reading and
 * writing storage, asking the clock what day it is, and POSTing a claim.
 *
 * Nothing here reaches a score. A local day is training, it is the browser's
 * own word, and it is kept in a store the exam path never reads
 * (`apps/web/test/anonymousScoredSitting.test.ts` pins that).
 */
import { useEffect, useState } from "react";
import {
  LOCAL_PRACTICE_KEY,
  claimableDays,
  emptyLocalLedger,
  localDay,
  localPracticeDayStrings,
  markDaysClaimed,
  parseLocalLedger,
  qualifiesForStreak,
  recordLocalRound,
  serializeLocalLedger,
  streakSummary,
  type LocalPracticeLedger,
  type PracticeDayCounts,
  type PracticeQualification,
  type StreakSummary,
} from "@ailx/report";
import { apiPath } from "@ailx/contract";
import type { StorageLike } from "@ailx/session";
import { serviceHeaders } from "./traceparent";
import { apiBase } from "../mode";

/** Minutes EAST of UTC — the sign convention `localDay` expects. */
export function utcOffsetMinutes(now: Date = new Date()): number {
  return -now.getTimezoneOffset();
}

/**
 * Read the ledger. A storage that throws (Safari private mode has, and a
 * disabled-cookies profile does) reads as an empty ledger rather than taking
 * the page down: the drill must play for somebody whose browser stores
 * nothing, it simply cannot remember them.
 */
export function readLocalLedger(storage: StorageLike): LocalPracticeLedger {
  try {
    return parseLocalLedger(storage.getItem(LOCAL_PRACTICE_KEY));
  } catch {
    return emptyLocalLedger();
  }
}

/** Write it back. Quota and private mode lose the day, never the round. */
export function writeLocalLedger(storage: StorageLike, ledger: LocalPracticeLedger): void {
  try {
    storage.setItem(LOCAL_PRACTICE_KEY, serializeLocalLedger(ledger));
  } catch {
    // Nothing to recover: the round is already on screen and unscored.
  }
}

export interface FinishedRound {
  answered: number;
  correct: number;
  /** Measured in this browser, between the first card and the last call. */
  elapsedMs: number;
  /** `Date.now()` at the submit — injected so the caller's tests own the clock. */
  now: number;
  tzOffsetMinutes: number;
}

/**
 * Record one finished round against the browser's own calendar day.
 *
 * The qualification rule is `qualifiesForStreak`, the SAME function the server
 * applies to a recorded session — one rule, not a local imitation of one. A
 * round that does not qualify is still shown; it just does not buy a day.
 */
export function recordLocalPracticeRound(
  storage: StorageLike,
  round: FinishedRound,
): { ledger: LocalPracticeLedger; qualification: PracticeQualification } {
  const qualification = qualifiesForStreak({ answered: round.answered, elapsedMs: round.elapsedMs });
  const before = readLocalLedger(storage);
  if (!qualification.counted) return { ledger: before, qualification };
  const ledger = recordLocalRound(before, {
    day: localDay(round.now, round.tzOffsetMinutes),
    answered: round.answered,
    correct: round.correct,
  });
  writeLocalLedger(storage, ledger);
  notify();
  return { ledger, qualification };
}

/**
 * The streak this browser has earned, by its own reckoning, as a hook — read
 * on mount and kept in step with the ledger.
 *
 * `null` until the first read, and `null` for a browser whose storage throws
 * (private mode, blocked cookies): a page must be able to tell "no days" from
 * "not asked yet" so it does not flash a wrong empty state.
 *
 * /progress needs this because a signed-out round never reaches the exam
 * service (TEN-132). Without it the page reports zero days to somebody whose
 * practice summary just said "1 day streak".
 */
export function useLocalStreak(): StreakSummary | null {
  const [streak, setStreak] = useState<StreakSummary | null>(null);
  useEffect(() => {
    const read = (): void => {
      try {
        setStreak(localStreakSummary(window.localStorage, Date.now(), utcOffsetMinutes()));
      } catch {
        setStreak(null);
      }
    };
    read();
    return subscribeLocalPractice(read);
  }, []);
  return streak;
}

/** The streak this browser has earned, by its own reckoning. */
export function localStreakSummary(
  storage: StorageLike,
  now: number,
  tzOffsetMinutes: number,
): StreakSummary {
  return streakSummary(localPracticeDayStrings(readLocalLedger(storage)), localDay(now, tzOffsetMinutes));
}

// ---------------------------------------------------------------------------
// The claim
// ---------------------------------------------------------------------------

/** What a claim did, kept in memory so a view can say it happened. */
export interface ClaimOutcome {
  /** Days the server said it stored. Empty is a legitimate, quiet outcome. */
  claimed: string[];
  ok: boolean;
}

let lastClaim: ClaimOutcome | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/** Subscribe to ledger and claim changes (`useSyncExternalStore`-shaped). */
export function subscribeLocalPractice(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The most recent claim in THIS page's life, or null. Never persisted. */
export function readLastClaim(): ClaimOutcome | null {
  return lastClaim;
}

/** Test hook. */
export function resetLastClaim(): void {
  lastClaim = null;
}

/**
 * Hand this browser's unclaimed practice days to the account that just signed
 * in, and remember which ones were taken.
 *
 * Failure is quiet ON PURPOSE. The claim runs in the background at sign-in; a
 * red banner about a network error at that moment would be the first thing a
 * new account ever said to somebody. Nothing is lost by a failure — the days
 * stay unclaimed in this browser, so the next sign-in tries again.
 */
export async function claimLocalPractice(
  storage: StorageLike,
  fetchFn: typeof fetch = fetch,
): Promise<ClaimOutcome | null> {
  const ledger = readLocalLedger(storage);
  // Already validated and bounded: `readLocalLedger` runs every entry through
  // the SHARED `parsePracticeDay` on the way out of storage, so a second
  // sanitize here would be dead code — a mutation test proved it, rather than
  // leaving it in as defence nobody could break.
  const days: PracticeDayCounts[] = claimableDays(ledger);
  if (days.length === 0) return null;
  try {
    const res = await fetchFn(`${apiBase()}${apiPath("claimPractice")}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await serviceHeaders(storage)) },
      body: JSON.stringify({ days }),
    });
    if (!res.ok) throw new Error(`claim failed (${res.status})`);
    const body = (await res.json()) as { claimed?: unknown };
    // Only days the SERVER says it stored are marked claimed. A day marked on
    // this browser's optimism would be a day no account holds and this
    // browser will never offer again — the exact loss this feature exists to
    // prevent.
    const claimed = Array.isArray(body.claimed)
      ? body.claimed.filter((d): d is string => typeof d === "string")
      : [];
    writeLocalLedger(storage, markDaysClaimed(ledger, claimed));
    lastClaim = { claimed, ok: true };
    notify();
    return lastClaim;
  } catch {
    lastClaim = { claimed: [], ok: false };
    notify();
    return lastClaim;
  }
}

