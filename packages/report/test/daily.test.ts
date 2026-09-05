/**
 * THE DAILY CHALLENGE — determinism, the day boundary, and the leak guard.
 *
 * The third of those is why this file is long. A daily puzzle's share grid is
 * the one artefact of this product that is DESIGNED to be pasted in public by
 * somebody who has just seen the answers, in front of people who have not.
 * Wordle's grid is safe because it shows pattern and never content; ours has
 * to be safe for the same reason and it has to be PROVED safe, because "the
 * grid looks harmless" is exactly what somebody will think while adding a
 * fourth glyph for "called AI correctly".
 *
 * So the leak guard here is a mutation test, not an eyeball: it flips the
 * keys of the real pool, enumerates every answer a player could give, and
 * asserts that what leaves the page is a function of hit/miss/skip and of
 * nothing else. If a future glyph, tally or sentence ever varies with a KEY,
 * these tests fail.
 */
import { describe, expect, it } from "vitest";
import {
  DAILY_DECK_SIZE,
  DAILY_EPOCH,
  DAILY_GLYPH,
  DAILY_PITCH,
  DAILY_STREAK_MEANING,
  SHARE_NETWORKS,
  X_TEXT_MAX,
  dailyCardSpoilers,
  dailyCycleLength,
  dailyDay,
  dailyDayOfNumber,
  dailyDeck,
  dailyGrid,
  dailyNumber,
  dailyPoolDigest,
  dailyPoolFromPractice,
  dailyRoundComplete,
  dailyShareIntentUrl,
  dailyShareLeaks,
  dailyShareText,
  dailyShareTitle,
  dailyStreak,
  dailyTally,
  dailyTallyLine,
  gradeDailyCard,
  gradeDailyRound,
  shareTextViolations,
  streakSummary,
  type DailyCard,
  type DailyResult,
  type ShareChannel,
} from "../src/index.js";

/** The practice half of the real pool — the half this package owns. */
const POOL = dailyPoolFromPractice();

/** A synthetic pool big enough to exercise the cycle, with a known balance. */
function pool(nSignal: number, nClean: number): DailyCard[] {
  const make = (i: number, key: 0 | 1): DailyCard => ({
    id: `fixture:${key}:${String(i).padStart(3, "0")}`,
    stem: "Real photograph, or AI-generated?",
    material: { kind: "image", src: `img/${key}-${i}.jpg`, alt: `a picture numbered ${i}` },
    options: ["AI-generated", "Real photograph"],
    key,
    tell: `the tell for card ${key}-${i}, which is long enough to be a spoiler`,
    credit: null,
  });
  return [
    ...Array.from({ length: nSignal }, (_, i) => make(i, 0)),
    ...Array.from({ length: nClean }, (_, i) => make(i, 1)),
  ];
}

const BIG = pool(20, 20);
const CHANNELS: ShareChannel[] = ["x", "linkedin", "whatsapp", "native"];

/** Every day from `from`, inclusive. */
function days(from: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => dailyDayOfNumber(dailyNumber(from) + i));
}

// ---------------------------------------------------------------------------
// The day, and the timezone decision
// ---------------------------------------------------------------------------

describe("the day", () => {
  it("numbers the epoch #1 and counts up", () => {
    expect(dailyNumber(DAILY_EPOCH)).toBe(1);
    expect(dailyNumber("2026-01-02")).toBe(2);
    expect(dailyNumber("2027-01-01")).toBe(366);
  });

  it("round-trips a number to its day", () => {
    for (const n of [1, 2, 37, 365, 1000]) {
      expect(dailyNumber(dailyDayOfNumber(n))).toBe(n);
    }
  });

  it("is honest about days before the epoch rather than clamping", () => {
    expect(dailyNumber("2025-12-31")).toBe(0);
    // A device whose clock is wrong still gets a playable round.
    expect(dailyDeck("2025-12-25", BIG)).toHaveLength(DAILY_DECK_SIZE);
  });

  it("rolls over at LOCAL midnight, not at UTC midnight", () => {
    // 2026-03-01T23:30Z. In Tokyo (UTC+9) it is already the 2nd; in Los
    // Angeles (UTC-8) it is still the 1st.
    const instant = Date.parse("2026-03-01T23:30:00.000Z");
    expect(dailyDay(instant, 9 * 60)).toBe("2026-03-02");
    expect(dailyDay(instant, -8 * 60)).toBe("2026-03-01");
    expect(dailyDay(instant, 0)).toBe("2026-03-01");
  });

  it("gives everyone on the same calendar date the same cards", () => {
    // Two players, twelve hours and one hemisphere apart, both on the 2nd.
    const tokyo = dailyDay(Date.parse("2026-03-02T01:00:00.000Z"), 9 * 60);
    const berlin = dailyDay(Date.parse("2026-03-02T09:00:00.000Z"), 60);
    expect(tokyo).toBe(berlin);
    expect(dailyDeck(tokyo, BIG)).toEqual(dailyDeck(berlin, BIG));
  });

  it("changes the deck the moment the local day changes", () => {
    const before = dailyDay(Date.parse("2026-03-01T22:59:00.000Z"), 60);
    const after = dailyDay(Date.parse("2026-03-01T23:01:00.000Z"), 60);
    expect(before).toBe("2026-03-01");
    expect(after).toBe("2026-03-02");
    expect(dailyDeck(before, BIG)).not.toEqual(dailyDeck(after, BIG));
  });

  it("survives an absurd or hostile offset by clamping to a real one", () => {
    const instant = Date.parse("2026-03-01T12:00:00.000Z");
    expect(dailyDay(instant, 999_999)).toBe(dailyDay(instant, 14 * 60));
    expect(dailyDay(instant, Number.NaN)).toBe(dailyDay(instant, 0));
  });
});

// ---------------------------------------------------------------------------
// The deck
// ---------------------------------------------------------------------------

describe("the deck", () => {
  it("is the same set for the same day and pool, whatever order the pool arrived in", () => {
    const shuffled = [...BIG].reverse();
    expect(dailyDeck("2026-05-05", shuffled)).toEqual(dailyDeck("2026-05-05", BIG));
  });

  it("deals exactly the deck size, without repeating a card", () => {
    for (const day of days("2026-01-01", 60)) {
      const deck = dailyDeck(day, BIG);
      expect(deck).toHaveLength(DAILY_DECK_SIZE);
      expect(new Set(deck.map((c) => c.id)).size).toBe(DAILY_DECK_SIZE);
    }
  });

  it("only ever deals cards that are in the pool", () => {
    const ids = new Set(BIG.map((c) => c.id));
    for (const day of days("2026-01-01", 60)) {
      for (const card of dailyDeck(day, BIG)) expect(ids.has(card.id)).toBe(true);
    }
  });

  it("balances the two calls, and does not sit on one split", () => {
    const splits = days("2026-01-01", 60).map(
      (day) => dailyDeck(day, BIG).filter((c) => c.key === 0).length,
    );
    for (const s of splits) expect([2, 3]).toContain(s);
    expect(new Set(splits).size).toBe(2); // both splits really occur
  });

  it("never repeats a card inside a cycle", () => {
    const length = dailyCycleLength(BIG);
    expect(length).toBeGreaterThan(1);
    for (let cycle = 0; cycle < 6; cycle++) {
      const seen = days(dailyDayOfNumber(1 + cycle * length), length).flatMap((day) =>
        dailyDeck(day, BIG).map((c) => c.id),
      );
      expect(new Set(seen).size).toBe(seen.length);
    }
  });

  /**
   * The seam is a KNOWN, bounded defect (see `dailyCycleLength`). This pins
   * the rate on the real pool so it cannot get quietly worse — a change that
   * pushed repeats above one day in five fails here and has to be argued for.
   */
  it("repeats yesterday's card only rarely, at the cycle seam", () => {
    const span = days("2026-01-01", 400);
    let repeated = 0;
    for (let i = 1; i < span.length; i++) {
      const yesterday = new Set(dailyDeck(span[i - 1], POOL).map((c) => c.id));
      if (dailyDeck(span[i], POOL).some((c) => yesterday.has(c.id))) repeated++;
    }
    expect(repeated / (span.length - 1)).toBeLessThan(0.2);
  });

  it("deals a thin pool whole rather than padding it with duplicates", () => {
    const thin = pool(2, 2);
    const deck = dailyDeck("2026-04-04", thin);
    expect(deck).toHaveLength(4);
    expect(new Set(deck.map((c) => c.id)).size).toBe(4);
  });

  it("degrades honestly when one side of the pool is empty", () => {
    const oneSided = pool(9, 0);
    const deck = dailyDeck("2026-04-04", oneSided);
    // Never unbalanced by invention: it deals what it can, and never repeats.
    expect(new Set(deck.map((c) => c.id)).size).toBe(deck.length);
    expect(deck.every((c) => c.key === 0)).toBe(true);
  });

  it("deals nothing from an empty pool instead of throwing", () => {
    expect(dailyDeck("2026-04-04", [])).toEqual([]);
  });

  it("re-deals every future day when the pool changes", () => {
    const grown = [...BIG, ...pool(1, 1).map((c) => ({ ...c, id: `${c.id}:new` }))];
    expect(dailyPoolDigest(grown)).not.toBe(dailyPoolDigest(BIG));
    expect(dailyDeck("2026-06-06", grown)).not.toEqual(dailyDeck("2026-06-06", BIG));
  });

  it("puts the signal call first on every card, so the balance rule means what it says", () => {
    for (const card of POOL) {
      expect(card.options[0]).toBe("AI-generated");
      expect(card.key === 0 || card.key === 1).toBe(true);
    }
  });

  it("carries the licence and attribution every practice picture is shown under", () => {
    for (const card of POOL) {
      expect(card.credit).not.toBeNull();
      expect(card.credit!.author.length).toBeGreaterThan(0);
      expect(card.credit!.license.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

describe("grading", () => {
  const card = BIG[0];

  it("grades a right call, a wrong call and an unanswered card", () => {
    expect(gradeDailyCard(card, card.key)).toBe("hit");
    expect(gradeDailyCard(card, 1 - card.key)).toBe("miss");
    expect(gradeDailyCard(card, null)).toBe("skip");
  });

  it("treats a nonsense choice as a miss, never as a crash", () => {
    expect(gradeDailyCard(card, 7)).toBe("miss");
    expect(gradeDailyCard(card, -1)).toBe("miss");
  });

  it("counts a short round's missing answers as skips, not as misses", () => {
    const deck = dailyDeck("2026-02-02", BIG);
    const results = gradeDailyRound(deck, [deck[0].key, null]);
    expect(results).toHaveLength(DAILY_DECK_SIZE);
    expect(results.slice(1).every((r) => r === "skip")).toBe(true);
  });

  it("keeps skipped cards out of both halves of the tally", () => {
    expect(dailyTally(["hit", "miss", "skip", "hit", "skip"])).toEqual({
      hits: 2,
      called: 3,
      dealt: 5,
    });
  });

  it("counts a day only when the whole deck was answered", () => {
    const full: DailyResult[] = ["hit", "miss", "skip", "hit", "hit"];
    expect(dailyRoundComplete({ day: "2026-02-02", number: 33, results: full }, 5)).toBe(true);
    expect(dailyRoundComplete({ day: "2026-02-02", number: 33, results: full.slice(0, 4) }, 5))
      .toBe(false);
    expect(dailyRoundComplete({ day: "2026-02-02", number: 33, results: [] }, 5)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE LEAK GUARD
// ---------------------------------------------------------------------------

/** Every choice a player could make on a five-card deck. */
function allChoiceVectors(size: number): number[][] {
  return Array.from({ length: 2 ** size }, (_, mask) =>
    Array.from({ length: size }, (_, i) => (mask >> i) & 1),
  );
}

/** The same pool with every answer key flipped. */
const flipped = (cards: readonly DailyCard[]): DailyCard[] =>
  cards.map((c) => ({ ...c, key: (1 - c.key) as 0 | 1 }));

describe("the grid does not leak the day's answers", () => {
  const DAY = "2026-03-17";
  const deck = dailyDeck(DAY, BIG);

  it("is built from hit/miss/skip and from nothing else", () => {
    // The mutation: flip every key in the pool. A player who answers the
    // mirror image of their old answers gets the same result vector — and
    // must therefore get a byte-identical grid, or the grid is carrying
    // something about the key.
    const mirrorDeck = dailyDeck(DAY, flipped(BIG));
    expect(mirrorDeck.map((c) => c.id)).not.toHaveLength(0);
    for (const choices of allChoiceVectors(deck.length)) {
      const results = gradeDailyRound(deck, choices);
      const mirror = gradeDailyRound(
        mirrorDeck,
        mirrorDeck.map((c, i) => (results[i] === "hit" ? c.key : 1 - c.key)),
      );
      expect(mirror).toEqual(results);
      expect(dailyGrid(mirror)).toBe(dailyGrid(results));
    }
  });

  it("leaves every card's key equally possible to a reader who sees the grid", () => {
    // For every grid a day can produce, and for every position in it, BOTH
    // keys stay consistent with what was published. That is the property a
    // spoiler-free grid has to have: seeing it must narrow nothing.
    const grids = new Map<string, Array<Set<number>>>();
    for (const keys of allChoiceVectors(deck.length)) {
      const dayDeck = deck.map((c, i) => ({ ...c, key: keys[i] as 0 | 1 }));
      for (const choices of allChoiceVectors(deck.length)) {
        const grid = dailyGrid(gradeDailyRound(dayDeck, choices));
        const seen = grids.get(grid) ?? deck.map(() => new Set<number>());
        keys.forEach((k, i) => {
          seen[i].add(k);
        });
        grids.set(grid, seen);
      }
    }
    expect(grids.size).toBe(2 ** deck.length);
    for (const [grid, positions] of grids) {
      for (const [i, keysHere] of positions.entries()) {
        expect(keysHere, `grid ${grid} position ${i} pins the key`).toEqual(new Set([0, 1]));
      }
    }
  });

  it("uses one glyph per card, and only the three it declares", () => {
    const results: DailyResult[] = ["hit", "miss", "skip", "hit", "miss"];
    const grid = dailyGrid(results);
    expect([...grid]).toHaveLength(results.length);
    expect(grid).toBe("\u{1F7E9}\u{1F7E5}\u2B1C\u{1F7E9}\u{1F7E5}");
    for (const glyph of Object.values(DAILY_GLYPH)) {
      // Plain block emoji: they paste as coloured squares everywhere, and
      // nothing here needs a font, an image or a private-use codepoint.
      expect(glyph.codePointAt(0)).toBeLessThan(0x1_f800);
    }
    expect(new Set(Object.values(DAILY_GLYPH)).size).toBe(3);
  });

  it("says the same thing to a reader who cannot tell red from green", () => {
    // Colour is never the only cue: the tally is in words beside the grid.
    const text = dailyShareText({ number: 12, results: ["hit", "hit", "miss", "hit", "hit"], streak: 3 }, "x");
    expect(text).toContain("4 of 5");
  });
});

describe("the share text carries no card and no claim", () => {
  const REAL_POOL = POOL;

  /** Every string the daily can emit, over a fortnight of real decks. */
  function everyDailyText(): string[] {
    return days("2026-02-01", 14).flatMap((day) => {
      const deck = dailyDeck(day, REAL_POOL);
      return allChoiceVectors(Math.min(deck.length, 3)).flatMap((choices) => {
        const results = gradeDailyRound(deck, choices);
        const share = { number: dailyNumber(day), results, streak: choices[0] === 0 ? 0 : 9 };
        return CHANNELS.map((c) => dailyShareText(share, c));
      });
    });
  }

  it("never quotes a card, an id, a tell or a picture's description", () => {
    for (const text of everyDailyText()) {
      expect(dailyShareLeaks(text, REAL_POOL)).toEqual([]);
    }
  });

  it("has spoilers to find, so the leak check is not vacuous", () => {
    const card = REAL_POOL[0];
    const spoilers = dailyCardSpoilers(card);
    expect(spoilers.length).toBeGreaterThan(2);
    expect(dailyShareLeaks(`I got the one about "${card.tell}" wrong`, REAL_POOL)).toContain(card.tell);
    expect(dailyShareLeaks(`item ${card.id}`, REAL_POOL)).toContain(card.id);
  });

  it("never says a word that reads as certification", () => {
    for (const text of everyDailyText()) {
      expect(shareTextViolations(text)).toEqual([]);
    }
  });

  it("fits X's budget with the link's 23 characters allowed for", () => {
    for (const day of days("2026-02-01", 30)) {
      const results = gradeDailyRound(dailyDeck(day, REAL_POOL), [0, 0, 0, 0, 0]);
      const text = dailyShareText({ number: dailyNumber(day), results, streak: 365 }, "x");
      expect(text.length).toBeLessThanOrEqual(X_TEXT_MAX);
    }
  });

  it("carries the grid, the number and the tally on every channel", () => {
    const results: DailyResult[] = ["hit", "miss", "hit", "hit", "hit"];
    const share = { number: 37, results, streak: 6 };
    for (const channel of CHANNELS) {
      const text = dailyShareText(share, channel);
      expect(text).toContain(dailyGrid(results));
      expect(text).toContain("#37");
      expect(text).toContain("4 of 5");
    }
    expect(dailyShareTitle(share)).toBe("Foray Daily #37");
  });

  it("names a streak only once it is one, and never calls it a result", () => {
    const results: DailyResult[] = ["hit", "hit", "hit", "hit", "hit"];
    expect(dailyShareText({ number: 3, results, streak: 1 }, "x")).not.toContain("streak");
    expect(dailyShareText({ number: 3, results, streak: 0 }, "x")).not.toContain("streak");
    expect(dailyShareText({ number: 3, results, streak: 2 }, "x")).toContain("2-day streak");
    expect(dailyShareText({ number: 3, results, streak: 2 }, "linkedin")).toContain(
      DAILY_STREAK_MEANING,
    );
  });

  it("says a card never loaded rather than counting it against the player", () => {
    expect(dailyTallyLine(["hit", "hit", "skip", "hit", "hit"])).toBe("4 of 4 · 1 card never loaded");
    expect(dailyTallyLine(["hit", "skip", "skip", "hit", "miss"])).toBe("2 of 3 · 2 cards never loaded");
    expect(dailyTallyLine(["hit", "hit", "hit", "hit", "hit"])).toBe("5 of 5");
  });

  it("says what the daily is, in the same words everywhere", () => {
    expect(dailyShareText({ number: 1, results: ["hit"], streak: 0 }, "x")).toContain(DAILY_PITCH);
    expect(dailyShareText({ number: 1, results: ["hit"], streak: 0 }, "whatsapp")).toContain(DAILY_PITCH);
  });
});

describe("the composer links", () => {
  const share = { number: 37, results: ["hit", "miss", "hit", "hit", "hit"] as DailyResult[], streak: 6 };
  const url = "https://ailx.example/daily";

  it("puts the link in exactly once, on every network", () => {
    for (const network of SHARE_NETWORKS) {
      const intent = dailyShareIntentUrl(network, share, url);
      const occurrences = intent.split(encodeURIComponent(url)).length - 1;
      expect(occurrences, network).toBe(1);
      expect(intent.startsWith("https://")).toBe(true);
    }
  });

  it("encodes the grid rather than dropping it", () => {
    const intent = dailyShareIntentUrl("whatsapp", share, url);
    expect(decodeURIComponent(intent)).toContain(dailyGrid(share.results));
  });
});

// ---------------------------------------------------------------------------
// The streak
// ---------------------------------------------------------------------------

describe("the streak", () => {
  it("is the practice streak rule, not a second one", () => {
    const played = ["2026-02-01", "2026-02-02", "2026-02-03"];
    expect(dailyStreak(played, "2026-02-03")).toEqual(streakSummary(played, "2026-02-03"));
  });

  it("counts consecutive days and survives one missed day a week", () => {
    expect(dailyStreak(["2026-02-01", "2026-02-02", "2026-02-04"], "2026-02-04").current).toBe(3);
    expect(dailyStreak(["2026-02-01", "2026-02-05"], "2026-02-05").current).toBe(1);
  });

  it("does not punish a day that is still open", () => {
    expect(dailyStreak(["2026-02-01", "2026-02-02"], "2026-02-03").current).toBe(2);
  });

  it("ignores a repeated or malformed day rather than inflating a streak", () => {
    const summary = dailyStreak(
      ["2026-02-01", "2026-02-01", "not-a-day", "", "2026-02-02"],
      "2026-02-02",
    );
    expect(summary.current).toBe(2);
    expect(summary.totalDays).toBe(2);
  });
});
