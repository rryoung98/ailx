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
  it("matches the allocation table exactly (40/60/20/15)", () => {
    const s = runPure(() => scoreT1(goldenInputs, cfg));
    expect(s.raw).toEqual({
      functional: 36, // 40 × median(0.9, 0.8, 1.0)
      comparative: 37.2, // 60 × 0.62
      ambition: 12, // 20 × median(0.5, 0.7)
      rationale: 12, // 15 × 0.8
      // DIAGNOSTIC, worth nothing: 2 distinct prompts, 1 closed cycle. The
      // key and the value are unchanged from when it was worth 25 points, so
      // a stored signal still means what it meant (TEN-80).
      "process.signal": 0.5,
    });
    // 36 + 37.2 + 12 + 12. The process signal is 0.5 and adds nothing.
    expect(s.scaled).toBe(97.2);
  });

  it("draws its weights from the ONE allocation table, not a local copy", () => {
    expect(T1_WEIGHTS).toEqual({
      functional: 40, comparative: 60, ambition: 20, rationale: 15,
    });
    expect(T1_TOTAL_POINTS).toBe(135);
  });

  it("is deterministic under runPure (no clock, no randomness, no fetch)", () => {
    const a = runPure(() => scoreT1(goldenInputs, cfg));
    const b = runPure(() => scoreT1(goldenInputs, cfg));
    expect(a).toEqual(b);
  });

  it("reaches exactly 135 on perfect judgments, with or without a prompt log", () => {
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
    expect(runPure(() => scoreT1(perfect, cfg)).scaled).toBe(135);

    // Same judgments, no prompt log at all: the same 135. Nothing in T1's
    // score is bought with prompts.
    const noLog: ScoreInputs<T1Artifact> = {
      artifact: { ...goldenArtifact, promptLog: [] },
      judgments: perfectJudgments,
      rubricVersion: "test-rubric-v1",
    };
    const empty = runPure(() => scoreT1(noLog, cfg));
    expect(empty.scaled).toBe(135);
    expect(empty.raw["process.signal"]).toBe(0);
  });

  it("pays nothing for a 200-entry prompt log with no artefact behind it", () => {
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
    // The diagnostic saturates, as it always did...
    expect(s.raw["process.signal"]).toBe(1);
    // ...and buys exactly nothing. This used to be 25 points.
    expect(s.scaled).toBe(0);
    expect(T1_TOTAL_POINTS).toBe(135);
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
   * The two anti-gaming rules. They were added when the signal was worth 25
   * points. The points are gone (TEN-80) and the rules stay, because the
   * diagnostic is research data and a research number that counts twenty
   * presses of one button as twenty prompts is a worse number.
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

  it("pays nothing extra for a pasted wall of text", () => {
    // Prompt length is not evidence of iteration. One 8 kB pasted prompt
    // gets the same breadth and closure credit as one short prompt.
    const wall = P("<html>" + "x".repeat(8000) + "</html>");
    expect(processSignal(art([wall, REV]))).toBeCloseTo(0.5 / 3 + 0.5 / 3, 12);
    expect(processSignal(art([wall, REV]))).toBe(processSignal(art([P("hero section"), REV])));
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

/**
 * VOLUME INVARIANCE — TEN-80's closing condition, for T1.
 *
 * Two artefacts with identical stored judgments and wildly different
 * prompt-log volume must produce an identical `scaled` score. This is the
 * test the previous formula failed BY CONSTRUCTION: `processSignal` is
 * monotone in distinct prompts and closed cycles, so 25 of T1's 160 points
 * moved with volume alone. The evidence is in
 * `.research/ten-80-process-evidence.md`: no published study validates a
 * volume-monotone process score of AI-assisted work against an independent
 * outcome, and PISA 2012 and USMLE Step 3 CCS — the two operational
 * programmes that DO score process — remove credit for excess actions.
 *
 * It is T1-only on purpose. T3 counts verification events, which is a
 * volume-shaped term this branch was told not to touch, so a cross-track
 * version of this file would fail on a track whose design is not under
 * review here. That finding is reported on TEN-80 rather than fixed.
 */
describe("T1 is invariant to prompt-log volume at fixed judgments (TEN-80)", () => {
  const judgments = [
    J("functional", 0, 0.7),
    J("comparative", 0, 0.55),
    J("ambition", 0, 0.4),
    J("rationale", 0, 0.9),
  ];
  const withLog = (promptLog: T1Artifact["promptLog"]): ScoreInputs<T1Artifact> => ({
    artifact: { ...goldenArtifact, promptLog },
    judgments,
    rubricVersion: "test-rubric-v1",
  });

  /** Same outcome, spend from nothing to a 400-entry spray. */
  const LOGS: ReadonlyArray<readonly [string, T1Artifact["promptLog"]]> = [
    ["no log at all", []],
    ["one prompt, no revision", [{ kind: "prompted", prompt: "build it", clientTs: "t" }]],
    [
      "two precise prompts — the efficient candidate the old formula docked",
      [
        { kind: "prompted", prompt: "single-column personal site, high contrast", clientTs: "t" },
        { kind: "revised", clientTs: "t" },
        { kind: "prompted", prompt: "add a contact footer", clientTs: "t" },
        { kind: "revised", clientTs: "t" },
      ],
    ],
    [
      "200 distinct prompts, each followed by a revision",
      Array.from({ length: 200 }, (_, i) => [
        { kind: "prompted" as const, prompt: `p${i}`, clientTs: "t" },
        { kind: "revised" as const, clientTs: "t" },
      ]).flat(),
    ],
  ];

  const baseline = runPure(() => scoreT1(withLog([]), cfg));

  for (const [name, promptLog] of LOGS) {
    it(`scores the same 'scaled' with ${name}`, () => {
      const s = runPure(() => scoreT1(withLog(promptLog), cfg));
      expect(s.scaled).toBe(baseline.scaled);
      // Every SCORED component identical too, not just the total.
      for (const key of ["functional", "comparative", "ambition", "rationale"]) {
        expect(s.raw[key], key).toBe(baseline.raw[key]);
      }
    });
  }

  /**
   * ...and the diagnostic still moves. An invariance test passes trivially if
   * the quantity stopped being computed, so this half proves the number is
   * still there and still discriminating between these logs.
   */
  it("still records a process.signal that varies with the log", () => {
    const signals = LOGS.map(([, log]) => runPure(() => scoreT1(withLog(log), cfg)).raw["process.signal"]);
    expect(signals).toEqual([0, 0.167, 0.667, 1]);
    expect(new Set(signals).size).toBe(LOGS.length);
  });
});
