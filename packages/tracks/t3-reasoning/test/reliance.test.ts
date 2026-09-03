/**
 * Intervals and the reliance report — TEN-35.
 *
 * The Wilson values below are the published ones in Newcombe (1998),
 * Statistics in Medicine 17:857-872, Table I, and the difference interval is
 * his method 10 worked example (17:873-890): 56/70 against 48/80.
 */
import { describe, expect, it } from "vitest";
import { runPure } from "@ailx/core";
import {
  ERROR_CATCH_MIN_SURFACED, proportionDifferenceInterval, wilsonInterval,
} from "../src/scoring.js";
import { formatInterval, formatRate, relianceReportFromRaw } from "../src/relianceReport.js";

describe("wilsonInterval", () => {
  it("matches Newcombe (1998) Table I to four decimals", () => {
    const cases: Array<[number, number, number, number]> = [
      [81, 263, 0.2553, 0.3662],
      [15, 148, 0.0624, 0.1605],
      [0, 20, 0.0, 0.1611],
      [1, 29, 0.0061, 0.1718],
      [29, 29, 0.883, 1.0],
    ];
    for (const [x, n, lo, hi] of cases) {
      const i = wilsonInterval(x, n);
      expect(i.lo, `lo of ${x}/${n}`).toBeCloseTo(lo, 4);
      expect(i.hi, `hi of ${x}/${n}`).toBeCloseTo(hi, 4);
    }
  });

  it("is more than half the scale wide at a half rate on 8 events", () => {
    const i = wilsonInterval(4, 8);
    expect(i.hi - i.lo).toBeGreaterThan(0.55);
    // 5 of 8 and 7 of 8 overlap: the reason the report never shows a bare rate.
    const five = wilsonInterval(5, 8);
    const seven = wilsonInterval(7, 8);
    expect(five.hi).toBeGreaterThan(seven.lo);
  });

  it("n = 0 excludes nothing", () => {
    expect(wilsonInterval(0, 0)).toEqual({ lo: 0, hi: 1 });
    expect(wilsonInterval(0, -3)).toEqual({ lo: 0, hi: 1 });
  });

  it("stays non-degenerate and in range at p = 0 and p = 1", () => {
    const zero = wilsonInterval(0, 8);
    expect(zero.lo).toBe(0);
    // Closed form at x = 0: z^2 / (n + z^2) = 3.8415 / 11.8415.
    expect(zero.hi).toBeCloseTo(0.3244, 4);
    const one = wilsonInterval(8, 8);
    expect(one.hi).toBe(1);
    expect(one.lo).toBeCloseTo(0.6756, 4);
  });

  it("covers the point estimate and narrows as n grows", () => {
    for (const n of [1, 2, 8, 40, 200]) {
      const i = wilsonInterval(n / 2, n);
      expect(i.lo).toBeLessThanOrEqual(0.5);
      expect(i.hi).toBeGreaterThanOrEqual(0.5);
    }
    const wide = wilsonInterval(4, 8);
    const narrow = wilsonInterval(50, 100);
    expect(narrow.hi - narrow.lo).toBeLessThan(wide.hi - wide.lo);
  });

  it("is pure", () => {
    expect(runPure(() => wilsonInterval(5, 8))).toEqual(wilsonInterval(5, 8));
  });
});

describe("proportionDifferenceInterval", () => {
  it("matches Newcombe's method 10 worked example (0.0524 to 0.3339)", () => {
    const i = proportionDifferenceInterval(48, 80, 56, 70);
    expect(i.lo).toBeCloseTo(0.0524, 4);
    expect(i.hi).toBeCloseTo(0.3339, 4);
  });

  it("is antisymmetric under swapping the two rates", () => {
    const a = proportionDifferenceInterval(3, 8, 1, 4);
    const b = proportionDifferenceInterval(1, 4, 3, 8);
    expect(a.lo).toBeCloseTo(-b.hi, 12);
    expect(a.hi).toBeCloseTo(-b.lo, 12);
  });

  it("contains the difference and stays inside [-1, 1] at the extremes", () => {
    const i = proportionDifferenceInterval(0, 8, 4, 4);
    expect(i.lo).toBeLessThanOrEqual(1);
    expect(i.hi).toBe(1);
    const j = proportionDifferenceInterval(8, 8, 0, 4);
    expect(j.lo).toBe(-1);
    const k = proportionDifferenceInterval(4, 8, 2, 4);
    expect(k.lo).toBeLessThanOrEqual(0);
    expect(k.hi).toBeGreaterThanOrEqual(0);
  });

  it("covers everything when nothing was observed on either side", () => {
    expect(proportionDifferenceInterval(0, 0, 0, 0)).toEqual({ lo: -1, hi: 1 });
  });

  it("is wider than either rate's own interval, as a difference must be", () => {
    const d = proportionDifferenceInterval(4, 8, 2, 4);
    const a = wilsonInterval(4, 8);
    const b = wilsonInterval(2, 4);
    expect(d.hi - d.lo).toBeGreaterThan(a.hi - a.lo);
    expect(d.hi - d.lo).toBeGreaterThan(b.hi - b.lo);
  });

  it("is pure", () => {
    expect(runPure(() => proportionDifferenceInterval(4, 8, 2, 4))).toEqual(
      proportionDifferenceInterval(4, 8, 2, 4),
    );
  });
});

describe("formatting", () => {
  it("prints two decimals with a typographic minus", () => {
    expect(formatRate(0.625)).toBe("0.63");
    expect(formatRate(-0.5)).toBe("\u22120.50");
    expect(formatRate(0)).toBe("0.00");
  });

  it("prints an interval as a range", () => {
    expect(formatInterval({ lo: -0.12, hi: 0.63 })).toBe("95% CI \u22120.12 to 0.63");
  });
});

const raw = (over: [number, number], under: [number, number]) => ({
  plantedSurfaced: over[1],
  plantedCaught: over[1] - over[0],
  adviceSurfaced: under[1],
  adviceAdopted: under[1] - under[0],
  "errorCatchRate.underpowered": over[1] < ERROR_CATCH_MIN_SURFACED ? 1 : 0,
});

describe("relianceReportFromRaw", () => {
  it("reports three rows, each with an interval and its counts", () => {
    const r = relianceReportFromRaw(raw([3, 8], [1, 4]))!;
    expect(r.rows.map((x) => x.key)).toEqual(["over", "under", "index"]);
    expect(r.rows[0].point).toBeCloseTo(0.375, 12);
    expect(r.rows[1].point).toBeCloseTo(0.25, 12);
    expect(r.rows[2].point).toBeCloseTo(-0.125, 12);
    for (const row of r.rows) {
      expect(row.interval.hi).toBeGreaterThan(row.interval.lo);
      expect(row.detail.length).toBeGreaterThan(10);
    }
    expect(r.rows[0].detail).toBe("3 of 8 surfaced planted errors went unchallenged");
    expect(r.rows[1].detail).toBe("1 of 4 correct suggestions was not adopted");
  });

  it("marks every row defined when both denominators are non-zero", () => {
    const r = relianceReportFromRaw(raw([3, 8], [1, 4]))!;
    expect(r.rows.every((x) => x.defined)).toBe(true);
  });

  it("bands from both tails, not from the index", () => {
    // Failing both ways: index 0, and the band must not read "calibrated".
    const bothWays = relianceReportFromRaw(raw([8, 8], [4, 4]))!;
    expect(bothWays.rows[2].point).toBe(0);
    expect(bothWays.band).toBe("over-reliant");
    expect(relianceReportFromRaw(raw([0, 8], [0, 4]))!.band).toBe("calibrated");
  });

  it("says the sitting is underpowered when fewer than 8 plants surfaced", () => {
    const r = relianceReportFromRaw(raw([1, 4], [1, 4]))!;
    expect(r.underpowered).toBe(true);
    expect(r.underpoweredNote).toContain("surfaced 4 planted errors");
    expect(r.underpoweredNote).toContain(`floor for reporting a rate is ${ERROR_CATCH_MIN_SURFACED}`);
  });

  it("carries no underpowered note at the floor", () => {
    const r = relianceReportFromRaw(raw([3, 8], [1, 4]))!;
    expect(r.underpowered).toBe(false);
    expect(r.underpoweredNote).toBeNull();
  });

  it("names the precision and the missing reliability evidence", () => {
    const r = relianceReportFromRaw(raw([3, 8], [1, 4]))!;
    expect(r.precisionNote).toContain("8 planted errors and 4 correct suggestions");
    // The quoted example intervals are the ones wilsonInterval really returns.
    expect(r.precisionNote).toContain(formatInterval(wilsonInterval(5, 8)));
    expect(r.precisionNote).toContain(formatInterval(wilsonInterval(7, 8)));
    expect(r.reliabilityNote).toContain("ICC below 0.5");
    expect(r.reliabilityNote).toContain("Karvelis");
    // The intervals assume independence, which reliance behaviour does not obey.
    expect(r.independenceNote).toContain("assume the events are independent");
    expect(r.independenceNote).toContain("wider than the one shown");
  });

  it("says one error, not one errors, when a single plant surfaced", () => {
    const r = relianceReportFromRaw(raw([0, 1], [0, 1]))!;
    expect(r.rows[0].detail).toBe("0 of 1 surfaced planted error went unchallenged");
    expect(r.rows[1].detail).toBe("0 of 1 correct suggestion was not adopted");
    expect(r.precisionNote).toContain("1 planted error and 1 correct suggestion.");
    expect(r.underpoweredNote).toBe(
      "This sitting surfaced 1 planted error. The floor for reporting a rate is 8. " +
        "The over-reliance rate and the band rest on 1 event, so treat both as provisional.",
    );
  });

  it("withholds the rate and the band when a side surfaced nothing", () => {
    const r = relianceReportFromRaw(raw([0, 0], [0, 0]))!;
    expect(r.rows.every((x) => x.defined)).toBe(false);
    expect(r.rows[0].detail).toContain("no rate to report");
    // relianceBand(0, 0) reads "calibrated"; a sitting with no events has
    // shown nothing of the kind, so no band is offered.
    expect(r.band).toBeNull();
    expect(r.underpowered).toBe(true);
  });

  it("withholds the index when only one side has events", () => {
    const r = relianceReportFromRaw(raw([2, 8], [0, 0]))!;
    expect(r.rows[0].defined).toBe(true);
    expect(r.rows[1].defined).toBe(false);
    expect(r.rows[2].defined).toBe(false);
    expect(r.band).toBeNull();
  });

  it("warns even when the stored underpowered flag is missing or stale", () => {
    const stale = { plantedSurfaced: 4, plantedCaught: 2, adviceSurfaced: 4, adviceAdopted: 3 };
    expect(relianceReportFromRaw(stale)!.underpowered).toBe(true);
    expect(
      relianceReportFromRaw({ ...stale, "errorCatchRate.underpowered": 0 })!.underpowered,
    ).toBe(true);
  });

  // The flag has been renamed twice (TEN-38, TEN-72) and no sitting has been
  // scored in production, so no reader for an old spelling exists. A record
  // carrying only a dead spelling is treated as carrying no flag at all, and
  // the derived floor check still warns.
  it("ignores a dead spelling of the flag and warns from the counts", () => {
    const dead = {
      plantedSurfaced: 4, plantedCaught: 2, adviceSurfaced: 4, adviceAdopted: 3,
      "rsr.underpowered": 1,
    };
    expect(relianceReportFromRaw(dead)!.underpowered).toBe(true);
    // At the floor the dead flag buys nothing: the sitting is not underpowered.
    expect(
      relianceReportFromRaw({ ...dead, plantedSurfaced: 8, plantedCaught: 5 })!.underpowered,
    ).toBe(false);
  });

  it("refuses to fabricate a rate from a corrupt record", () => {
    const bad = relianceReportFromRaw({
      plantedSurfaced: 8,
      plantedCaught: 99,          // more caught than surfaced
      adviceSurfaced: 4,
      adviceAdopted: Number.NaN,  // not a number
    })!;
    expect(bad.rows[0].point).toBe(0);            // clamped to 8 of 8 caught
    expect(bad.rows[1].point).toBe(1);            // NaN reads as none adopted
    for (const row of bad.rows) {
      expect(Number.isFinite(row.interval.lo)).toBe(true);
      expect(Number.isFinite(row.interval.hi)).toBe(true);
    }
    const negative = relianceReportFromRaw({
      plantedSurfaced: -5, plantedCaught: -1, adviceSurfaced: 2.7, adviceAdopted: 1,
    })!;
    expect(negative.plantedSurfaced).toBe(0);
    expect(negative.adviceSurfaced).toBe(2);      // fractional counts floor
  });

  it("returns null for a raw record from another track", () => {
    expect(relianceReportFromRaw({ gates: 10, dprime: 1.2 })).toBeNull();
  });

  it("is pure", () => {
    const input = raw([3, 8], [1, 4]);
    expect(runPure(() => relianceReportFromRaw(input))).toEqual(relianceReportFromRaw(input));
  });
});
