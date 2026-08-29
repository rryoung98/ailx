/**
 * Streaks and progression: the fairness rules, the anti-gaming floors, and
 * the honesty rules — all against the pure derivation, no database.
 */
import { describe, expect, it } from "vitest";
import { runPure } from "@ailx/core";
import { TRACK_IDS, type TrackRawScores } from "@ailx/session";
import {
  MIN_TREND_ANSWERS,
  MIN_TREND_DAYS,
  PRACTICE_MIN_ANSWERS,
  PRACTICE_MIN_ELAPSED_MS,
  PROGRESS_BASIS,
  REST_DAYS_PER_WINDOW,
  REST_WINDOW_DAYS,
  TZ_OFFSET_MAX,
  TZ_OFFSET_MIN,
  addDays,
  clampTzOffset,
  daysBetween,
  localDay,
  practiceRuns,
  progressReport,
  qualifiesForStreak,
  streakSummary,
} from "../src/progress.js";

const shape = (n: number): TrackRawScores =>
  Object.fromEntries(TRACK_IDS.map((t) => [t, n])) as TrackRawScores;

// ---------------------------------------------------------------------------

describe("local days", () => {
  it("clamps a self-reported offset to real civil offsets", () => {
    expect(clampTzOffset(540)).toBe(540);
    expect(clampTzOffset(-99999)).toBe(TZ_OFFSET_MIN);
    expect(clampTzOffset(99999)).toBe(TZ_OFFSET_MAX);
    expect(clampTzOffset(Number.NaN)).toBe(0);
    expect(clampTzOffset(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampTzOffset("540" as unknown)).toBe(0);
    expect(clampTzOffset(undefined)).toBe(0);
    expect(clampTzOffset(330.9)).toBe(330);
  });

  it("puts a late-evening instant on the right local day either side of UTC", () => {
    const t = Date.parse("2026-03-01T22:30:00Z");
    expect(localDay(t, 0)).toBe("2026-03-01");
    expect(localDay(t, 540)).toBe("2026-03-02"); // JST — already tomorrow
    expect(localDay(t, -480)).toBe("2026-03-01"); // PST — still yesterday afternoon
  });

  it("puts an early-morning instant on the right local day either side of UTC", () => {
    const t = Date.parse("2026-03-02T01:30:00Z");
    expect(localDay(t, 0)).toBe("2026-03-02");
    expect(localDay(t, 540)).toBe("2026-03-02");
    expect(localDay(t, -480)).toBe("2026-03-01"); // PST — still the 1st
  });

  it("counts two sessions either side of UTC midnight as ONE local day in JST", () => {
    const a = localDay(Date.parse("2026-03-01T15:10:00Z"), 540);
    const b = localDay(Date.parse("2026-03-01T23:50:00Z"), 540);
    expect(a).toBe("2026-03-02");
    expect(b).toBe("2026-03-02");
    expect(streakSummary([a, b], "2026-03-02").current).toBe(1);
  });

  it("survives the extreme offsets and a DST-shaped local jump", () => {
    const t = Date.parse("2026-03-08T12:00:00Z");
    expect(localDay(t, TZ_OFFSET_MAX)).toBe("2026-03-09");
    expect(localDay(t, TZ_OFFSET_MIN)).toBe("2026-03-08");
    // A participant whose offset moves by an hour (DST) keeps the same day.
    expect(localDay(t, -300)).toBe(localDay(t, -240));
  });

  it("adds and subtracts days across a month and a leap day", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(daysBetween("2026-01-31", "2026-03-01")).toBe(29);
    expect(daysBetween("2026-03-01", "2026-01-31")).toBe(-29);
  });
});

// ---------------------------------------------------------------------------

describe("what counts as practice (anti-gaming)", () => {
  const full = { answered: PRACTICE_MIN_ANSWERS, elapsedMs: PRACTICE_MIN_ELAPSED_MS };

  it("counts a completed, unhurried session", () => {
    expect(qualifiesForStreak(full)).toEqual({ counted: true, reason: "ok" });
  });

  it("refuses an abandoned session", () => {
    expect(qualifiesForStreak({ ...full, answered: PRACTICE_MIN_ANSWERS - 1 }).counted).toBe(false);
    expect(qualifiesForStreak({ ...full, answered: PRACTICE_MIN_ANSWERS - 1 }).reason).toBe("incomplete");
    expect(qualifiesForStreak({ answered: 0, elapsedMs: 60_000 }).reason).toBe("incomplete");
  });

  it("refuses an instant machine submit even when it is complete", () => {
    expect(qualifiesForStreak({ ...full, elapsedMs: 0 }).reason).toBe("too_fast");
    expect(qualifiesForStreak({ ...full, elapsedMs: PRACTICE_MIN_ELAPSED_MS - 1 }).reason).toBe("too_fast");
  });

  it("does not require accuracy — being wrong is the point of training", () => {
    expect(qualifiesForStreak({ answered: 99, elapsedMs: 600_000 }).counted).toBe(true);
  });
});

// ---------------------------------------------------------------------------

const TODAY = "2026-03-10";
const back = (n: number): string => addDays(TODAY, -n);

describe("streak: the plain cases", () => {
  it("is empty with no practice at all", () => {
    expect(streakSummary([], TODAY)).toEqual({
      current: 0, best: 0, totalDays: 0, lastDay: null,
      practisedToday: false, restDayAvailable: false,
    });
  });

  it("counts one day", () => {
    const s = streakSummary([TODAY], TODAY);
    expect(s.current).toBe(1);
    expect(s.best).toBe(1);
    expect(s.practisedToday).toBe(true);
  });

  it("counts consecutive days and ignores repeats within one day", () => {
    const days = [back(2), back(1), TODAY, TODAY, back(1)];
    const s = streakSummary(days, TODAY);
    expect(s.current).toBe(3);
    expect(s.totalDays).toBe(3);
  });

  it("accepts unsorted input", () => {
    expect(streakSummary([TODAY, back(2), back(1)], TODAY).current).toBe(3);
  });

  it("ignores malformed day strings instead of throwing", () => {
    expect(streakSummary(["", "yesterday", "2026-3-1", TODAY], TODAY).current).toBe(1);
  });
});

describe("streak: today is never held against you", () => {
  it("stays alive at full length when the last practice was yesterday", () => {
    const s = streakSummary([back(3), back(2), back(1)], TODAY);
    expect(s.current).toBe(3);
    expect(s.practisedToday).toBe(false);
  });

  it("stays alive when yesterday was missed but a rest day is available", () => {
    const s = streakSummary([back(4), back(3), back(2)], TODAY);
    expect(s.current).toBe(3);
    // The rest day is now spent on yesterday, so none is left for today.
    expect(s.restDayAvailable).toBe(false);
  });

  it("breaks after two clear missed days", () => {
    const s = streakSummary([back(5), back(4), back(3)], TODAY);
    expect(s.current).toBe(0);
    expect(s.best).toBe(3);
  });
});

describe("streak: the rest-day rule", () => {
  it("bridges a single missed day", () => {
    // practised d-4, d-3, MISSED d-2, d-1, today
    const s = streakSummary([back(4), back(3), back(1), TODAY], TODAY);
    expect(s.current).toBe(4);
  });

  it("does not bridge two missed days in a row", () => {
    const s = streakSummary([back(5), back(4), back(1), TODAY], TODAY);
    expect(s.current).toBe(2);
    expect(s.best).toBe(2);
  });

  it("allows only one rest day per window", () => {
    // Two gaps three days apart: the second cannot be rested.
    const s = streakSummary([back(6), back(4), back(2), back(1), TODAY], TODAY);
    expect(REST_DAYS_PER_WINDOW).toBe(1);
    expect(s.current).toBe(3); // d-2, d-1, today; the d-4 gap re-broke the run
  });

  it("allows a second rest day once the window has passed", () => {
    // Rest at d-11; the next gap is at d-2, nine days later, so the window
    // has cleared and the run survives both.
    const days = [
      back(12), back(10), back(9), back(8), back(7), back(6), back(5), back(4), back(3),
      back(1), TODAY,
    ];
    const s = streakSummary(days, TODAY);
    expect(REST_WINDOW_DAYS).toBe(7);
    expect(s.current).toBe(11);
  });

  it("still refuses a second rest day INSIDE the window", () => {
    // Same shape, but the two gaps are only six days apart.
    const days = [back(9), back(7), back(6), back(5), back(4), back(3), back(1), TODAY];
    expect(streakSummary(days, TODAY).current).toBe(2);
  });

  it("never lets a rest day itself count as a practice day", () => {
    const s = streakSummary([back(2), TODAY], TODAY);
    expect(s.current).toBe(2);
    expect(s.totalDays).toBe(2);
  });

  it("says a rest day is available when the streak has not spent one", () => {
    expect(streakSummary([back(1), TODAY], TODAY).restDayAvailable).toBe(true);
  });
});

describe("streak: a break costs the streak, never the record", () => {
  it("preserves the best run and the lifetime day count after a long gap", () => {
    const old = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"];
    const s = streakSummary([...old, TODAY], TODAY);
    expect(s.current).toBe(1);
    expect(s.best).toBe(5);
    expect(s.totalDays).toBe(6);
  });

  it("best never decreases as days accumulate", () => {
    let bestSoFar = 0;
    const days: string[] = [];
    for (let i = 60; i >= 0; i--) {
      if (i % 4 !== 0) days.push(back(i));
      const s = streakSummary(days, TODAY);
      expect(s.best).toBeGreaterThanOrEqual(bestSoFar);
      bestSoFar = s.best;
    }
  });

  it("current is never greater than best, and both are bounded by totalDays", () => {
    for (let n = 0; n < 200; n++) {
      const days = Array.from({ length: 40 }, (_, i) => back(i)).filter((_, i) => (i * n) % 3 !== 1);
      const s = streakSummary(days, TODAY);
      expect(s.current).toBeLessThanOrEqual(s.best);
      expect(s.best).toBeLessThanOrEqual(s.totalDays);
    }
  });
});

describe("practiceRuns is the one implementation of the rule", () => {
  it("splits days into runs whose lengths are exactly what streakSummary reports", () => {
    const days = ["2026-02-01", "2026-02-02", "2026-02-05", "2026-02-06", "2026-02-08"];
    const runs = practiceRuns(days);
    expect(runs.map((r) => r.days.length)).toEqual([2, 3]);
    expect(runs[1].restDays).toEqual(["2026-02-07"]);
    expect(streakSummary(days, "2026-02-08").current).toBe(3);
    expect(streakSummary(days, "2026-02-08").best).toBe(3);
  });

  it("de-duplicates and sorts", () => {
    const runs = practiceRuns(["2026-02-02", "2026-02-01", "2026-02-02"]);
    expect(runs).toEqual([{ days: ["2026-02-01", "2026-02-02"], restDays: [] }]);
  });
});

// ---------------------------------------------------------------------------

const trackName = (t: string): string => t.toUpperCase();

/** n days of practice ending today, `correct` right out of 6 each day. */
const dayRun = (n: number, correct: (i: number) => number) =>
  Array.from({ length: n }, (_, i) => ({
    day: back(n - 1 - i),
    sessions: 1,
    answered: 6,
    correct: correct(i),
  }));

describe("progressReport", () => {
  it("is honest about having nothing yet", () => {
    const r = progressReport({ days: [], sittings: [], today: TODAY, trackName });
    expect(r.streak.current).toBe(0);
    expect(r.practiceAccuracy).toBeNull();
    expect(r.improvements).toEqual([]);
    expect(r.notEnoughYet).toEqual({ practice: true, sittings: true });
    expect(r.basis).toBe(PROGRESS_BASIS);
  });

  it("states the basis and never implies a judged result", () => {
    expect(PROGRESS_BASIS).toMatch(/No percentile, no composite/i);
    expect(PROGRESS_BASIS).toMatch(/judging pipeline is not built/i);
  });

  it("withholds an accuracy trend below the answer floor", () => {
    const days = dayRun(1, () => 3);
    expect(days[0].answered).toBeLessThan(MIN_TREND_ANSWERS);
    expect(progressReport({ days, sittings: [], today: TODAY, trackName }).practiceAccuracy).toBeNull();
  });

  it("reports a real improvement between the early and recent halves", () => {
    const r = progressReport({
      days: dayRun(4, (i) => (i < 2 ? 2 : 5)),
      sittings: [],
      today: TODAY,
      trackName,
    });
    expect(r.practiceAccuracy).toEqual({ early: 33, recent: 83, answered: 24 });
    expect(r.improvements[0]).toMatchObject({ subject: "practice", delta: 50, from: 33, to: 83 });
    expect(r.notEnoughYet.practice).toBe(false);
  });

  it("reports a decline as a decline rather than hiding it", () => {
    const r = progressReport({
      days: dayRun(4, (i) => (i < 2 ? 6 : 3)),
      sittings: [],
      today: TODAY,
      trackName,
    });
    expect(r.improvements[0].delta).toBeLessThan(0);
  });

  it("sorts the practice days oldest first and computes per-day accuracy", () => {
    const r = progressReport({
      days: [
        { day: back(0), sessions: 1, answered: 6, correct: 6 },
        { day: back(2), sessions: 1, answered: 6, correct: 3 },
        { day: back(1), sessions: 0, answered: 0, correct: 0 },
      ],
      sittings: [],
      today: TODAY,
      trackName,
    });
    expect(r.practice.map((p) => p.day)).toEqual([back(2), back(1), back(0)]);
    expect(r.practice.map((p) => p.accuracy)).toEqual([0.5, null, 1]);
    // A recorded day with no completed session does not feed the streak.
    expect(r.streak.totalDays).toBe(2);
    expect(r.practice.filter((p) => p.sessions > 0).length).toBeLessThan(MIN_TREND_DAYS);
  });

  it("compares the first and latest sitting per track, oldest first", () => {
    const r = progressReport({
      days: [],
      sittings: [
        { attemptId: "b", startedOn: "2026-02-01", scores: shape(70) },
        { attemptId: "a", startedOn: "2026-01-01", scores: shape(50) },
      ],
      today: TODAY,
      trackName,
    });
    expect(r.sittings.map((s) => s.attemptId)).toEqual(["a", "b"]);
    expect(r.improvements).toHaveLength(TRACK_IDS.length);
    for (const imp of r.improvements) expect(imp).toMatchObject({ delta: 20, from: 50, to: 70 });
    expect(r.notEnoughYet.sittings).toBe(false);
  });

  it("says nothing about tracks from a single sitting", () => {
    const r = progressReport({
      days: [],
      sittings: [{ attemptId: "a", startedOn: "2026-01-01", scores: shape(50) }],
      today: TODAY,
      trackName,
    });
    expect(r.improvements).toEqual([]);
    expect(r.notEnoughYet.sittings).toBe(true);
  });

  it("omits a track that did not move at all", () => {
    const r = progressReport({
      days: [],
      sittings: [
        { attemptId: "a", startedOn: "2026-01-01", scores: { ...shape(50), t1: 40 } },
        { attemptId: "b", startedOn: "2026-02-01", scores: shape(50) },
      ],
      today: TODAY,
      trackName,
    });
    expect(r.improvements.map((i) => i.subject)).toEqual(["t1"]);
    expect(r.improvements[0].label).toBe("T1");
  });
});

describe("purity (FRONTEND.md §2.2)", () => {
  it("derives a streak and a report where fetch, Date.now and Math.random throw", () => {
    runPure(() => {
      const r = progressReport({
        days: dayRun(4, (i) => (i < 2 ? 2 : 5)),
        sittings: [
          { attemptId: "a", startedOn: "2026-01-01", scores: shape(50) },
          { attemptId: "b", startedOn: "2026-02-01", scores: shape(70) },
        ],
        today: TODAY,
        trackName,
      });
      expect(r.streak.current).toBe(4);
      expect(r.improvements.length).toBeGreaterThan(0);
      expect(localDay(0, 540)).toBe("1970-01-01");
    });
  });
});
