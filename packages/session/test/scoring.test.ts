import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runPure, trackPoints } from "@ailx/core";
import {
  bandFromComposite, demoCohort, mean, midRankPercentiles, probit,
  quotaBands, scoreCohort, stdev, zScores, TRACK_WEIGHTS, SCORED_TRACKS,
  seededUniform,
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
  /**
   * Weights are PROPORTIONAL TO POINTS, not equal — and the difference is
   * load-bearing. The composite is built from z-scores, so keeping "equal
   * weighting" after T4 became a showcase would have raised T2 from a quarter
   * of the composite to a third, i.e. promoted the track the point
   * allocation had just demoted.
   */
  it("weights the scored tracks by their share of the 375 points", () => {
    expect(TRACK_WEIGHTS).toEqual({
      t1: 135 / 375,
      t2: 80 / 375,
      t3: 160 / 375,
      t4: 0,
    });
    const scored = SCORED_TRACKS.map((t) => TRACK_WEIGHTS[t]);
    expect(scored.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    for (const t of SCORED_TRACKS) {
      expect(TRACK_WEIGHTS[t]).toBeCloseTo(trackPoints(t) / 375, 12);
    }
  });

  it("gives the showcase track zero weight, and leaves it out of the sum", () => {
    expect(TRACK_WEIGHTS.t4).toBe(0);
    expect([...SCORED_TRACKS]).toEqual(["t1", "t2", "t3"]);
  });

  /**
   * The arithmetic-accident guard: a zero weight is not enough on its own if
   * the z-column is still computed and summed. Moving only T4 must move
   * nothing.
   */
  it("ignores the showcase column entirely — moving only T4 moves no composite", () => {
    const cohort = demoCohort("showcase-neutral", 20);
    const shifted = cohort.map((r) => ({ ...r, t4: (r.t4 + 37) % 100 }));
    const a = scoreCohort(cohort);
    const b = scoreCohort(shifted);
    expect(b.composite).toEqual(a.composite);
    expect(b.band).toEqual(a.band);
    expect(b.zComposite).toEqual(a.zComposite);
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

describe("tie policy + realized cutlines (F14)", () => {
  /** Deterministic pseudo-shuffle driven by seededUniform (no Math.random). */
  function shuffled<T>(xs: readonly T[], seed: string): { arr: T[]; perm: number[] } {
    const perm = xs.map((_, i) => i);
    for (let i = perm.length - 1; i > 0; i--) {
      const j = Math.floor(seededUniform(seed, i) * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    return { arr: perm.map((i) => xs[i]), perm };
  }

  it("breaks quota ties by higher T3, then T2, T1, then attempt hash", () => {
    // 12 candidates → 1 Distinction seat. The top three scores are exactly
    // tied; the documented policy must pick the higher-T3 profile.
    const scores = [5, 5, 5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5, 0];
    const keys = scores.map((_, i) =>
      [50, 50, 50, `hash-${String(i).padStart(2, "0")}`] as const);
    // candidate 2 has the highest T3 among the tied trio
    (keys as unknown as (number | string)[][])[0] = [60, 90, 50, "hash-00"];
    (keys as unknown as (number | string)[][])[1] = [60, 80, 50, "hash-01"];
    (keys as unknown as (number | string)[][])[2] = [70, 10, 50, "hash-02"];
    const bands = quotaBands(scores, keys as never);
    expect(bands[2]).toBe("Distinction");   // highest T3 wins the tie
    expect(bands[0]).toBe("Merit");         // then T2 orders the rest
    expect(bands[1]).toBe("Merit");
    // equal numeric keys → lexicographic attempt hash (ascending) decides
    const flat = [1, 1, 0];
    const flatKeys = [
      [5, 5, 5, "bbbb"],
      [5, 5, 5, "aaaa"],
      [5, 5, 5, "cccc"],
    ] as const;
    const flatBands = quotaBands(flat, flatKeys as never);
    // 3 candidates → 0 Distinction, 1 Merit (round(3/6)=1): "aaaa" outranks "bbbb"
    expect(flatBands[1]).toBe("Merit");
    expect(flatBands[0]).toBe("Pass");
  });

  it("bands are invariant under shuffled input order (property test)", () => {
    // Include deliberate exact ties to exercise the tie policy.
    const base = demoCohort("tie-prop", 40);
    const cohort = [...base, { ...base[3] }, { ...base[17] }, { ...base[3] }];
    const ids = cohort.map((_, i) => `attempt-${i}`);
    const r0 = scoreCohort(cohort, ids);
    for (const seed of ["s1", "s2", "s3", "s4", "s5"]) {
      const { perm } = shuffled(cohort, seed);
      const rs = scoreCohort(perm.map((i) => cohort[i]), perm.map((i) => ids[i]));
      for (let k = 0; k < perm.length; k++) {
        expect(rs.band[k]).toBe(r0.band[perm[k]]);
        expect(rs.composite[k]).toBe(r0.composite[perm[k]]);
      }
    }
  });

  it("reports realized quota cutlines on the composite scale", () => {
    const cohort = demoCohort("cutlines", 45);
    const r = scoreCohort(cohort);
    const minIn = (band: string) =>
      Math.min(...r.composite.filter((_, i) => r.band[i] === band));
    expect(r.bandCutlines.Distinction).toBe(minIn("Distinction"));
    expect(r.bandCutlines.Merit).toBe(minIn("Merit"));
    expect(r.bandCutlines.Pass).toBe(minIn("Pass"));
    // Quotas are authoritative: every Distinction composite ≥ its cutline,
    // and the cutlines are ordered.
    expect(r.bandCutlines.Distinction!).toBeGreaterThan(r.bandCutlines.Merit!);
    expect(r.bandCutlines.Merit!).toBeGreaterThan(r.bandCutlines.Pass!);
  });
});

describe("demo cohort simulator", () => {
  it("is deterministic for a given seed", () => {
    expect(demoCohort("ailx-2026-demo", 44)).toEqual(demoCohort("ailx-2026-demo", 44));
    expect(demoCohort("a", 5)).not.toEqual(demoCohort("b", 5));
  });
});
