import { describe, it, expect } from "vitest";
import { runPure, judgmentArrivalOrders, SCORE_ALLOCATION, SCORED_TRACK_IDS, TOTAL_POINTS, trackPoints } from "@ailx/core";
import type { Judgment, ScoreInputs } from "@ailx/core";
import {
  scoreT4,
  T4_SHOWCASE_WEIGHTS,
  medianForDimension,
  steeringEfficiency,
  quotaEfficiency,
  generationSeries,
  promotedDraftIndex,
} from "../src/score.js";
import { t4Plugin } from "../src/plugin.js";
import type { T4Artifact, T4Draft, T4Final } from "../src/types.js";

const cfg = t4Plugin.validateConfig({});

const J = (dimension: string, sample: number, value: number): Judgment => ({
  dimension,
  sample,
  value,
  modelId: "demo-judge@1",
});

const D = (index: number, prompt: string): T4Draft => ({
  index,
  prompt,
  svg: "<svg/>",
  clientTs: `t${index}`,
});

const FI = (fromDraftIndex: number): T4Final => ({
  kind: "image",
  fromDraftIndex,
  prompt: `p${fromDraftIndex}`,
  asset: "<svg/>",
  clientTs: "tf",
});

const FV = (fromDraftIndex: number): T4Final => ({
  kind: "video",
  fromDraftIndex,
  prompt: `p${fromDraftIndex}`,
  asset: "<svg>video</svg>",
  clientTs: "tf",
});

/** Spec §T4 deliverable structure: unlimited drafts, 3 final images + 1 video. */
const goldenArtifact: T4Artifact = {
  drafts: [
    D(0, "a boat"),
    D(1, "three boats on a wave"),
    D(2, "three boats, storm"),
    D(3, "three boats on a storm wave, gold star, centered"),
  ],
  finals: {
    images: [FI(1), FI(2), FI(3)],
    video: FV(3),
  },
  chosenSet: [0, 1, 2],
  note: "Iterated toward the storm reading; the star anchors hope.",
  disclosed: true,
};

const goldenJudgments: Judgment[] = [
  J("brief-fit", 0, 0.8),
  J("brief-fit", 1, 0.7),
  J("brief-fit", 2, 0.9),
  J("comparative", 0, 0.55),
  J("provenance", 0, 1.0),
  J("direction-note", 0, 0.6),
  // per-draft judge values, sample = draft index (order scrambled
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

describe("scoreT4 golden fixture (F9 deliverable model)", () => {
  it("matches the spec allocation exactly (30/40/20/10)", () => {
    const s = runPure(() => scoreT4(goldenInputs, cfg));
    expect(s.raw["brief-fit"]).toBe(24);
    expect(s.raw.comparative).toBe(22);
    expect(s.raw.craft).toBe(13.695);
    expect(s.raw.provenance).toBe(10);
    expect(s.raw["craft.steering"]).toBe(0.61);
    expect(s.raw["craft.quota"]).toBe(1); // full quota delivered: 3 images + video
    expect(s.raw["finals.images"]).toBe(3);
    expect(s.raw["finals.video"]).toBe(1);
    expect(s.raw["drafts.count"]).toBe(4);
    expect(s.scaled).toBe(69.695);
  });

  it("is deterministic under runPure", () => {
    const a = runPure(() => scoreT4(goldenInputs, cfg));
    const b = runPure(() => scoreT4(goldenInputs, cfg));
    expect(a).toEqual(b);
  });

  it("no judgments scores only the quota process component", () => {
    const s = runPure(() => scoreT4({ ...goldenInputs, judgments: [] }, cfg));
    // craft = 0.5*0 + 0.3*0 + 0.2*1 = 0.2 -> 4 pts; everything else 0.
    expect(s.scaled).toBe(4);
  });

  it("an incomplete final set earns proportionally less quota credit", () => {
    const partial: T4Artifact = {
      ...goldenArtifact,
      finals: { images: [FI(3)] }, // 1 of 3 images, no video
      chosenSet: [0],
    };
    const s = runPure(() => scoreT4({ ...goldenInputs, artifact: partial }, cfg));
    expect(s.raw["craft.quota"]).toBe(0.25); // 1 delivered of 4 quota slots
    expect(s.raw["finals.video"]).toBe(0);
  });
});

describe("medianForDimension (F10 validation)", () => {
  it("takes the median of samples", () => {
    expect(medianForDimension([J("d", 0, 0.2), J("d", 1, 1), J("d", 2, 0.4)], "d")).toBe(0.4);
    expect(medianForDimension([], "d")).toBe(0);
  });
  it("throws on out-of-range judgment values instead of clamping to full credit", () => {
    expect(() => medianForDimension([J("d", 0, 5)], "d")).toThrow(/out of range/);
    expect(() => medianForDimension([J("d", 0, -0.1)], "d")).toThrow(/out of range/);
    expect(() => medianForDimension([J("d", 0, Number.NaN)], "d")).toThrow(/out of range/);
    expect(() =>
      scoreT4({ ...goldenInputs, judgments: [J("brief-fit", 0, 4)] }, cfg),
    ).toThrow(/out of range/);
  });
});

describe("steeringEfficiency (over the DRAFT series)", () => {
  it("is 0 without at least two drafts", () => {
    expect(steeringEfficiency([], 0)).toBe(0);
    expect(steeringEfficiency([0.9], 0)).toBe(0);
  });
  it("rewards monotonic diagnostic improvement toward the promoted draft", () => {
    expect(steeringEfficiency([0.2, 0.5, 0.8, 1.0], 3)).toBe(1);
  });
  it("penalizes random iteration that ends where it started", () => {
    expect(steeringEfficiency([0.5, 0.3, 0.5], 2)).toBeCloseTo(0, 5);
  });
  it("handles a perfect first draft without dividing by zero", () => {
    expect(steeringEfficiency([1, 1], 1)).toBeCloseTo(0.6);
  });
});

describe("quotaEfficiency (F9: over FINALS, not drafts)", () => {
  const q = { finalImageQuota: 3, finalVideoQuota: 1 };
  it("is the delivered fraction of the hard final quota", () => {
    expect(quotaEfficiency({ images: [] }, q)).toBe(0);
    expect(quotaEfficiency({ images: [FI(0)] }, q)).toBe(0.25);
    expect(quotaEfficiency({ images: [FI(0), FI(1), FI(2)] }, q)).toBe(0.75);
    expect(quotaEfficiency({ images: [FI(0), FI(1), FI(2)], video: FV(2) }, q)).toBe(1);
  });
  it("never exceeds 1 and respects a zero video quota", () => {
    expect(
      quotaEfficiency({ images: [FI(0), FI(1), FI(2)], video: FV(0) }, { finalImageQuota: 3, finalVideoQuota: 0 }),
    ).toBe(1);
  });
});

describe("generationSeries", () => {
  it("sorts stored per-draft judgments by sample index", () => {
    expect(generationSeries(goldenJudgments)).toEqual([0.3, 0.5, 0.45, 0.7]);
  });
  it("throws on out-of-range values (F10)", () => {
    expect(() => generationSeries([J("generation", 0, 2)])).toThrow(/out of range/);
  });
});

describe("promotedDraftIndex", () => {
  it("reads the latest draft promoted into the chosen set or video", () => {
    expect(promotedDraftIndex(goldenArtifact)).toBe(3);
    const noFinals: T4Artifact = { ...goldenArtifact, finals: { images: [] }, chosenSet: [] };
    expect(promotedDraftIndex(noFinals)).toBe(goldenArtifact.drafts.length - 1);
  });
});

/**
 * T4 is an unscored SHOWCASE track. These assertions are the whole of that
 * claim, and they belong next to the function that would otherwise look like
 * a scorer.
 */
describe("T4 is a showcase index, not a score", () => {
  it("is declared unscored, with zero points and zero composite weight", () => {
    expect(SCORE_ALLOCATION.t4.scored).toBe(false);
    expect(trackPoints("t4")).toBe(0);
    expect(SCORE_ALLOCATION.t4.compositeWeight).toBe(0);
    expect(SCORE_ALLOCATION.t4.components).toEqual([]);
  });

  it("is absent from the scored track list", () => {
    expect(SCORED_TRACK_IDS).not.toContain("t4");
  });

  it("keeps its own local proportions, summing to a 0-100 index", () => {
    const sum = Object.values(T4_SHOWCASE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it("cannot contribute a point to the 375-point instrument", () => {
    const scored = (["t1", "t2", "t3", "t4"] as const)
      .filter((t) => SCORE_ALLOCATION[t].scored)
      .reduce((a, t) => a + trackPoints(t), 0);
    expect(scored).toBe(TOTAL_POINTS);
    expect(TOTAL_POINTS).toBe(375);
  });
});

/**
 * ORDER INVARIANCE — stored judgments come back from a database, and a read
 * without ORDER BY has no guaranteed row order. The showcase index must not
 * move by one bit under a permuted read. Two places were exposed: the medians
 * (aggregation) and the generation SERIES, which is read positionally and
 * used to sort by `sample` alone — so two rows sharing a sample tie-broke by
 * arrival order.
 */
describe("scoreT4 is order-invariant over stored judgment rows", () => {
  const canonical = (s: unknown) => JSON.stringify(s);

  it("gives byte-identical output for many arrival orders of the golden rows", () => {
    const expected = canonical(runPure(() => scoreT4(goldenInputs, cfg)));
    // 10 golden rows is 3.6M permutations; enumerate over a 6-row slice and
    // check the remaining rows by rotation, which is enough to catch an
    // arrival-order dependency without a factorial test run.
    const head = goldenJudgments.slice(0, 6);
    const tail = goldenJudgments.slice(6);
    for (const order of judgmentArrivalOrders(head)) {
      expect(
        canonical(runPure(() => scoreT4({ ...goldenInputs, judgments: [...order, ...tail] }, cfg))),
      ).toBe(expected);
    }
    for (let i = 0; i < goldenJudgments.length; i++) {
      const rotated = [...goldenJudgments.slice(i), ...goldenJudgments.slice(0, i)];
      expect(
        canonical(runPure(() => scoreT4({ ...goldenInputs, judgments: rotated }, cfg))),
      ).toBe(expected);
    }
    expect(
      canonical(runPure(() => scoreT4({ ...goldenInputs, judgments: [...goldenJudgments].reverse() }, cfg))),
    ).toBe(expected);
  });

  /** Known-sharp values: proven to diverge under a naive left-to-right sum. */
  it("gives byte-identical output on values that DO diverge under naive summation", () => {
    const sharp = [0.1, 0.2, 0.30000000000000004];
    expect(sharp.reduce((a, b) => a + b, 0)).not.toBe(
      [...sharp].reverse().reduce((a, b) => a + b, 0),
    );
    const rows = [
      J("brief-fit", 0, sharp[0]), J("brief-fit", 1, sharp[1]),
      J("comparative", 0, sharp[2]), J("comparative", 1, sharp[0]),
      J("generation", 0, sharp[1]), J("generation", 1, sharp[2]),
    ];
    const expected = canonical(
      runPure(() => scoreT4({ ...goldenInputs, judgments: rows }, cfg)),
    );
    for (const order of judgmentArrivalOrders(rows)) {
      expect(
        canonical(runPure(() => scoreT4({ ...goldenInputs, judgments: order }, cfg))),
      ).toBe(expected);
    }
  });

  it("generationSeries: rows sharing a sample do not tie-break by arrival", () => {
    const dup: Judgment[] = [
      { dimension: "generation", sample: 0, value: 0.3, modelId: "judge-a@1" },
      { dimension: "generation", sample: 1, value: 0.9, modelId: "judge-b@1" },
      { dimension: "generation", sample: 1, value: 0.2, modelId: "judge-a@1" },
    ];
    // Canonical order is (sample, modelId, value): 0.3, then a@1's 0.2, then b@1's 0.9.
    expect(generationSeries(dup)).toEqual([0.3, 0.2, 0.9]);
    expect(generationSeries([...dup].reverse())).toEqual([0.3, 0.2, 0.9]);
    for (const order of judgmentArrivalOrders(dup)) {
      expect(generationSeries(order)).toEqual([0.3, 0.2, 0.9]);
    }
  });

  /**
   * The duplicate pair is 0.4/0.5 on purpose: `steeringEfficiency` counts
   * steps that improved on the running best, so [0.3, 0.4, 0.5, 0.6] scores
   * three improving steps and the swapped [0.3, 0.5, 0.4, 0.6] scores two.
   * A stable sort by `sample` alone leaves that difference decided by
   * arrival order — i.e. by the database.
   */
  it("a duplicate-sample series scores the same whichever way the rows arrive", () => {
    const dup: Judgment[] = [
      { dimension: "generation", sample: 0, value: 0.3, modelId: "judge-a@1" },
      { dimension: "generation", sample: 1, value: 0.5, modelId: "judge-b@1" },
      { dimension: "generation", sample: 1, value: 0.4, modelId: "judge-a@1" },
      { dimension: "generation", sample: 2, value: 0.6, modelId: "judge-a@1" },
    ];
    expect(generationSeries(dup)).toEqual([0.3, 0.4, 0.5, 0.6]);
    const forward = runPure(() => scoreT4({ ...goldenInputs, judgments: dup }, cfg));
    const backward = runPure(() =>
      scoreT4({ ...goldenInputs, judgments: [...dup].reverse() }, cfg),
    );
    expect(JSON.stringify(forward)).toBe(JSON.stringify(backward));
    // 0.6 × gain(0.3→0.6 of 0.7 headroom) + 0.4 × 3 improving steps of 3.
    expect(forward.raw["craft.steering"]).toBe(
      Math.round((0.6 * (0.3 / 0.7) + 0.4) * 1000) / 1000,
    );
  });

  it("never lets a stored -0 leak into the index as -0", () => {
    const s = runPure(() =>
      scoreT4({ ...goldenInputs, judgments: [J("brief-fit", 0, -0)] }, cfg),
    );
    expect(Object.is(s.raw["brief-fit"], 0)).toBe(true);
  });
});
