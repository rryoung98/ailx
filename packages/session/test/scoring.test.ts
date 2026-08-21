import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runPure } from "@ailx/core";
import {
  bandFromComposite, demoCohort, mean, midRankPercentiles, probit,
  quotaBands, scoreCohort, stdev, zScores, TRACK_WEIGHTS,
  type TrackRawScores,
} from "../src/index.js";

const GOLDEN = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "composite-golden.json"), "utf8"),
) as {
  cohort: TrackRawScores[];
  expected: { zComposite: number[]; percentile: number[]; composite: number[]; band: string[] };
};

describe("statistics primitives", () => {
  it("zScores standardise to mean 0, sd 1", () => {
    const z = zScores([10, 20, 30, 40]);
    expect(mean(z)).toBeCloseTo(0, 12);
    expect(stdev(z)).toBeCloseTo(1, 12);
  });
  it("zScores of a constant column are all zero", () => {
    expect(zScores([5, 5, 5])).toEqual([0, 0, 0]);
  });
  it("probit matches known quantiles", () => {
    expect(probit(0.5)).toBeCloseTo(0, 9);
    expect(probit(0.975)).toBeCloseTo(1.959964, 5);
    expect(probit(0.025)).toBeCloseTo(-1.959964, 5);
    expect(probit(0.84134474)).toBeCloseTo(1, 6);
    expect(() => probit(0)).toThrow();
    expect(() => probit(1)).toThrow();
  });
  it("mid-rank percentiles average ties", () => {
    expect(midRankPercentiles([1, 2, 2, 3])).toEqual([
      (1 - 0.5) / 4, (2.5 - 0.5) / 4, (2.5 - 0.5) / 4, (4 - 0.5) / 4,
    ]);
  });
});

describe("composite pipeline (spec \u00a704)", () => {
  it("weights are equal and sum to 1 (deliberate annual policy)", () => {
    const w = Object.values(TRACK_WEIGHTS);
    expect(new Set(w).size).toBe(1);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it("reproduces the golden fixture byte-for-byte", () => {
    const r = scoreCohort(GOLDEN.cohort);
    expect(JSON.stringify(r)).toBe(JSON.stringify(GOLDEN.expected));
  });

  it("is invariant to cohort ordering (reproducibility)", () => {
    const idx = GOLDEN.cohort.map((_, i) => i).reverse();
    const r0 = scoreCohort(GOLDEN.cohort);
    const r1 = scoreCohort(idx.map((i) => GOLDEN.cohort[i]));
    for (let k = 0; k < idx.length; k++) {
      expect(r1.composite[k]).toBe(r0.composite[idx[k]]);
      expect(r1.band[k]).toBe(r0.band[idx[k]]);
    }
  });

  it("is pure under the @ailx/core purity harness", () => {
    const r = runPure(() => scoreCohort(GOLDEN.cohort));
    expect(JSON.stringify(r)).toBe(JSON.stringify(GOLDEN.expected));
    const c = runPure(() => demoCohort("purity-check", 8));
    expect(c).toHaveLength(8);
  });

  it("normalised composite stays within [0, 100] and centres near 50", () => {
    const cohort = demoCohort("bounds", 45);
    const r = scoreCohort(cohort);
    for (const c of r.composite) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(100);
    }
    expect(mean(r.composite)).toBeGreaterThan(45);
    expect(mean(r.composite)).toBeLessThan(55);
    expect(stdev(r.composite)).toBeGreaterThan(10);
    expect(stdev(r.composite)).toBeLessThan(20);
  });
});

describe("performance bands (spec \u00a704)", () => {
  it("quota bands at n = 45 follow the fixed Year-1 quotas", () => {
    const scores = Array.from({ length: 45 }, (_, i) => 100 - i);
    const bands = quotaBands(scores);
    const count = (b: string) => bands.filter((x) => x === b).length;
    expect(count("Distinction")).toBe(4);   // round(45/12)
    expect(count("Merit")).toBe(8);         // round(45/6)
    expect(count("Pass")).toBe(11);         // round(45/4)
    expect(count("Participation")).toBe(22);
    expect(bands[0]).toBe("Distinction");
    expect(bands[44]).toBe("Participation");
  });

  it("composite-scale boundaries match the \u00a704 table", () => {
    expect(bandFromComposite(70)).toBe("Distinction");
    expect(bandFromComposite(69.9)).toBe("Merit");
    expect(bandFromComposite(61)).toBe("Merit");
    expect(bandFromComposite(60.9)).toBe("Pass");
    expect(bandFromComposite(50)).toBe("Pass");
    expect(bandFromComposite(49.9)).toBe("Participation");
  });
});

describe("demo cohort simulator", () => {
  it("is deterministic for a given seed", () => {
    expect(demoCohort("ailx-2026-demo", 44)).toEqual(demoCohort("ailx-2026-demo", 44));
    expect(demoCohort("a", 5)).not.toEqual(demoCohort("b", 5));
  });
});
