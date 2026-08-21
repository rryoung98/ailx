import { describe, it, expect } from "vitest";
import { runPure } from "@ailx/core";
import type { Judgment, ScoreInputs } from "@ailx/core";
import { scoreT1, medianForDimension, processSignal } from "../src/score.js";
import { t1Plugin } from "../src/plugin.js";
import type { T1Artifact } from "../src/types.js";

const cfg = t1Plugin.validateConfig({});

const J = (dimension: string, sample: number, value: number): Judgment => ({
  dimension,
  sample,
  value,
  modelId: "demo-judge@1",
});

const goldenArtifact: T1Artifact = {
  html: "<!doctype html><html><head><title>x</title></head><body><main><h1>Kim</h1></main></body></html>",
  promptLog: [
    { kind: "prompted", prompt: "hero section", clientTs: "2026-01-01T00:00:00Z" },
    { kind: "revised", clientTs: "2026-01-01T00:05:00Z" },
    { kind: "prompted", prompt: "contact footer", clientTs: "2026-01-01T00:10:00Z" },
  ],
  selfReport: "Intent: communicate research focus to summit delegates.",
};

const goldenJudgments: Judgment[] = [
  J("functional", 0, 0.9),
  J("functional", 1, 0.8),
  J("functional", 2, 1.0),
  J("comparative", 0, 0.62),
  J("ambition", 0, 0.5),
  J("ambition", 1, 0.7),
  J("rationale", 0, 0.8),
];

const goldenInputs: ScoreInputs<T1Artifact> = {
  artifact: goldenArtifact,
  judgments: goldenJudgments,
  rubricVersion: "test-rubric-v1",
};

describe("scoreT1 golden fixture", () => {
  it("matches the spec allocation exactly (30/40/20/10)", () => {
    const s = runPure(() => scoreT1(goldenInputs, cfg));
    expect(s.raw).toEqual({
      functional: 27,
      comparative: 24.8,
      ambition: 12,
      rationale: 8, // ALL 10 rationale points from the judged dimension (F8)
      "process.signal": 0.75, // diagnostic only — adds no points
    });
    expect(s.scaled).toBe(71.8);
  });

  it("is deterministic under runPure (no clock, no randomness, no fetch)", () => {
    const a = runPure(() => scoreT1(goldenInputs, cfg));
    const b = runPure(() => scoreT1(goldenInputs, cfg));
    expect(a).toEqual(b);
  });

  it("perfect judgments reach 100 regardless of prompt-log volume (F8)", () => {
    const perfect: ScoreInputs<T1Artifact> = {
      artifact: {
        ...goldenArtifact,
        promptLog: [
          { kind: "prompted", prompt: "a", clientTs: "t" },
          { kind: "revised", clientTs: "t" },
          { kind: "prompted", prompt: "b", clientTs: "t" },
          { kind: "revised", clientTs: "t" },
        ],
      },
      judgments: [
        J("functional", 0, 1),
        J("comparative", 0, 1),
        J("ambition", 0, 1),
        J("rationale", 0, 1),
      ],
      rubricVersion: "test-rubric-v1",
    };
    expect(runPure(() => scoreT1(perfect, cfg)).scaled).toBe(100);
  });

  it("no judgments and empty log score 0", () => {
    const empty: ScoreInputs<T1Artifact> = {
      artifact: { html: "<p>x</p>", promptLog: [], selfReport: "" },
      judgments: [],
      rubricVersion: "test-rubric-v1",
    };
    expect(runPure(() => scoreT1(empty, cfg)).scaled).toBe(0);
  });
});

describe("medianForDimension", () => {
  it("takes the median of samples", () => {
    expect(medianForDimension([J("d", 0, 0.2), J("d", 1, 1), J("d", 2, 0.4)], "d")).toBe(0.4);
    expect(medianForDimension([J("d", 0, 0.2), J("d", 1, 0.6)], "d")).toBeCloseTo(0.4);
    expect(medianForDimension([], "d")).toBe(0);
  });
  it("throws on out-of-range judgment values — contract is normalized [0,1] (F10)", () => {
    expect(() => medianForDimension([J("d", 0, 5)], "d")).toThrow(/out of range/);
    expect(() => medianForDimension([J("d", 0, -0.1)], "d")).toThrow(/out of range/);
    expect(() => medianForDimension([J("d", 0, Number.NaN)], "d")).toThrow(/out of range/);
    expect(() => scoreT1({ ...goldenInputs, judgments: [J("rationale", 0, 3)] }, cfg)).toThrow(/out of range/);
  });
});

describe("processSignal", () => {
  it("prompt-log activity alone earns ZERO points (F8 regression)", () => {
    const busyLogNoJudgments: ScoreInputs<T1Artifact> = {
      artifact: {
        html: "<p>x</p>",
        promptLog: [
          { kind: "prompted", prompt: "a", clientTs: "t" },
          { kind: "revised", clientTs: "t" },
          { kind: "prompted", prompt: "b", clientTs: "t" },
          { kind: "revised", clientTs: "t" },
        ],
        selfReport: "",
      },
      judgments: [],
      rubricVersion: "test-rubric-v1",
    };
    const s = runPure(() => scoreT1(busyLogNoJudgments, cfg));
    expect(s.scaled).toBe(0);
    expect(s.raw["process.signal"]).toBe(1); // reported, not scored
  });
  it("is 0 with an empty log", () => {
    expect(processSignal({ html: "", promptLog: [], selfReport: "" })).toBe(0);
  });
  it("gives half credit for prompting without revising", () => {
    expect(
      processSignal({
        html: "",
        promptLog: [
          { kind: "prompted", prompt: "a", clientTs: "t" },
          { kind: "prompted", prompt: "b", clientTs: "t" },
        ],
        selfReport: "",
      }),
    ).toBe(0.5);
  });
  it("caps at 1 for sustained prompt→revise loops", () => {
    const log = Array.from({ length: 6 }, (_, i) => ({
      kind: (i % 2 === 0 ? "prompted" : "revised") as "prompted" | "revised",
      clientTs: "t",
    }));
    expect(processSignal({ html: "", promptLog: log, selfReport: "" })).toBe(1);
  });
});
