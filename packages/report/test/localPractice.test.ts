/**
 * The browser-kept practice ledger and the claim that hands it over.
 *
 * Two things are being defended here, and they are the two that a mutation
 * test would go straight at:
 *
 *  1. A claim must not LOSE somebody's days. It arrives at the exact moment a
 *     person finally signed up, which is the worst possible moment to drop a
 *     streak, so a malformed entry costs that entry and nothing else.
 *  2. A claim must not INVENT days. The ledger is a browser's own word, so
 *     every bound (per-day rounds, answers per round, correct per answered,
 *     days per claim) is enforced on the way in AND on the way back out.
 */
import { describe, expect, it } from "vitest";
import {
  CLAIMED_DAYS_BASIS,
  CLAIM_PROMISE,
  LOCAL_PRACTICE_BASIS,
  LOCAL_PRACTICE_KEY,
  MAX_LOCAL_DAYS,
  MAX_LOCAL_SESSIONS_PER_DAY,
  PRACTICE_DECK_SIZE,
  SIGN_IN_VALUE,
  SIGN_IN_VALUE_SHORT,
  claimableDays,
  emptyLocalLedger,
  localPracticeDayStrings,
  markDaysClaimed,
  mergePracticeDays,
  parseLocalLedger,
  parsePracticeDay,
  recordLocalRound,
  sanitizeClaimDays,
  serializeLocalLedger,
  streakSummary,
} from "../src/index.js";

const round = (day: string, answered = 6, correct = 4) => ({ day, answered, correct });

describe("parsePracticeDay", () => {
  it("accepts a well-formed day", () => {
    expect(parsePracticeDay({ day: "2026-03-01", sessions: 2, answered: 12, correct: 7 })).toEqual({
      day: "2026-03-01",
      sessions: 2,
      answered: 12,
      correct: 7,
    });
  });

  it.each([
    ["not an object", 42],
    ["null", null],
    ["no day", { sessions: 1, answered: 6, correct: 1 }],
    ["a badly shaped day", { day: "1 March", sessions: 1, answered: 6, correct: 1 }],
    ["a day that is not a date", { day: "2026-13-45", sessions: 1, answered: 6, correct: 1 }],
    ["zero sessions", { day: "2026-03-01", sessions: 0, answered: 0, correct: 0 }],
    ["a fractional session count", { day: "2026-03-01", sessions: 1.5, answered: 6, correct: 1 }],
    ["a negative count", { day: "2026-03-01", sessions: 1, answered: -1, correct: 0 }],
    [
      "more rounds than a day can hold",
      { day: "2026-03-01", sessions: MAX_LOCAL_SESSIONS_PER_DAY + 1, answered: 6, correct: 1 },
    ],
    [
      "more answers than the rounds could have held",
      { day: "2026-03-01", sessions: 1, answered: PRACTICE_DECK_SIZE + 1, correct: 1 },
    ],
    ["more correct than answered", { day: "2026-03-01", sessions: 1, answered: 3, correct: 4 }],
  ])("refuses %s", (_label, value) => {
    expect(parsePracticeDay(value)).toBeNull();
  });

  it("accepts exactly the boundary it allows", () => {
    expect(
      parsePracticeDay({
        day: "2026-03-01",
        sessions: MAX_LOCAL_SESSIONS_PER_DAY,
        answered: MAX_LOCAL_SESSIONS_PER_DAY * PRACTICE_DECK_SIZE,
        correct: MAX_LOCAL_SESSIONS_PER_DAY * PRACTICE_DECK_SIZE,
      }),
    ).not.toBeNull();
  });
});

describe("the ledger round-trips through storage", () => {
  it("records a round as one day", () => {
    const ledger = recordLocalRound(emptyLocalLedger(), round("2026-03-01"));
    expect(ledger.days).toEqual([
      { day: "2026-03-01", sessions: 1, answered: 6, correct: 4, claimed: false },
    ]);
  });

  it("adds a second round of the same day to the same day", () => {
    let ledger = recordLocalRound(emptyLocalLedger(), round("2026-03-01", 6, 4));
    ledger = recordLocalRound(ledger, round("2026-03-01", 6, 6));
    expect(ledger.days).toEqual([
      { day: "2026-03-01", sessions: 2, answered: 12, correct: 10, claimed: false },
    ]);
  });

  it("keeps days sorted however they arrive", () => {
    let ledger = recordLocalRound(emptyLocalLedger(), round("2026-03-03"));
    ledger = recordLocalRound(ledger, round("2026-03-01"));
    expect(localPracticeDayStrings(ledger)).toEqual(["2026-03-01", "2026-03-03"]);
  });

  it("leaves the ledger untouched when a round cannot be a day", () => {
    const ledger = recordLocalRound(emptyLocalLedger(), round("yesterday"));
    expect(ledger.days).toEqual([]);
  });

  it("stops counting a day past its cap rather than corrupting it", () => {
    let ledger = emptyLocalLedger();
    for (let i = 0; i < MAX_LOCAL_SESSIONS_PER_DAY + 5; i++) {
      ledger = recordLocalRound(ledger, round("2026-03-01", 6, 3));
    }
    expect(ledger.days[0]!.sessions).toBe(MAX_LOCAL_SESSIONS_PER_DAY);
    expect(ledger.days[0]!.answered).toBe(MAX_LOCAL_SESSIONS_PER_DAY * 6);
  });

  it("keeps the claimed flag when a claimed day is practised again", () => {
    let ledger = recordLocalRound(emptyLocalLedger(), round("2026-03-01"));
    ledger = markDaysClaimed(ledger, ["2026-03-01"]);
    ledger = recordLocalRound(ledger, round("2026-03-01"));
    expect(ledger.days[0]!.claimed).toBe(true);
    expect(ledger.days[0]!.sessions).toBe(2);
  });

  it("survives a serialize/parse cycle unchanged", () => {
    let ledger = recordLocalRound(emptyLocalLedger(), round("2026-03-01"));
    ledger = recordLocalRound(ledger, round("2026-03-02", 6, 6));
    ledger = markDaysClaimed(ledger, ["2026-03-01"]);
    expect(parseLocalLedger(serializeLocalLedger(ledger))).toEqual(ledger);
  });

  it.each([
    ["nothing stored", null],
    ["an empty string", ""],
    ["truncated json", '{"days":[{"day":"2026-'],
    ["a json array", "[]"],
    ["json null", "null"],
    ["an object with no days", '{"v":1}'],
    ["days that are not an array", '{"days":"2026-03-01"}'],
  ])("degrades to an empty ledger for %s", (_label, raw) => {
    expect(parseLocalLedger(raw)).toEqual(emptyLocalLedger());
  });

  it("keeps the good days out of a half-corrupt ledger", () => {
    const raw = JSON.stringify({
      days: [
        { day: "2026-03-01", sessions: 1, answered: 6, correct: 4 },
        { day: "nonsense", sessions: 1, answered: 6, correct: 4 },
        { day: "2026-03-02", sessions: 1, answered: 6, correct: 99 },
      ],
    });
    expect(localPracticeDayStrings(parseLocalLedger(raw))).toEqual(["2026-03-01"]);
  });

  it("folds a rewritten ledger that repeats a day, keeping the larger counts", () => {
    const raw = JSON.stringify({
      days: [
        { day: "2026-03-01", sessions: 1, answered: 6, correct: 1, claimed: true },
        { day: "2026-03-01", sessions: 3, answered: 12, correct: 2 },
      ],
    });
    expect(parseLocalLedger(raw).days).toEqual([
      { day: "2026-03-01", sessions: 3, answered: 12, correct: 2, claimed: true },
    ]);
  });

  it("caps a ledger at the newest MAX_LOCAL_DAYS days", () => {
    const days = Array.from({ length: MAX_LOCAL_DAYS + 10 }, (_, i) => ({
      day: new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
      sessions: 1,
      answered: 6,
      correct: 3,
    }));
    const parsed = parseLocalLedger(JSON.stringify({ days }));
    expect(parsed.days).toHaveLength(MAX_LOCAL_DAYS);
    expect(parsed.days[parsed.days.length - 1]!.day).toBe(days[days.length - 1]!.day);
  });

  it("a rewritten `claimed: false` cannot re-offer a day the ledger it replaced had claimed", () => {
    // Not a security boundary — the browser owns this file. It is a
    // consistency one: the fold is what makes a double-claim impossible
    // within one ledger, however the entries arrived.
    const raw = JSON.stringify({
      days: [
        { day: "2026-03-01", sessions: 1, answered: 6, correct: 1, claimed: true },
        { day: "2026-03-01", sessions: 1, answered: 6, correct: 1, claimed: false },
      ],
    });
    expect(claimableDays(parseLocalLedger(raw))).toEqual([]);
  });
});

describe("the claim", () => {
  it("offers every unclaimed day and nothing else", () => {
    let ledger = recordLocalRound(emptyLocalLedger(), round("2026-03-01"));
    ledger = recordLocalRound(ledger, round("2026-03-02"));
    ledger = markDaysClaimed(ledger, ["2026-03-01"]);
    expect(claimableDays(ledger)).toEqual([
      { day: "2026-03-02", sessions: 1, answered: 6, correct: 4 },
    ]);
  });

  it("offers a day to a second account never", () => {
    let ledger = recordLocalRound(emptyLocalLedger(), round("2026-03-01"));
    ledger = markDaysClaimed(ledger, claimableDays(ledger).map((d) => d.day));
    expect(claimableDays(ledger)).toEqual([]);
  });

  it("keeps claimed days visible to the browser that earned them", () => {
    let ledger = recordLocalRound(emptyLocalLedger(), round("2026-03-01"));
    ledger = recordLocalRound(ledger, round("2026-03-02"));
    ledger = markDaysClaimed(ledger, ["2026-03-01", "2026-03-02"]);
    expect(streakSummary(localPracticeDayStrings(ledger), "2026-03-02").current).toBe(2);
  });

  it("marks only the days the server said it took", () => {
    let ledger = recordLocalRound(emptyLocalLedger(), round("2026-03-01"));
    ledger = recordLocalRound(ledger, round("2026-03-02"));
    ledger = markDaysClaimed(ledger, ["2026-03-01"]);
    expect(ledger.days.map((d) => d.claimed)).toEqual([true, false]);
  });

  it("marking a day the ledger does not hold changes nothing", () => {
    const ledger = recordLocalRound(emptyLocalLedger(), round("2026-03-01"));
    expect(markDaysClaimed(ledger, ["2020-01-01"])).toEqual(ledger);
  });
});

describe("sanitizeClaimDays — the server's validator and the browser's", () => {
  it("keeps the good days and drops only the bad ones", () => {
    expect(
      sanitizeClaimDays([
        { day: "2026-03-01", sessions: 1, answered: 6, correct: 4 },
        { day: "whenever", sessions: 1, answered: 6, correct: 4 },
        { day: "2026-03-02", sessions: 1, answered: 6, correct: 6 },
      ]),
    ).toEqual([
      { day: "2026-03-01", sessions: 1, answered: 6, correct: 4 },
      { day: "2026-03-02", sessions: 1, answered: 6, correct: 6 },
    ]);
  });

  it.each([["a string", "2026-03-01"], ["null", null], ["an object", { days: [] }]])(
    "reads %s as no days at all",
    (_label, value) => {
      expect(sanitizeClaimDays(value)).toEqual([]);
    },
  );

  it("drops the claimed flag — the receiver decides what a day is", () => {
    expect(
      sanitizeClaimDays([{ day: "2026-03-01", sessions: 1, answered: 6, correct: 4, claimed: true }]),
    ).toEqual([{ day: "2026-03-01", sessions: 1, answered: 6, correct: 4 }]);
  });

  it("caps a hostile claim at MAX_LOCAL_DAYS days", () => {
    const days = Array.from({ length: MAX_LOCAL_DAYS * 3 }, (_, i) => ({
      day: new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
      sessions: 1,
      answered: 6,
      correct: 6,
    }));
    expect(sanitizeClaimDays(days)).toHaveLength(MAX_LOCAL_DAYS);
  });

  it("folds a claim that names one day twice instead of counting it twice", () => {
    expect(
      sanitizeClaimDays([
        { day: "2026-03-01", sessions: 1, answered: 6, correct: 4 },
        { day: "2026-03-01", sessions: 2, answered: 12, correct: 5 },
      ]),
    ).toEqual([{ day: "2026-03-01", sessions: 2, answered: 12, correct: 5 }]);
  });

  it("is idempotent", () => {
    const once = sanitizeClaimDays([{ day: "2026-03-01", sessions: 1, answered: 6, correct: 4 }]);
    expect(sanitizeClaimDays(once)).toEqual(once);
  });
});

describe("mergePracticeDays", () => {
  const server = [{ day: "2026-03-01", sessions: 1, answered: 6, correct: 4 }];

  it("takes the larger of two records of the same day, never the sum", () => {
    expect(mergePracticeDays(server, [{ day: "2026-03-01", sessions: 2, answered: 12, correct: 3 }]))
      .toEqual([{ day: "2026-03-01", sessions: 2, answered: 12, correct: 4 }]);
  });

  it("is idempotent — claiming the same days twice moves nothing", () => {
    const once = mergePracticeDays(server, server);
    expect(mergePracticeDays(once, server)).toEqual(once);
  });

  it("keeps days only one side has, in order", () => {
    expect(
      mergePracticeDays(server, [{ day: "2026-02-27", sessions: 1, answered: 6, correct: 6 }]).map(
        (d) => d.day,
      ),
    ).toEqual(["2026-02-27", "2026-03-01"]);
  });

  it("with nothing local is the server's own list", () => {
    expect(mergePracticeDays(server, [])).toEqual(server);
  });
});

describe("the wording of the ask", () => {
  it("names the three things an account is actually for", () => {
    expect(SIGN_IN_VALUE).toHaveLength(3);
    expect(SIGN_IN_VALUE.join(" ")).toMatch(/scored/i);
    expect(SIGN_IN_VALUE.join(" ")).toMatch(/device/i);
    expect(SIGN_IN_VALUE.join(" ")).toMatch(/credential/i);
  });

  it("never threatens the person it is asking", () => {
    const copy = [
      ...SIGN_IN_VALUE,
      SIGN_IN_VALUE_SHORT,
      LOCAL_PRACTICE_BASIS,
      CLAIM_PROMISE,
      CLAIMED_DAYS_BASIS,
    ].join(" ");
    for (const tell of [
      /lose your/i,
      /losing your/i,
      /before it/i,
      /last chance/i,
      /hurry/i,
      /only \d+ (?:hours?|days?|minutes?) (?:left|remaining)/i,
      /don't miss/i,
      /expires? (?:soon|in)/i,
    ]) {
      expect(copy).not.toMatch(tell);
    }
  });

  it("says where the days live and what ends them", () => {
    expect(LOCAL_PRACTICE_BASIS).toMatch(/this browser/i);
    expect(LOCAL_PRACTICE_BASIS).toMatch(/clearing your site data/i);
  });

  it("promises the days move, and says so before the ask", () => {
    expect(CLAIM_PROMISE).toMatch(/move to your account/i);
    expect(CLAIM_PROMISE).toMatch(/nothing is dropped/i);
  });

  it("labels claimed days as the browser's word, not our measurement", () => {
    expect(CLAIMED_DAYS_BASIS).toMatch(/reported/i);
    expect(CLAIMED_DAYS_BASIS).toMatch(/reach no score/i);
  });

  it("claims no efficacy for practice anywhere in the ask", () => {
    const copy = [...SIGN_IN_VALUE, SIGN_IN_VALUE_SHORT, LOCAL_PRACTICE_BASIS, CLAIM_PROMISE].join(" ");
    for (const claim of [/improve/i, /better at/i, /sharper/i, /train(?:s|ing)? you/i, /\d+\s?%/]) {
      expect(copy).not.toMatch(claim);
    }
  });

  it("names one storage key, versioned in the name", () => {
    expect(LOCAL_PRACTICE_KEY).toMatch(/^ailx:practice:v\d+$/);
  });
});
