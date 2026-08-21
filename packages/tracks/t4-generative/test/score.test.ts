import { describe, it, expect } from "vitest";
import { runPure } from "@ailx/core";
import type { Judgment, ScoreInputs } from "@ailx/core";
import {
  scoreT4,
  steeringEfficiency,
  quotaEfficiency,
  generationSeries,
} from "../src/score.js";
import { t4Plugin } from "../src/plugin.js";
import type { T4Artifact } from "../src/types.js";

const cfg = t4Plugin.validateConfig({ maxGenerations: 6 });

const J = (dimension: string, sample: number, value: number): Judgment => ({
  dimension,
  sample,
  value,
  modelId: "demo-judge@1",
});

const goldenArtifact: T4Artifact = {
  generations: [
    { index: 0, prompt: "a boat", svg: "<svg/>", clientTs: "t0" },
    { index: 1, prompt: "three boats on a wave", svg: "<svg/>", clientTs: "t1" },
    { index: 2, prompt: "three boats, storm", svg: "<svg/>", clientTs: "t2" },
    { index: 3, prompt: "three boats on a storm wave, gold star, centered", svg: "<svg/>", clientTs: "t3" },
  ],
  chosenIndex: 3,
  note: "Iterated toward the storm reading; the star anchors hope.",
};

const goldenJudgments: Judgment[] = [
  J("brief-fit", 0, 0.8),
  J("brief-fit", 1, 0.7),
  J("brief-fit", 2, 0.9),
  J("comparative", 0, 0.55),
  J("provenance", 0, 1.0),
  J("direction-note", 0, 0.6),
  // per-generation judge values, sample = generation index (order scrambled
  // on purpose — score() must sort by sample):
  J("generation", 2, 0.45),
  J("generation", 0, 0.3),
  J("generation", 3, 0.7),
  J("generation", 1, 0.5),
];

const goldenInputs: ScoreInputs<T4Artifact> = {
  artifact: goldenArtifact,
  judgments: goldenJudgments,
  rubricVersion: "test-rubric-v1",
};

describe("scoreT4 golden fixture", () => {
  it("matches the spec allocation exactly (30/40/20/10)", () => {
    const s = runPure(() => scoreT4(goldenInputs, cfg));
    expect(s.raw["brief-fit"]).toBe(24);
    expect(s.raw.comparative).toBe(22);
    expect(s.raw.craft).toBe(13.695);
    expect(s.raw.provenance).toBe(10);
    expect(s.raw["craft.steering"]).toBe(0.61);
    expect(s.raw["craft.quota"]).toBe(1);
    expect(s.scaled).toBe(69.695);
  });

  it("is deterministic under runPure", () => {
    const a = runPure(() => scoreT4(goldenInputs, cfg));
    const b = runPure(() => scoreT4(goldenInputs, cfg));
    expect(a).toEqual(b);
  });

  it("no judgments scores only the quota process component", () => {
    const s = runPure(() =>
      scoreT4({ ...goldenInputs, judgments: [] }, cfg),
    );
    // craft = 0.5*0 + 0.3*0 + 0.2*1 = 0.2 -> 4 pts; everything else 0.
    expect(s.scaled).toBe(4);
  });
});

describe("steeringEfficiency", () => {
  it("is 0 without at least two generations", () => {
    expect(steeringEfficiency([], 0)).toBe(0);
    expect(steeringEfficiency([0.9], 0)).toBe(0);
  });
  it("rewards monotonic diagnostic improvement toward the chosen output", () => {
    expect(steeringEfficiency([0.2, 0.5, 0.8, 1.0], 3)).toBe(1);
  });
  it("penalizes random iteration that ends where it started", () => {
    expect(steeringEfficiency([0.5, 0.3, 0.5], 2)).toBeCloseTo(0, 5);
  });
  it("handles a perfect first generation without dividing by zero", () => {
    expect(steeringEfficiency([1, 1], 1)).toBeCloseTo(0.6);
  });
});

describe("quotaEfficiency", () => {
  it("full credit for 2..quota renders, half for a single render", () => {
    expect(quotaEfficiency(0, 6)).toBe(0);
    expect(quotaEfficiency(1, 6)).toBe(0.5);
    expect(quotaEfficiency(2, 6)).toBe(1);
    expect(quotaEfficiency(6, 6)).toBe(1);
    expect(quotaEfficiency(9, 6)).toBeCloseTo(0.5);
  });
});

describe("generationSeries", () => {
  it("sorts stored per-generation judgments by sample index", () => {
    expect(generationSeries(goldenJudgments)).toEqual([0.3, 0.5, 0.45, 0.7]);
  });
});
