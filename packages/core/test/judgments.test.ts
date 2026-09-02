import { describe, it, expect } from "vitest";
import type { Judgment } from "../src/index.js";
import {
  compareJudgments,
  canonicalJudgments,
  checkJudgmentRange,
  validatedValues,
  meanValue,
  medianValue,
  medianForDimension,
  meanForDimension,
  orderedDimensionValues,
} from "../src/index.js";

const J = (
  dimension: string,
  sample: number,
  value: number,
  modelId = "m1",
  evidence?: string,
): Judgment => ({ dimension, sample, value, modelId, evidence });

/**
 * Three legal values whose naive left-to-right sum DIVERGES by permutation.
 * Proven below, not assumed: the assertion in "the fixture is sharp" fails
 * loudly if a future engine ever makes these associative.
 */
const SHARP = [0.1, 0.2, 0.30000000000000004];

function permutations<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [xs.slice()];
  const out: T[][] = [];
  xs.forEach((x, i) => {
    const rest = [...xs.slice(0, i), ...xs.slice(i + 1)];
    for (const p of permutations(rest)) out.push([x, ...p]);
  });
  return out;
}

const naiveMean = (vals: readonly number[]) =>
  vals.reduce((s, v) => s + v, 0) / vals.length;

describe("the fixture is sharp", () => {
  it("naive summation really does disagree with itself on SHARP", () => {
    const means = new Set(permutations(SHARP).map(naiveMean));
    expect(means.size).toBeGreaterThan(1);
    expect([...means].sort()).toEqual([
      0.19999999999999998, 0.20000000000000004,
    ]);
  });
});

describe("compareJudgments — one canonical TOTAL order", () => {
  it("orders by dimension, sample, modelId, value, evidence in that order", () => {
    expect(compareJudgments(J("a", 0, 0.5), J("b", 0, 0.5))).toBe(-1);
    expect(compareJudgments(J("a", 1, 0.5), J("a", 0, 0.5))).toBe(1);
    expect(compareJudgments(J("a", 0, 0.5, "m1"), J("a", 0, 0.5, "m2"))).toBe(-1);
    expect(compareJudgments(J("a", 0, 0.4, "m1"), J("a", 0, 0.5, "m1"))).toBe(-1);
    expect(
      compareJudgments(J("a", 0, 0.5, "m1", "x"), J("a", 0, 0.5, "m1", "y")),
    ).toBe(-1);
    expect(
      compareJudgments(J("a", 0, 0.5, "m1", "x"), J("a", 0, 0.5, "m1", "x")),
    ).toBe(0);
  });

  it("treats a missing evidence as the empty string, and ranks it first", () => {
    expect(compareJudgments(J("a", 0, 0.5, "m1"), J("a", 0, 0.5, "m1", "x"))).toBe(-1);
    expect(compareJudgments(J("a", 0, 0.5, "m1"), J("a", 0, 0.5, "m1", ""))).toBe(0);
  });

  it("canonicalJudgments does not mutate the caller's array", () => {
    const rows = [J("b", 0, 0.5), J("a", 0, 0.5)];
    const before = rows.slice();
    canonicalJudgments(rows);
    expect(rows).toEqual(before);
  });

  it("puts every permutation of the same rows in the same order", () => {
    const rows = [
      J("analysis", 0, 0.8, "m2", "b"),
      J("analysis", 0, 0.8, "m1", "a"),
      J("analysis", 1, 0.6, "m1"),
      J("craft", 0, 0.1, "m1"),
    ];
    const canonical = JSON.stringify(canonicalJudgments(rows));
    for (const p of permutations(rows)) {
      expect(JSON.stringify(canonicalJudgments(p))).toBe(canonical);
    }
  });
});

describe("checkJudgmentRange — F10, and the track label", () => {
  it("names the track that owns the bad row", () => {
    expect(() => checkJudgmentRange(J("d", 3, 5), "t1")).toThrow(
      /t1 judgment out of range: dimension=d sample=3 value=5/,
    );
    expect(() => checkJudgmentRange(J("d", 0, -0.1), "t3")).toThrow(/^t3 judgment out of range/);
    expect(() => checkJudgmentRange(J("d", 0, Number.NaN), "t4")).toThrow(/^t4 judgment out of range/);
    expect(() => checkJudgmentRange(J("d", 0, Number.POSITIVE_INFINITY), "t4")).toThrow(
      /out of range/,
    );
  });

  it("accepts the closed interval endpoints", () => {
    expect(checkJudgmentRange(J("d", 0, 0), "t1")).toBe(0);
    expect(checkJudgmentRange(J("d", 0, 1), "t1")).toBe(1);
  });

  it("normalizes -0 to +0, because -0 serializes differently", () => {
    expect(Object.is(checkJudgmentRange(J("d", 0, -0), "t1"), 0)).toBe(true);
  });
});

describe("meanValue — order-invariant by construction", () => {
  it("returns one identical mean for EVERY permutation of the sharp triple", () => {
    const means = new Set(permutations(SHARP).map((p) => meanValue(p)));
    expect(means.size).toBe(1);
  });

  it("agrees with the naive mean on values that do not diverge", () => {
    expect(meanValue([0.25, 0.5, 0.75])).toBe(0.5);
  });

  it("is 0 on empty, and does not mutate its input", () => {
    expect(meanValue([])).toBe(0);
    const vals = [0.3, 0.1];
    meanValue(vals);
    expect(vals).toEqual([0.3, 0.1]);
  });
});

describe("medianValue", () => {
  it("takes the middle of an odd count and the midpoint of an even one", () => {
    expect(medianValue([0.2, 1, 0.4])).toBe(0.4);
    expect(medianValue([0.2, 0.6])).toBeCloseTo(0.4);
    expect(medianValue([])).toBe(0);
  });

  it("is identical across every permutation, including the sharp triple", () => {
    const meds = new Set(permutations(SHARP).map((p) => medianValue(p)));
    expect(meds.size).toBe(1);
    const four = [0.1, 0.2, 0.30000000000000004, 0.7];
    expect(new Set(permutations(four).map((p) => medianValue(p))).size).toBe(1);
  });

  it("never returns -0 from an all-zero even split", () => {
    expect(Object.is(medianValue([-0, -0]), 0)).toBe(true);
  });
});

describe("validatedValues / medianForDimension / meanForDimension", () => {
  const rows = [
    J("analysis", 2, 0.30000000000000004, "m3"),
    J("analysis", 0, 0.1, "m1"),
    J("analysis", 1, 0.2, "m2"),
    J("craft", 0, 1, "m1"),
  ];

  it("selects only the asked-for dimension", () => {
    expect(validatedValues(rows, "craft", "t4")).toEqual([1]);
    expect(validatedValues(rows, "missing", "t4")).toEqual([]);
    expect(medianForDimension(rows, "missing", "t1")).toBe(0);
    expect(meanForDimension(rows, "missing", "t3")).toBe(0);
  });

  it("returns the SAME bits for every permutation of the rows", () => {
    const mean = meanForDimension(rows, "analysis", "t3");
    const median = medianForDimension(rows, "analysis", "t1");
    for (const p of permutations(rows)) {
      expect(meanForDimension(p, "analysis", "t3")).toBe(mean);
      expect(medianForDimension(p, "analysis", "t1")).toBe(median);
    }
  });

  it("throws on an out-of-range row in the selected dimension only", () => {
    expect(() => validatedValues([J("a", 0, 2)], "a", "t3")).toThrow(/t3 judgment out of range/);
    expect(validatedValues([J("a", 0, 2)], "b", "t3")).toEqual([]);
  });
});

describe("orderedDimensionValues — positional series", () => {
  it("orders by sample, then breaks ties by the canonical total order", () => {
    const rows = [
      J("generation", 1, 0.5, "mB"),
      J("generation", 0, 0.3, "mA"),
      J("generation", 1, 0.9, "mA"),
    ];
    const expected = [0.3, 0.9, 0.5];
    expect(orderedDimensionValues(rows, "generation", "t4")).toEqual(expected);
    for (const p of permutations(rows)) {
      expect(orderedDimensionValues(p, "generation", "t4")).toEqual(expected);
    }
  });

  it("validates before sorting, so a NaN row throws rather than sorting oddly", () => {
    expect(() =>
      orderedDimensionValues(
        [J("generation", 1, 0.5), J("generation", 0, Number.NaN)],
        "generation",
        "t4",
      ),
    ).toThrow(/t4 judgment out of range/);
  });
});
