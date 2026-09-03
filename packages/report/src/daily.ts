/**
 * THE DAILY CHALLENGE — one set of cards a day, the same for everyone, and a
 * result grid that says how it went without saying what the answers were.
 *
 * Wordle's shape, deliberately: a minute of play, a fixed set per calendar
 * day, a spoiler-free grid, and a streak. Everything that decides WHICH cards
 * and WHAT the grid says is here, pure and injectable; the words that travel
 * with the grid are in `./shareText.ts` (one module owns share copy), the
 * browser state is `apps/web/features/daily/dailyState.ts`, and the page is
 * `apps/web/app/daily`.
 *
 * FOUR RULES THIS MODULE EXISTS TO HOLD.
 *
 * 1. THE GRID CANNOT LEAK A KEY. `dailyGrid` takes a vector of
 *    {@link DailyResult} — hit, miss, skip — and NOTHING else. It never sees
 *    an item, a key, a choice or a family, so it cannot encode one, and the
 *    only thing a reader learns from a published grid is how many calls the
 *    poster got right. That is a type-level guarantee and it is also
 *    mutation-tested: `packages/report/test/daily.test.ts` flips every key in
 *    the pool and asserts the grid for a given result vector is byte
 *    identical, and that every grid stays consistent with BOTH keys at every
 *    position. Anything richer — a per-item glyph that differs for "called AI
 *    correctly" versus "called real correctly" — would publish the day's
 *    answers to everyone who has not played, and is therefore banned by that
 *    test rather than by review habit.
 *
 *    What this is NOT is exam security. The daily draws on PUBLISHED content
 *    (see rule 3): a determined reader can open the bundle and read the keys.
 *    The grid guard protects the READ — the thing a person sees in a feed
 *    before they have played — which is the only thing that can actually be
 *    spoiled here. The operational bank's secrecy is a different problem,
 *    solved in a different repository, and nothing in this file touches it.
 *
 * 2. DETERMINISM, WITH THE TIMEZONE WRITTEN DOWN. The deck is a pure function
 *    of (calendar day, pool). The day is the PLAYER'S OWN local calendar day
 *    — `dailyDay(nowMs, tzOffsetMinutes)`, which is `localDay` from
 *    ./progress.ts, the same rule the practice streak already uses. So the
 *    puzzle rolls over at local midnight, everyone playing on the same
 *    calendar date gets the same cards, and no server round trip is needed to
 *    agree on what today is. The cost is stated rather than hidden: two people
 *    in different zones get "today" at different absolute instants, and
 *    somebody who flies east may skip a puzzle number or meet the next one
 *    early. That is Wordle's rule and it is the one people expect; the
 *    alternative (a UTC rollover) puts the reset in the middle of the evening
 *    for half the planet.
 *
 * 3. PUBLIC CONTENT ONLY. The pool is assembled by the caller from the
 *    RELEASED-PRACTICE tier (`instruments/demo-2026.1`, whose keys are
 *    published on purpose) and the practice corpus (`instruments/practice`),
 *    which is the other public, deliberately-not-operational body of content
 *    in this repository. The operational bank is not in this repository at
 *    all and cannot be reached from here — `packages/content-tools/test/
 *    public-tree.test.ts` and `apps/web/test/bundleSecrecy.test.ts` keep it
 *    that way. `dailyPoolFromPractice()` is the practice half; the released
 *    half is mapped in `apps/web/lib/instrument/demoItems.ts`, where the snapshot lives.
 *
 * 4. NO SCORE OF RECORD, EVER. A daily result is not a sitting. It reaches no
 *    `score()`, no composite, no credential and no report figure, exactly as
 *    practice does not (spec §13: game mechanics live in onboarding, pacing,
 *    reveal and social layers, never in score()). A streak here means the same
 *    thing it means there — you came back — and never that you improved;
 *    `packages/report/test/efficacyClaims.test.ts` scans the words in this
 *    package for the claim we do not make.
 *
 * Pure: no clock, no storage, no network. `nowMs` is injected.
 */
import { seededUniform, sha256Hex } from "@ailx/session";
import {
  CLEAN_CHOICE,
  PRACTICE_BANK,
  PRACTICE_OPTIONS,
  SIGNAL_CHOICE,
  seededShuffle,
  type PracticeItem,
} from "./practice.js";
import { MAX_LOCAL_DAYS } from "./localPractice.js";
import {
  addDays,
  daysBetween,
  isCalendarDay,
  localDay,
  streakSummary,
  type StreakSummary,
} from "./progress.js";

// ---------------------------------------------------------------------------
// The day
// ---------------------------------------------------------------------------

/**
 * Day zero. Puzzle #1 is played on this date; the number is what a share text
 * carries, so it must never be recomputed from anything but this constant.
 */
export const DAILY_EPOCH = "2026-01-01";

/**
 * The player's own calendar day, from their own device clock. Re-exported
 * shape of `localDay` (./progress.ts) so the daily and the practice streak
 * cannot drift apart on what a day is.
 *
 * `tzOffsetMinutes` is minutes EAST of UTC, i.e. `-new Date().getTimezoneOffset()`.
 */
export function dailyDay(nowMs: number, tzOffsetMinutes: number): string {
  return localDay(nowMs, tzOffsetMinutes);
}

/**
 * The puzzle number for a day: #1 on {@link DAILY_EPOCH}, counting up. Days
 * before the epoch are 0 or negative — they are returned honestly rather than
 * clamped, and {@link dailyDeck} still deals, because a device whose clock is
 * wrong should get a playable round and not an exception.
 */
export function dailyNumber(day: string): number {
  return daysBetween(DAILY_EPOCH, day) + 1;
}

/** The day a puzzle number belongs to — the inverse of {@link dailyNumber}. */
export function dailyDayOfNumber(n: number): string {
  return addDays(DAILY_EPOCH, n - 1);
}

// ---------------------------------------------------------------------------
// The cards
// ---------------------------------------------------------------------------

/**
 * Licence and attribution, carried on the card because CC-BY and CC-BY-SA
 * REQUIRE it wherever the work is shown. A card whose source demands credit
 * and does not render it is a licence breach, not a styling choice.
 */
export interface DailyCredit {
  author: string;
  license: string;
  sourceUrl?: string;
}

export type DailyMaterial =
  | { kind: "image"; src: string; alt: string }
  /** `title` is a header line (a message's sender and subject), never the answer. */
  | { kind: "text"; title?: string; text: string };

/**
 * One card of the day, normalised across the two public sources so the page
 * has ONE thing to render.
 *
 * `options[0]` is always the SIGNAL call — generated, AI-written, hostile —
 * matching `SIGNAL_CHOICE` in ./practice.ts. Signal-detection language and
 * the deck balance are both defined against that index, so the order is
 * load-bearing and asserted.
 */
export interface DailyCard {
  id: string;
  /** The question, shown above the material. */
  stem: string;
  material: DailyMaterial;
  options: readonly [string, string];
  /** Index into `options` of the correct call. */
  key: 0 | 1;
  /** Shown after the call — the teaching, never before. */
  tell: string;
  credit: DailyCredit | null;
}

/** The question every image card asks. One wording, so cards read alike. */
export const DAILY_IMAGE_STEM = "Real photograph, or AI-generated?";

/** Cards per day. Five binary calls is about a minute, which is the point. */
export const DAILY_DECK_SIZE = 5;

/**
 * The most cards of ONE side a single day can ask for. The split varies
 * (see {@link dailySignalCount}), so a cycle must budget for the larger half
 * on both sides.
 */
const MAX_PER_SIDE = Math.ceil(DAILY_DECK_SIZE / 2);

/**
 * Bumped when the meaning of a deck changes rather than its content — a new
 * deck size, a new balance rule. It is in the seed, so bumping it reshuffles
 * every future day; the POOL's own content is in the seed too (below), so a
 * corpus edit already reshuffles without touching this.
 */
export const DAILY_RULE_VERSION = "daily-2026.1-1";

/** The practice corpus as daily cards. The other half of the pool is released. */
export function dailyPoolFromPractice(bank: readonly PracticeItem[] = PRACTICE_BANK): DailyCard[] {
  return bank.map((item) => dailyCardFromPractice(item));
}

/** One practice item as a card. Exported for the app's pool assembly and tests. */
export function dailyCardFromPractice(item: PracticeItem): DailyCard {
  return {
    id: item.id,
    stem: DAILY_IMAGE_STEM,
    material: { kind: "image", src: item.material.src, alt: item.material.alt },
    options: [PRACTICE_OPTIONS[SIGNAL_CHOICE], PRACTICE_OPTIONS[CLEAN_CHOICE]],
    key: item.key === SIGNAL_CHOICE ? 0 : 1,
    tell: item.tell,
    credit: {
      author: item.credit.author,
      license: item.credit.license,
      ...(item.credit.source_url === undefined ? {} : { sourceUrl: item.credit.source_url }),
    },
  };
}

/**
 * Content address of a pool: its ids, sorted, hashed. It is part of the deck
 * seed, so two builds with different content deal different days and cannot
 * silently disagree about what "puzzle #37" was — and a golden test pins the
 * digest, so changing the pool is a decision somebody makes on purpose.
 */
export function dailyPoolDigest(pool: readonly DailyCard[]): string {
  return sha256Hex(
    [...pool]
      .map((c) => c.id)
      .sort()
      .join("\n"),
  );
}

/** Floor division that also behaves for days before the epoch. */
const floorDiv = (a: number, b: number): number => Math.floor(a / b);

/**
 * How many cards of the day are SIGNAL (generated / AI-written / hostile).
 *
 * It varies between 2 and 3 per day rather than sitting at a fixed split.
 * A fixed split is a free answer: "three of these five are AI" turns the last
 * card into arithmetic instead of a call, for every player, every day. Making
 * it vary costs nothing and keeps the round honest for somebody who has not
 * read the source.
 */
function dailySignalCount(cycleSeed: string, offset: number): number {
  return seededUniform(`${cycleSeed}:split`, offset) < 0.5
    ? MAX_PER_SIDE
    : DAILY_DECK_SIZE - MAX_PER_SIDE;
}

/**
 * How many days a pool can deal before an item comes back.
 *
 * Days are dealt in CYCLES: one deterministic shuffle of each side per cycle,
 * then a slice per day. Inside a cycle no card repeats, which is the whole
 * reason for the machinery — a daily that showed you yesterday's picture again
 * would be a broken puzzle, and randomising each day independently does that
 * about a third of the time on a corpus this size. The bound budgets
 * MAX_PER_SIDE from BOTH sides so any split sequence fits.
 *
 * THE SEAM IS NOT FIXED, and that is a decision. A card CAN come back on the
 * first day of the next cycle, because the next cycle's shuffle is a pure
 * function of its own index and knows nothing about the day before it.
 * Carrying that knowledge across the boundary means either recursing back to
 * the epoch or bolting a repair onto the slice, and both cost more than the
 * defect: measured over 400 days on the real pool it is well under one card a
 * week (`packages/report/test/daily.test.ts` pins the rate, so it cannot get
 * quietly worse). The page says the pool is small out loud rather than
 * implying a fuller one than exists.
 */
export function dailyCycleLength(pool: readonly DailyCard[]): number {
  const signal = pool.filter((c) => c.key === 0).length;
  const clean = pool.length - signal;
  return Math.max(1, floorDiv(Math.min(signal, clean), MAX_PER_SIDE));
}

/**
 * The cards for one calendar day — pure in (day, pool), and stable however
 * the caller ordered the pool.
 *
 * Degrades honestly on a thin pool instead of throwing or repeating: if a
 * side cannot fill its share the deck is SHORTER, never padded with a
 * duplicate and never silently unbalanced. A pool at or below the deck size
 * is dealt whole, in a per-day order.
 */
export function dailyDeck(day: string, pool: readonly DailyCard[]): DailyCard[] {
  const sorted = [...pool].sort((a, b) => a.id.localeCompare(b.id));
  if (sorted.length === 0) return [];
  const base = `${DAILY_RULE_VERSION}:${dailyPoolDigest(sorted)}`;
  if (sorted.length <= DAILY_DECK_SIZE) return seededShuffle(sorted, `${base}:${day}:order`);

  const cycleLength = dailyCycleLength(sorted);
  const n = dailyNumber(day) - 1;
  const cycle = floorDiv(n, cycleLength);
  const offset = n - cycle * cycleLength;
  const cycleSeed = `${base}:cycle:${cycle}`;

  const signal = seededShuffle(sorted.filter((c) => c.key === 0), `${cycleSeed}:signal`);
  const clean = seededShuffle(sorted.filter((c) => c.key === 1), `${cycleSeed}:clean`);

  // Consume the cycle from the start so every earlier day's cards are spent:
  // the day's slice is what is left after the days before it took theirs.
  let signalTaken = 0;
  let cleanTaken = 0;
  for (let d = 0; d < offset; d++) {
    const s = dailySignalCount(cycleSeed, d);
    signalTaken += s;
    cleanTaken += DAILY_DECK_SIZE - s;
  }
  const wantSignal = dailySignalCount(cycleSeed, offset);
  const deck = [
    ...signal.slice(signalTaken, signalTaken + wantSignal),
    ...clean.slice(cleanTaken, cleanTaken + (DAILY_DECK_SIZE - wantSignal)),
  ];
  return seededShuffle(deck, `${cycleSeed}:order:${offset}`);
}

// ---------------------------------------------------------------------------
// The result — and the grid, which is the only thing that leaves
// ---------------------------------------------------------------------------

/**
 * What happened on one card. THREE outcomes, and no more:
 *
 *  - `hit`  — the call was right;
 *  - `miss` — the call was wrong;
 *  - `skip` — nothing was called. The picture never arrived, or the round was
 *    left. A card nobody could see is not a call somebody got wrong.
 *
 * This type is the ENTIRE input to the grid. It carries no key, no choice and
 * no item, which is why publishing a grid cannot publish an answer.
 */
export type DailyResult = "hit" | "miss" | "skip";

/**
 * The glyphs, chosen to survive the places a result actually gets pasted.
 *
 * Every one is a plain Unicode block emoji in the oldest, widest-supported
 * set — the same family Wordle's grid uses — so X, LinkedIn and WhatsApp all
 * render them as coloured squares in a paste, with no image and no fallback
 * tofu, and so does a plain-text SMS on a phone from 2018.
 *
 * Colour is never the only cue: `dailyShareText` always prints the tally
 * beside the grid, so a red/green-confusable reader (and a screen reader,
 * which announces these as "green square", "red square") gets the same fact
 * in words. The white square for a skipped card reads as "nothing happened
 * here" in both light and dark themes, which is exactly what it means.
 */
export const DAILY_GLYPH: Readonly<Record<DailyResult, string>> = {
  hit: "\u{1F7E9}",
  miss: "\u{1F7E5}",
  skip: "\u2B1C",
};

/**
 * Grade one call. `choice` is an index into the card's options, or null when
 * the card was skipped; anything out of range is a miss rather than a throw,
 * because a hostile or broken client should get a wrong answer, not a crash
 * (same rule as `gradePractice`).
 */
export function gradeDailyCard(card: DailyCard, choice: number | null): DailyResult {
  if (choice === null) return "skip";
  return choice === card.key ? "hit" : "miss";
}

/** Grade a whole round. Missing answers are skips, never misses. */
export function gradeDailyRound(
  deck: readonly DailyCard[],
  choices: ReadonlyArray<number | null>,
): DailyResult[] {
  return deck.map((card, i) => gradeDailyCard(card, choices[i] ?? null));
}

/**
 * THE GRID. One glyph per card, in the order the cards were shown.
 *
 * Order is safe to keep: the day's deck is the same for everybody, so the
 * position of a glyph is public knowledge already, and "we both missed the
 * third one" is the conversation this feature is for. What is NOT in here is
 * anything that separates a right "AI" call from a right "real" call — see
 * the module note, rule 1.
 */
export function dailyGrid(results: readonly DailyResult[]): string {
  return results.map((r) => DAILY_GLYPH[r]).join("");
}

/** Right calls out of the calls actually made. Skips are in neither number. */
export interface DailyTally {
  hits: number;
  /** Cards that were actually called (hits + misses). */
  called: number;
  /** Cards dealt, including skipped ones. */
  dealt: number;
}

export function dailyTally(results: readonly DailyResult[]): DailyTally {
  return {
    hits: results.filter((r) => r === "hit").length,
    called: results.filter((r) => r !== "skip").length,
    dealt: results.length,
  };
}

/** A finished day, as the browser stores it and the share text reads it. */
export interface DailyRound {
  /** The local calendar day it was played on. */
  day: string;
  /** The puzzle number, frozen at play time so a share cannot drift. */
  number: number;
  results: DailyResult[];
}

/**
 * A round is only worth a streak day if the whole deck was answered. Skips
 * are forgiven — an image that never loaded is not the player's fault — but
 * an abandoned round is not a day played.
 *
 * Accuracy is deliberately NOT a condition, for the reason `qualifiesForStreak`
 * gives about practice: being wrong is how the tell gets taught, and a streak
 * that demanded correctness would push people to look the answer up.
 */
export function dailyRoundComplete(round: DailyRound, deckSize: number): boolean {
  return round.results.length === deckSize && round.results.length > 0;
}

/**
 * The daily streak. It is `streakSummary` (./progress.ts) over the days a
 * round was finished — the SAME rule as the practice streak, including the
 * one-rest-day-a-week clause, because two different streak rules in one
 * product is a thing people notice and nobody can explain.
 *
 * A streak counts RETURNS, not skill. Nothing here reads a tally.
 */
export function dailyStreak(days: readonly string[], today: string): StreakSummary {
  return streakSummary(days, today);
}

// ---------------------------------------------------------------------------
// The browser's own record
// ---------------------------------------------------------------------------

/**
 * Where a browser keeps its daily history, and why it keeps it there.
 *
 * The same answer the anonymous practice ledger gives (./localPractice.ts):
 * localStorage, because the loop has to work in the static export and for
 * somebody who has agreed to nothing. A daily result is not a score of record
 * — it reaches no attempt, no `score()`, no credential and no cohort figure —
 * so there is nothing here a server would need to attest, and no row to
 * delete later because there is no row.
 *
 * The cost is said on the page rather than hidden: clearing site data ends
 * the streak, and it does not follow anyone to a second device.
 *
 * The key is versioned in the NAME. A v2 with a different shape must not try
 * to read v1's bytes: an unreadable streak is a lost one, and a silently
 * mis-parsed one is a WRONG one, which is worse.
 */
export const DAILY_LEDGER_KEY = "ailx:daily:v1";

/**
 * Days kept. The same cap as the practice ledger's `MAX_LOCAL_DAYS`, imported
 * rather than re-chosen: two different memories of "how long a browser
 * remembers you" would be two answers to one question a person asks once.
 */
export { MAX_LOCAL_DAYS as MAX_DAILY_DAYS } from "./localPractice.js";

export interface DailyLedger {
  /** Local days on which a full round was finished. Sorted, de-duplicated. */
  days: string[];
  /**
   * The most recent finished round. It is what makes today's result survive a
   * reload — and what stops a second play of the same day, which would make
   * the grid a lie.
   */
  last: DailyRound | null;
}

export function emptyDailyLedger(): DailyLedger {
  return { days: [], last: null };
}

const DAILY_RESULTS = new Set<string>(["hit", "miss", "skip"]);

/** Days that survive validation, de-duplicated, sorted, and capped. */
function keptDays(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  // Newest days win the cap: an old day is history, today is the streak.
  return [...new Set(value.filter((d): d is string => isCalendarDay(d)))].sort().slice(-MAX_LOCAL_DAYS);
}

/** One stored round from untrusted input, or null when the shape is not one. */
export function parseDailyRound(value: unknown): DailyRound | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (!isCalendarDay(raw.day)) return null;
  if (typeof raw.number !== "number" || !Number.isInteger(raw.number)) return null;
  if (!Array.isArray(raw.results) || raw.results.length > DAILY_DECK_SIZE) return null;
  if (!raw.results.every((r) => typeof r === "string" && DAILY_RESULTS.has(r))) return null;
  // The number is not trusted from storage either: it is a pure function of
  // the day, so a rewritten one is simply recomputed rather than published.
  return { day: raw.day, number: dailyNumber(raw.day), results: raw.results as DailyResult[] };
}

/**
 * Read a ledger out of whatever was in storage. NEVER throws and never
 * returns a partially-trusted object: junk, a truncated write, a v0 blob and
 * a hostile rewrite all degrade to the days that survive validation.
 */
export function parseDailyLedger(raw: string | null | undefined): DailyLedger {
  if (typeof raw !== "string" || raw === "") return emptyDailyLedger();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyDailyLedger();
  }
  if (typeof parsed !== "object" || parsed === null) return emptyDailyLedger();
  const { days, last } = parsed as { days?: unknown; last?: unknown };
  return { days: keptDays(days), last: parseDailyRound(last) };
}

export function serializeDailyLedger(ledger: DailyLedger): string {
  return JSON.stringify({ days: ledger.days, last: ledger.last });
}

/**
 * Add one finished round to the ledger.
 *
 * A day is bought only by a COMPLETE round (`dailyRoundComplete`): an
 * abandoned one is still on screen and still unscored, it simply is not a day
 * played. Replaying a day already recorded cannot add it twice, because
 * `days` is a set.
 */
export function recordDailyRound(
  ledger: DailyLedger,
  round: DailyRound,
  deckSize: number,
): DailyLedger {
  const valid = parseDailyRound(round);
  if (valid === null) return ledger;
  return {
    days: dailyRoundComplete(valid, deckSize) ? keptDays([...ledger.days, valid.day]) : ledger.days,
    last: valid,
  };
}
