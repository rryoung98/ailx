/**
 * Score rounding — and the negative zero that reached a stored T2 score.
 *
 * `-0` passes every range check, compares `=== 0`, prints as "0", and is a
 * DIFFERENT value to content-address. The canonical encoder refuses it (see
 * hash.test.ts), which is how it was found: T2's `criterionC` is
 * `-(probit(H) + probit(F)) / 2`, and a perfectly unbiased responder makes
 * that `-0`. The unbiased responder is not an edge case.
 */
import { describe, expect, it } from "vitest";
import { canonicalJson, round3 } from "../src/index.js";

describe("round3", () => {
  it("rounds to three decimals", () => {
    expect(round3(1.23456)).toBe(1.235);
    expect(round3(1.2344)).toBe(1.234);
    expect(round3(30)).toBe(30);
  });

  it("never returns negative zero, from any of the ways it arises", () => {
    for (const x of [-0, -0.0004, -0.00049999, -1e-9, 0 * -1, -(0 + 0) / 2]) {
      expect(Object.is(round3(x), -0), `round3(${x})`).toBe(false);
      expect(Object.is(round3(x), 0)).toBe(true);
    }
  });

  it("keeps a real negative that survives rounding", () => {
    expect(round3(-0.5)).toBe(-0.5);
    expect(round3(-0.0006)).toBe(-0.001);
  });

  it("produces values the canonical encoder will accept", () => {
    // The pre-fix value threw here, which is exactly what we want it to do.
    expect(() => canonicalJson({ criterionC: round3(-0) })).not.toThrow();
    expect(() => canonicalJson({ criterionC: Math.round(-0 * 1000) / 1000 })).toThrow(
      /negative zero/,
    );
  });
});
