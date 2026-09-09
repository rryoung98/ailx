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
import { readMigratedItem } from "@ailx/core";
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
    return parseLocalLedger(readMigratedItem(storage, LOCAL_PRACTICE_KEY));
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

/** What this browser is holding, and the day it is holding it on. */
export interface LocalPracticeDays {
  /** Every day in the ledger, claimed or not. */
  days: string[];
  /** The days this browser believes it has already handed to an account. */
  claimed: string[];
  /** The browser's own local day, so a summary is counted against it. */
  today: string;
}

/**
 * The ledger this browser is holding, as a hook — read on mount and kept in
 * step with the ledger. RAW: the caller decides which days it may draw,
 * because only the caller knows what the service just said.
 *
 * `null` means "nothing readable", and it is deliberately ONE value for the
 * first render and for a browser whose storage throws (private mode, blocked
 * cookies). It once promised a caller could tell "not asked yet" from "no
 * days" and so avoid a flash; it could not — a throwing storage returned
 * `null` too — and no caller ever used the distinction. A promise nothing
 * keeps is worse than no promise.
 *
 * /progress needs this because a round the service cannot attribute to
 * anybody never reaches it (TEN-132). Without it the page reports zero days
 * to somebody whose practice summary just said "1 day streak".
 */
export function useLocalPracticeDays(): LocalPracticeDays | null {
  const [days, setDays] = useState<LocalPracticeDays | null>(null);
  useEffect(() => {
    const read = (): void => {
      try {
        const ledger = readLocalLedger(window.localStorage);
        setDays({
          days: localPracticeDayStrings(ledger),
          claimed: ledger.days.filter((d) => d.claimed).map((d) => d.day),
          today: localDay(Date.now(), utcOffsetMinutes()),
        });
      } catch {
        setDays(null);
      }
    };
    read();
    return subscribeLocalPractice(read);
  }, []);
  return days;
}

/** A browser-held streak, and what is true of the days behind it. */
export interface HeldHere {
  streak: StreakSummary;
  /**
   * True when a day was left out because an account holds it. A run of days
   * with a hole in it has no honest "best streak", so a caller that gets
   * `partial` must show the COUNT and not a streak — see `LocalStreak`.
   */
  partial: boolean;
  /**
   * How many of the days that ARE shown have already been handed to an
   * account — only ever more than `none` when nothing was subtracted, i.e.
   * the service did not answer. The caller must then not say these days are
   * on no account: `claimed: true` is written only from a 200 that named the
   * day, so at least one of them is. `some` and `all` have their own
   * sentences, because a browser one round old is entirely claimed.
   */
  handedOver: ClaimedShare;
}

/**
 * The days a browser is holding that no figure on the page already counts,
 * or `null` when there are none to draw.
 *
 * `alreadyCounted` is what the SERVICE said it holds for this caller — the
 * practice days behind the figures above, never the browser's guess alone.
 * Two reasons:
 *
 *  - the local `claimed` flag misses a claim whose RESPONSE was lost: the
 *    server stored the day, this browser never heard so, and the day would be
 *    drawn twice;
 *  - when the service did not answer, `alreadyCounted` is `null` and NOTHING
 *    is subtracted. A refusal or a 500 is not evidence that a day is on an
 *    account, and subtracting on that evidence made a browser holding only
 *    claimed days read "Nothing has been played in this browser" — false, on
 *    the page whose whole bug was saying that. What the caller loses is the
 *    right to call those days browser-only, which is what `handedOver` says.
 *
 * The local flags are unioned in only when the service DID answer, so a
 * response that names fewer days than the browser handed over still cannot
 * draw one day in two places. That hides a day claimed onto a DIFFERENT
 * account on this browser, which is the safe direction: the alternative is
 * printing "this browser is the only place they are held" about a day some
 * account holds.
 *
 * `mergePracticeDays` is the other way to spend this overlap — one table of
 * server and browser days, maxed per field. It is not used because the two
 * blocks on /progress differ in PROVENANCE, not in arithmetic: merging would
 * hide which days the service itself stamped, which is the one thing this
 * page must not blur.
 */
export function heldOnlyHere(
  local: LocalPracticeDays | null,
  alreadyCounted: ReadonlySet<string> | null,
): HeldHere | null {
  if (local === null) return null;
  const held =
    alreadyCounted === null
      ? local.days
      : local.days.filter((d) => !alreadyCounted.has(d) && !local.claimed.includes(d));
  if (held.length === 0) return null;
  return {
    streak: streakSummary(held, local.today),
    partial: held.length < local.days.length,
    handedOver: claimedShare(held.map((d) => ({ claimed: local.claimed.includes(d) }))),
  };
}

/**
 * How much of a set of days has already been handed to an account: `none`,
 * `some`, or `all`. Which sentence a surface may print, in one word.
 *
 * `all` is not a rounding of `some`: the taster claims the day it just dealt,
 * so a browser one round old is entirely claimed, and "the rest are kept in
 * this browser alone" would then be a sentence about an empty set.
 */
export type ClaimedShare = "none" | "some" | "all";

export function claimedShare(days: readonly { claimed: boolean }[]): ClaimedShare {
  const claimed = days.filter((d) => d.claimed).length;
  if (claimed === 0) return "none";
  return claimed === days.length ? "all" : "some";
}

/**
 * The same question about the whole LEDGER, read from storage — the durable
 * answer, where the claim receipt in `readLastClaim` is one page's memory of
 * one moment and knows only about today.
 *
 * A corrupt ledger, an empty one and one written by a build with no `claimed`
 * field all come back `none`: `readLocalLedger` swallows the throw and
 * `parseLocalLedger` only ever sets the flag from a literal `true`. `none` is
 * the right answer for all three — an unreadable ledger has handed nothing
 * over that anybody can point to.
 *
 * The DRILL asks this, over every day it is holding. /progress asks
 * `claimedShare` over the days it is actually DRAWING, because it has already
 * filtered the ones an account holds. The two surfaces can therefore print
 * different sentences from the same ledger, and that is correct rather than
 * drift: they are describing different sets. Making them agree would put a
 * false sentence back on one of them.
 */
export function ledgerClaimedShare(storage: StorageLike): ClaimedShare {
  return claimedShare(readLocalLedger(storage).days);
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

