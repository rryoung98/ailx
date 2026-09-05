/**
 * The anonymous on-ramp's memory: a practice ledger a BROWSER keeps for
 * itself, and the rules for handing it to a real identity later.
 *
 * WHY THIS EXISTS. A visitor who has never signed in still practises, and a
 * streak they cannot keep is not a streak. The first ask for an account used
 * to arrive before anybody had a reason to care, and it arrived in front of
 * the game — which is the wrong order twice over.
 *
 * WHERE THE DAYS LIVE, AND WHY THAT CHOICE.
 *
 *  - **localStorage in the visitor's own browser** — what this module
 *    describes. It works in BOTH builds (the static GitHub Pages export has
 *    no server at all, so anything server-shaped would make the loop exist in
 *    only one of them), nothing about a stranger leaves their machine, and
 *    there is no row to delete later because there is no row. The cost is
 *    stated on the page rather than hidden: clearing site data ends it, and
 *    it does not follow anyone to a second device. That cost IS the honest
 *    reason to sign in.
 *  - A **cookie** was rejected: it would ship these days to the server on
 *    every navigation, which is data collection about somebody who has agreed
 *    to nothing, and 4 kB is a hard ceiling a year of days would reach.
 *  - An **anonymous server participant** was rejected: `participants.auth_ref`
 *    is provider-scoped and means "a proven identity". Minting one for a
 *    visitor manufactures exactly the identity the scored path is supposed to
 *    require, and it leaves a real personal-data row belonging to nobody.
 *
 * WHAT A LOCAL DAY IS WORTH. A server practice day is derived from a
 * server-stamped `completed_at` and cannot be asserted by a client
 * (docs/PROGRESSION.md §3.5). A LOCAL day is the browser's own word, so it is
 * kept in a different place, is labelled as self-reported wherever it is
 * shown, and buys nothing except the streak the same browser is looking at.
 * It reaches no score, no report figure, no credential and no cohort
 * statistic — the same wall practice already stands behind.
 *
 * Pure, like everything else in this package: `now` and storage are the
 * caller's problem (`apps/web/lib/data/localPractice.ts` is the browser shell).
 */
import { PRACTICE_DECK_SIZE } from "./practice.js";
import type { PracticeDayCounts } from "./progress.js";

/**
 * Storage key, versioned in the NAME. A v2 with a different shape must not
 * try to read v1's bytes: an unreadable ledger is a lost streak, and a
 * silently mis-parsed one is a wrong streak, which is worse.
 */
export const LOCAL_PRACTICE_KEY = "foray:practice:v1";

/**
 * How many days a browser keeps, and how many it may hand over in one claim.
 * A year and a bit: long enough that no real habit is truncated, short enough
 * that the ledger cannot grow without bound in a browser that never signs in.
 */
export const MAX_LOCAL_DAYS = 400;

/** Rounds one day may hold. Beyond this the ledger stops counting, not the drill. */
export const MAX_LOCAL_SESSIONS_PER_DAY = 50;

/** One local day, plus whether it has already been handed to an account. */
export interface LocalPracticeDay extends PracticeDayCounts {
  /**
   * True once this day has been claimed into a signed-in account. Claimed
   * days are kept, not deleted: the browser goes on showing the streak it
   * always showed, and the flag is what stops the same day being counted
   * again into a SECOND account.
   */
  claimed: boolean;
}

export interface LocalPracticeLedger {
  days: LocalPracticeDay[];
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function emptyLocalLedger(): LocalPracticeLedger {
  return { days: [] };
}

/** An integer in [0, max], or null when the value is not one. */
function boundedInt(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) return null;
  return value;
}

/**
 * One day's counts from untrusted input, or null when the shape is not one.
 *
 * Used on BOTH sides of the claim — the browser reading back its own
 * localStorage (which any tab or extension can rewrite) and the server
 * reading a POSTed claim. One definition, because a rule enforced in two
 * places is two rules eventually.
 */
export function parsePracticeDay(value: unknown): PracticeDayCounts | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const day = raw.day;
  // Parseable as well as well-shaped: "2026-13-45" matches the pattern and is
  // not a date, and a day that is not a date breaks every gap calculation
  // downstream.
  if (typeof day !== "string" || !DAY_RE.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
    return null;
  }
  const sessions = boundedInt(raw.sessions, MAX_LOCAL_SESSIONS_PER_DAY);
  if (sessions === null || sessions < 1) return null;
  const answered = boundedInt(raw.answered, sessions * PRACTICE_DECK_SIZE);
  if (answered === null) return null;
  const correct = boundedInt(raw.correct, answered);
  if (correct === null) return null;
  return { day, sessions, answered, correct };
}

/** Fold duplicate days together, keeping the LARGER count of each field. */
function foldDays(days: readonly LocalPracticeDay[]): LocalPracticeDay[] {
  const byDay = new Map<string, LocalPracticeDay>();
  for (const d of days) {
    const prev = byDay.get(d.day);
    byDay.set(
      d.day,
      prev === undefined
        ? { ...d }
        : {
            day: d.day,
            sessions: Math.max(prev.sessions, d.sessions),
            answered: Math.max(prev.answered, d.answered),
            correct: Math.max(prev.correct, d.correct),
            // Claimed is sticky: a day handed to an account stays handed over.
            claimed: prev.claimed || d.claimed,
          },
    );
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Read a ledger out of whatever was in storage. NEVER throws and never
 * returns a partially-trusted object: junk, a truncated write, a v0 blob and
 * a hostile rewrite all degrade to the days that survive validation.
 */
export function parseLocalLedger(raw: string | null | undefined): LocalPracticeLedger {
  if (typeof raw !== "string" || raw === "") return emptyLocalLedger();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyLocalLedger();
  }
  const days = (parsed as { days?: unknown } | null)?.days;
  if (!Array.isArray(days)) return emptyLocalLedger();
  const kept: LocalPracticeDay[] = [];
  for (const entry of days) {
    const counts = parsePracticeDay(entry);
    if (counts === null) continue;
    kept.push({ ...counts, claimed: (entry as { claimed?: unknown }).claimed === true });
  }
  // Newest days win the cap: an old day is history, today is the streak.
  return { days: foldDays(kept).slice(-MAX_LOCAL_DAYS) };
}

export function serializeLocalLedger(ledger: LocalPracticeLedger): string {
  return JSON.stringify({ days: ledger.days });
}

/**
 * Add one FINISHED round to the ledger, on the browser's own local day.
 *
 * Only a round that qualified is recorded, which is the same rule the server
 * applies to `completed_at` — an abandoned or scripted round buys a day in
 * neither place. The caller decides qualification with `qualifiesForStreak`,
 * so there is one rule, not a local copy of it.
 */
export function recordLocalRound(
  ledger: LocalPracticeLedger,
  round: { day: string; answered: number; correct: number },
): LocalPracticeLedger {
  const existing = ledger.days.find((d) => d.day === round.day);
  const merged = parsePracticeDay({
    day: round.day,
    sessions: (existing?.sessions ?? 0) + 1,
    answered: (existing?.answered ?? 0) + round.answered,
    correct: (existing?.correct ?? 0) + round.correct,
  });
  // An impossible round (a day past the cap, a malformed date, more correct
  // than answered) leaves the ledger exactly as it was. The round still
  // happened on screen; it simply does not become a day.
  if (merged === null) return ledger;
  const rest = ledger.days.filter((d) => d.day !== round.day);
  return {
    days: foldDays([...rest, { ...merged, claimed: existing?.claimed === true }]).slice(-MAX_LOCAL_DAYS),
  };
}

/** Every day, as plain day strings — what `streakSummary` wants. */
export function localPracticeDayStrings(ledger: LocalPracticeLedger): string[] {
  return ledger.days.map((d) => d.day);
}

/**
 * The days a claim would hand over: everything not already claimed.
 *
 * A day claimed into one account is never offered to a second one. Two
 * accounts each holding "the same" streak would be a record of something that
 * did not happen, and the person it would mislead is the one who signed in.
 */
export function claimableDays(ledger: LocalPracticeLedger): PracticeDayCounts[] {
  return ledger.days
    .filter((d) => !d.claimed)
    .map(({ day, sessions, answered, correct }) => ({ day, sessions, answered, correct }));
}

/** Mark days as handed over, after the server has said it took them. */
export function markDaysClaimed(
  ledger: LocalPracticeLedger,
  days: readonly string[],
): LocalPracticeLedger {
  const claimed = new Set(days);
  return { days: ledger.days.map((d) => (claimed.has(d.day) ? { ...d, claimed: true } : d)) };
}

/**
 * A whole claim body from untrusted input: the SERVER's validator, and the
 * browser's own check before it sends.
 *
 * Bad days are dropped rather than failing the claim. A claim is somebody's
 * streak arriving at the one moment they finally signed up; losing all of it
 * because one entry is malformed is the failure this feature exists to
 * prevent.
 */
export function sanitizeClaimDays(value: unknown): PracticeDayCounts[] {
  if (!Array.isArray(value)) return [];
  const kept: LocalPracticeDay[] = [];
  for (const entry of value) {
    const counts = parsePracticeDay(entry);
    if (counts !== null) kept.push({ ...counts, claimed: false });
  }
  return foldDays(kept)
    .slice(-MAX_LOCAL_DAYS)
    .map(({ day, sessions, answered, correct }) => ({ day, sessions, answered, correct }));
}

/**
 * Merge server-recorded days with days that came from a browser.
 *
 * Per field, the LARGER of the two — never the sum. The same round can be in
 * both (a browser records its own round, then the account it later claimed
 * into holds it too), and adding those together would inflate a person's
 * record with arithmetic. Max is idempotent, so claiming twice changes
 * nothing.
 */
export function mergePracticeDays(
  server: readonly PracticeDayCounts[],
  local: readonly PracticeDayCounts[],
): PracticeDayCounts[] {
  return foldDays([
    ...server.map((d) => ({ ...d, claimed: false })),
    ...local.map((d) => ({ ...d, claimed: false })),
  ]).map(({ day, sessions, answered, correct }) => ({ day, sessions, answered, correct }));
}

// ---------------------------------------------------------------------------
// The wording of the ask
// ---------------------------------------------------------------------------

/**
 * What a browser-kept streak is, said once. Every surface that shows an
 * anonymous streak imports this rather than paraphrasing it — the same rule
 * `PROGRESS_BASIS` and `PRACTICE_EFFICACY_NOTE` follow.
 */
export const LOCAL_PRACTICE_BASIS =
  "Your practice days are kept in this browser, not on our servers. No account, and nothing "
  + "about you leaves this device. Clearing your site data ends it, and it will not follow you "
  + "to another browser or another device.";

/**
 * What signing in actually buys. Three true things, in the order they matter,
 * and nothing about what you would LOSE — a streak already earned is not a
 * hostage, and this list may never be rewritten to imply it is.
 *
 * `apps/web/test/anonymousOnRamp.test.tsx` holds the tone: no countdown, no
 * scarcity, no "before it is too late".
 */
export const SIGN_IN_VALUE = [
  "A sitting that counts — a scored run of the real examination, on the record.",
  "Your practice days on your account, so a new browser or a new device still knows you.",
  "A credential you can show, verifiable by whoever you show it to.",
] as const;

/** One sentence for the same ask where a list will not fit. */
export const SIGN_IN_VALUE_SHORT =
  "An account is for a scored sitting, progress that survives a new device, and a credential "
  + "you can show. Practice needs none of them.";

/**
 * What happens to the browser's days at sign-in. Shown BEFORE the ask, not
 * after it, because a promise kept quietly is indistinguishable from a promise
 * not made.
 */
export const CLAIM_PROMISE =
  "If you do sign in, the practice days this browser is holding move to your account. "
  + "Nothing is dropped, and you keep playing either way.";

/**
 * How claimed days are labelled once they are on an account. They are the
 * browser's word, not the server's stamp, and the progress page says so
 * rather than blending them invisibly into days we measured ourselves.
 */
export const CLAIMED_DAYS_BASIS =
  "Practice days you brought with you from a browser before signing in. They are counted from "
  + "what that browser reported, not from rounds we recorded, so they are shown as your own "
  + "record rather than as our measurement. They reach no score.";
