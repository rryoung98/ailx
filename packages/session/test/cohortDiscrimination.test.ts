import { describe, expect, it } from "vitest";
import { demoCohort, scoreCohort } from "../src/index.js";

/**
 * Live bug: the demo cohort had no weak peers, so ANY casual run ranked
 * below all 44 synthetic peers and the rank->probit transform pinned every
 * report at the identical floor (15.7) regardless of raw scores. The
 * mixture cohort must discriminate ordinary low scores.
 */
describe("demo cohort low-end discrimination", () => {
  const cohort = demoCohort("ailx-2026.1-demo-cohort", 44);
  const compositeOf = (raw: { t1: number; t2: number; t3: number; t4: number }) => {
    const all = [...cohort, raw];
    return scoreCohort(all).composite[all.length - 1];
  };
  it("modest runs clear the floor and order monotonically", () => {
    const weak = compositeOf({ t1: 15, t2: 20, t3: 10, t4: 15 });
    const mid = compositeOf({ t1: 30, t2: 25, t3: 10, t4: 20 });
    const strong = compositeOf({ t1: 45, t2: 40, t3: 30, t4: 40 });
    const floor = compositeOf({ t1: 0, t2: 0, t3: 0, t4: 0 });
    expect(weak).toBeGreaterThan(floor);
    expect(mid).toBeGreaterThan(weak);
    expect(strong).toBeGreaterThan(mid);
  });
  it("cohort spans casual play: some peers average under 25 raw", () => {
    const avg = cohort.map((r) => (r.t1 + r.t2 + r.t3 + r.t4) / 4);
    expect(Math.min(...avg)).toBeLessThan(25);
  });
});
