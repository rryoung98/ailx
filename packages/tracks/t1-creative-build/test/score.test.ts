import { describe, it, expect } from "vitest";
import { runPure, judgmentArrivalOrders } from "@ailx/core";
import type { Judgment, ScoreInputs } from "@ailx/core";
import { scoreT1, medianForDimension, processSignal } from "../src/score.js";
import { t1Plugin } from "../src/plugin.js";
import { T1_TOTAL_POINTS, T1_WEIGHTS, type T1Artifact } from "../src/types.js";

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
  it("matches the allocation table exactly (40/60/20/15/25)", () => {
    const s = runPure(() => scoreT1(goldenInputs, cfg));
    expect(s.raw).toEqual({
      functional: 36, // 40 × median(0.9, 0.8, 1.0)
      comparative: 37.2, // 60 × 0.62
      ambition: 12, // 20 × median(0.5, 0.7)
      rationale: 12, // 15 × 0.8
      process: 12.5, // 25 × 0.5 — MODEL-FREE, from the prompt log
      "process.signal": 0.5, // 2 distinct prompts, 1 closed cycle
    });
    expect(s.scaled).toBe(109.7);
  });

  it("draws its weights from the ONE allocation table, not a local copy", () => {
    expect(T1_WEIGHTS).toEqual({
      functional: 40, comparative: 60, ambition: 20, rationale: 15, process: 25,
    });
    expect(T1_TOTAL_POINTS).toBe(160);
  });

  it("is deterministic under runPure (no clock, no randomness, no fetch)", () => {
    const a = runPure(() => scoreT1(goldenInputs, cfg));
    const b = runPure(() => scoreT1(goldenInputs, cfg));
    expect(a).toEqual(b);
  });

  it("reaches exactly 160 only with perfect judgments AND a worked prompt log", () => {
    const workedLog: T1Artifact["promptLog"] = [
      { kind: "prompted", prompt: "a", clientTs: "t" },
      { kind: "revised", clientTs: "t" },
      { kind: "prompted", prompt: "b", clientTs: "t" },
      { kind: "revised", clientTs: "t" },
      { kind: "prompted", prompt: "c", clientTs: "t" },
      { kind: "revised", clientTs: "t" },
    ];
    const perfectJudgments = [
      J("functional", 0, 1),
      J("comparative", 0, 1),
      J("ambition", 0, 1),
      J("rationale", 0, 1),
    ];
    const perfect: ScoreInputs<T1Artifact> = {
      artifact: { ...goldenArtifact, promptLog: workedLog },
      judgments: perfectJudgments,
      rubricVersion: "test-rubric-v1",
    };
    expect(runPure(() => scoreT1(perfect, cfg)).scaled).toBe(160);

    // Same artefact, no prompt log: the 25 process points are simply absent.
    const noLog: ScoreInputs<T1Artifact> = {
      artifact: { ...goldenArtifact, promptLog: [] },
      judgments: perfectJudgments,
      rubricVersion: "test-rubric-v1",
    };
    expect(runPure(() => scoreT1(noLog, cfg)).scaled).toBe(135);
  });

  it("caps the prompt log at its 25 points — process can never buy the artefact", () => {
    const spam: ScoreInputs<T1Artifact> = {
      artifact: {
        html: "<p>x</p>",
        selfReport: "",
        promptLog: Array.from({ length: 200 }, (_, i) => [
          { kind: "prompted" as const, prompt: `p${i}`, clientTs: "t" },
          { kind: "revised" as const, clientTs: "t" },
        ]).flat(),
      },
      judgments: [],
      rubricVersion: "test-rubric-v1",
    };
    const s = runPure(() => scoreT1(spam, cfg));
    expect(s.raw["process.signal"]).toBe(1);
    expect(s.scaled).toBe(25);
    expect(s.scaled).toBeLessThan(T1_TOTAL_POINTS / 2);
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
  const art = (promptLog: T1Artifact["promptLog"]): T1Artifact => ({
    html: "", promptLog, selfReport: "",
  });
  const P = (prompt?: string) => ({ kind: "prompted" as const, ...(prompt !== undefined ? { prompt } : {}), clientTs: "t" });
  const REV = { kind: "revised" as const, clientTs: "t" };

  it("is 0 with an empty log", () => {
    expect(processSignal(art([]))).toBe(0);
  });

  it("is 0 when the artefact changed but nothing was ever prompted", () => {
    // Revisions alone are hand-editing, which is exactly the prior web skill
    // the component exists to distinguish FROM model direction.
    expect(processSignal(art([REV, REV, REV]))).toBe(0);
  });

  it("gives breadth credit for distinct prompts with no revision", () => {
    expect(processSignal(art([P("a"), P("b"), P("c")]))).toBe(0.5);
  });

  it("counts a prompt→revise cycle for closure credit", () => {
    expect(processSignal(art([P("a"), REV]))).toBeCloseTo(0.5 / 3 + 0.5 / 3, 12);
  });

  it("reaches 1 at three distinct prompts each followed by a revision", () => {
    expect(processSignal(art([P("a"), REV, P("b"), REV, P("c"), REV]))).toBe(1);
  });

  it("caps at 1 however long the log runs", () => {
    const log = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? P(`p${i}`) : REV));
    expect(processSignal(art(log))).toBe(1);
  });

  /**
   * The two anti-gaming rules. Both were free when the signal was a
   * diagnostic; neither is free now that it is worth 25 points.
   */
  it("counts a repeated prompt ONCE, however many times it is sent", () => {
    const spam = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? P("same") : REV));
    // One distinct prompt, one closed cycle — not ten of each.
    expect(processSignal(art(spam))).toBeCloseTo(0.5 / 3 + 0.5 / 3, 12);
  });

  it("treats prompts with no recorded text as one prompt, not many", () => {
    expect(processSignal(art([P(), P(), P()]))).toBeCloseTo(0.5 / 3, 12);
  });

  it("is case- and whitespace-insensitive when deciding distinctness", () => {
    expect(processSignal(art([P("Ship it"), P("  ship IT  ")]))).toBeCloseTo(0.5 / 3, 12);
  });

  it("does not pay for revisions that no new prompt preceded", () => {
    // Prompt once, then hand-edit nine times: one cycle, not nine.
    const log = [P("a"), REV, REV, REV, REV, REV, REV, REV, REV, REV];
    expect(processSignal(art(log))).toBeCloseTo(0.5 / 3 + 0.5 / 3, 12);
  });

  it("reads the log in order — revisions before any prompt close nothing", () => {
    expect(processSignal(art([REV, REV, P("a"), P("b"), P("c")]))).toBe(0.5);
  });
});

/**
 * ORDER INVARIANCE — the property that makes "byte-identically recomputable
 * from stored inputs" true. Stored judgments come back from a database, and a
 * read without ORDER BY has no guaranteed row order, so a permuted read must
 * not move the score by one bit.
 */
describe("scoreT1 is order-invariant over stored judgment rows", () => {
  const canonical = (s: unknown) => JSON.stringify(s);

  it("gives byte-identical output for EVERY arrival order of the golden rows", () => {
    const expected = canonical(runPure(() => scoreT1(goldenInputs, cfg)));
    for (const order of judgmentArrivalOrders(goldenJudgments, 5040)) {
      const s = runPure(() => scoreT1({ ...goldenInputs, judgments: order }, cfg));
      expect(canonical(s)).toBe(expected);
    }
  });

  /**
   * Values chosen because they are PROVEN to diverge under a naive
   * left-to-right sum: [0.1, 0.2, 0.30000000000000004] means
   * 0.20000000000000004 or 0.19999999999999998 by permutation alone. The
   * assertion below fails if that ever stops being true, so the fixture
   * cannot go quietly blunt.
   */
  it("gives byte-identical output on values that DO diverge under naive summation", () => {
    const sharp = [0.1, 0.2, 0.30000000000000004];
    expect(
      new Set([
        sharp.reduce((a, b) => a + b, 0),
        [...sharp].reverse().reduce((a, b) => a + b, 0),
      ]).size,
    ).toBe(2);
    const rows = [
      J("comparative", 0, sharp[0]),
      J("comparative", 1, sharp[1]),
      J("comparative", 2, sharp[2]),
      J("ambition", 0, sharp[0]),
      J("ambition", 1, sharp[2]),
    ];
    const expected = canonical(
      runPure(() => scoreT1({ ...goldenInputs, judgments: rows }, cfg)),
    );
    for (const order of judgmentArrivalOrders(rows)) {
      expect(
        canonical(runPure(() => scoreT1({ ...goldenInputs, judgments: order }, cfg))),
      ).toBe(expected);
    }
  });

  it("does not let rows sharing a dimension and sample tie-break by arrival", () => {
    const dup: Judgment[] = [
      { dimension: "rationale", sample: 0, value: 0.4, modelId: "judge-b@1" },
      { dimension: "rationale", sample: 0, value: 0.8, modelId: "judge-a@1" },
    ];
    const a = medianForDimension(dup, "rationale");
    const b = medianForDimension([...dup].reverse(), "rationale");
    expect(a).toBe(b);
    expect(a).toBeCloseTo(0.6, 12);
  });

  it("never lets a stored -0 leak into the score as -0", () => {
    const s = runPure(() =>
      scoreT1({ ...goldenInputs, judgments: [J("functional", 0, -0)] }, cfg),
    );
    expect(Object.is(s.raw.functional, 0)).toBe(true);
  });
});
