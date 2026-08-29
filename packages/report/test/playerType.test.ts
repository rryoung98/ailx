import { describe, expect, it } from "vitest";
import { AXES, cohortMedians, playerType } from "../src/playerType.js";

describe("player type (MBTI-style lens)", () => {
  it("all 16 codes resolve to distinct named types", () => {
    const seen = new Set<string>();
    for (let m = 0; m < 16; m++) {
      const med = cohortMedians();
      const raw = {
        t1: m & 8 ? med.t1 + 1 : med.t1 - 1,
        t2: m & 4 ? med.t2 + 1 : med.t2 - 1,
        t3: m & 2 ? med.t3 + 1 : med.t3 - 1,
        t4: m & 1 ? med.t4 + 1 : med.t4 - 1,
      };
      const p = playerType(raw);
      expect(p.name).toBeTruthy();
      seen.add(`${p.code}:${p.name}`);
      expect(p.strengths.length + p.watchouts.length).toBe(4);
    }
    expect(seen.size).toBe(16);
  });
  it("high on every track earns the four high letters", () => {
    const med = cohortMedians();
    const p = playerType({ t1: 100, t2: 100, t3: 100, t4: 100 });
    expect(p.code).toBe(AXES.map((a) => a.hi.letter).join(""));
    expect(p.strengths).toHaveLength(4);
    expect(med.t1).toBeGreaterThan(0);
  });
  it("is deterministic", () => {
    const raw = { t1: 40, t2: 60, t3: 20, t4: 70 };
    expect(playerType(raw)).toEqual(playerType(raw));
  });
});
