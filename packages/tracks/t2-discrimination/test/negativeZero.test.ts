/**
 * No score of record may contain a value the canonical encoder cannot address.
 *
 * `criterionC` is `-(probit(H) + probit(F)) / 2`. When hit rate and
 * false-alarm rate are symmetric the sum is exactly 0 and the negation makes
 * `-0` — the UNBIASED responder, which is the middle of the distribution, not
 * an edge. `-0` compares `=== 0`, prints as "0" and is invisible in a
 * debugger, but it is a different value to content-address, so it reached a
 * stored T2 score and made that score unhashable once the encoder stopped
 * silently aliasing it. Every numeric leaf of every T2 score is checked here,
 * not just the one that was caught.
 */
import { describe, expect, it } from "vitest";
import { canonicalJson } from "@ailx/core";
import { plugin } from "../src/plugin.js";
import { config, items } from "./fixtures.js";

/** Answers that make H and F symmetric: half the signals hit, half the noise
 *  false-alarmed, so probit(H) === -probit(F) and their sum is exactly 0. */
function unbiasedResponses() {
  const signal = items.filter((i) => i.key === "ai");
  const noise = items.filter((i) => i.key !== "ai");
  const answer = (id: string, saidAi: boolean) => ({
    itemId: id, choice: saidAi ? 1 : 0, confidence: 50, latencyMs: 1000,
  });
  return [
    ...signal.map((i, n) => answer(i.id, n < signal.length / 2)),
    ...noise.map((i, n) => answer(i.id, n < noise.length / 2)),
  ];
}

describe("T2 never stores a negative zero", () => {
  it("the unbiased responder's criterionC is +0, and the score is addressable", () => {
    const s = plugin.score(
      { artifact: { responses: unbiasedResponses() as never }, judgments: [], rubricVersion: "t" },
      config,
    );
    expect(Object.is(s.raw.criterionC, -0)).toBe(false);
    expect(() => canonicalJson(s)).not.toThrow();
  });

  it("no numeric leaf of any T2 score is -0, across a sweep of answer patterns", () => {
    for (let cut = 0; cut <= items.length; cut++) {
      const responses = items.map((i, n) => ({
        itemId: i.id, choice: n < cut ? 1 : 0, confidence: (n * 17) % 101, latencyMs: 900 + n,
      }));
      const s = plugin.score(
        { artifact: { responses: responses as never }, judgments: [], rubricVersion: "t" },
        config,
      );
      for (const [k, v] of Object.entries(s.raw as Record<string, number>)) {
        expect(Object.is(v, -0), `raw.${k} at cut=${cut}`).toBe(false);
      }
      expect(Object.is(s.scaled, -0), `scaled at cut=${cut}`).toBe(false);
      expect(() => canonicalJson(s), `canonicalJson at cut=${cut}`).not.toThrow();
    }
  });
});
