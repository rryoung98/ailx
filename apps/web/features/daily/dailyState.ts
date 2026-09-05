"use client";
/**
 * The browser half of the daily challenge's memory: localStorage and a clock.
 *
 * The RULES live in `@ailx/report`'s `daily.ts` — what a day is, what a
 * ledger may contain, what buys a streak day, and why the days live in the
 * browser at all. This module owns only the impure half (FRONTEND.md §2.2).
 *
 * It is deliberately the same shape as `lib/data/localPractice.ts`, and it is
 * deliberately a DIFFERENT store: a daily round is not a practice round, and
 * folding one into the other would inflate a streak that is supposed to mean
 * one specific thing.
 *
 * Nothing here reads an identity. The daily has to work for somebody who has
 * never signed in and may never sign in, so this module imports nothing from
 * `lib/auth/**` and makes no request at all.
 */
import {
  DAILY_LEDGER_KEY,
  readMigratedItem,
  emptyDailyLedger,
  parseDailyLedger,
  recordDailyRound,
  serializeDailyLedger,
  type DailyLedger,
  type DailyRound,
} from "@ailx/report";
import type { StorageLike } from "@ailx/session";

/**
 * Read the ledger. A storage that throws (Safari private mode has, and a
 * cookies-disabled profile does) reads as an empty ledger rather than taking
 * the page down: the daily must play for somebody whose browser stores
 * nothing, it simply cannot remember them.
 */
export function readDailyLedger(storage: StorageLike): DailyLedger {
  try {
    return parseDailyLedger(readMigratedItem(storage, DAILY_LEDGER_KEY));
  } catch {
    return emptyDailyLedger();
  }
}

/** Write it back. Quota and private mode lose the day, never the round. */
export function writeDailyLedger(storage: StorageLike, ledger: DailyLedger): void {
  try {
    storage.setItem(DAILY_LEDGER_KEY, serializeDailyLedger(ledger));
  } catch {
    // Nothing to recover: the round is already on screen and unscored.
  }
}

/** Record one finished round and return the ledger as it now stands. */
export function recordDailyRoundLocally(
  storage: StorageLike,
  round: DailyRound,
  deckSize: number,
): DailyLedger {
  const ledger = recordDailyRound(readDailyLedger(storage), round, deckSize);
  writeDailyLedger(storage, ledger);
  return ledger;
}
