/**
 * The demo judge is a stand-in, and the product must say so wherever its
 * numbers surface (F2/F14), and must not pay points for work that was never
 * done (F9). Both are honesty properties, so both are pinned here.
 */
import { describe, expect, it } from "vitest";
import { runPure } from "@ailx/core";
import type { Judgment } from "@ailx/core";
import {
  DEMO_JUDGE_EVIDENCE, DEMO_SCORE_NOTE, DEMO_SCORE_QUALIFIER, DeterministicDemoJudge,
  formatTrackScore, isDemoJudgment, isDemoScored, judgeT1, judgeT3, judgeT4,
} from "../src/index.js";

const t1 = { html: "<main><h1>hi</h1></main>", promptLog: [], selfReport: "why" };
const t3 = { transcript: [], finalAnswer: "an analysis" };
const t4 = {
  drafts: [{ prompt: "a red fox at dawn, watercolor" }],
  finals: { images: [{ prompt: "a red fox at dawn, watercolor", fromDraftIndex: 0 }] },
  chosenSet: [0],
  note: "the dawn palette carries the brief",
  disclosed: true,
};
const median = (js: readonly Judgment[], dim: string) => {
  const v = js.filter((j) => j.dimension === dim).map((j) => j.value).sort((a, b) => a - b);
  return v.length % 2 === 1 ? v[Math.floor(v.length / 2)] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};

describe("demo provenance is stamped on every row", () => {
  const all = [
    ...judgeT1(t1), ...judgeT3(t3), ...judgeT4(t4),
    // The empty/zero paths must be marked too — a zero is a demo zero.
    ...judgeT1({ html: "", promptLog: [], selfReport: "" }),
    ...judgeT3({ transcript: [], finalAnswer: "" }),
    ...judgeT4({ ...t4, drafts: [] }),
  ];

  it("marks every emitted judgment as demo evidence", () => {
    expect(all.length).toBeGreaterThan(0);
    for (const j of all) {
      expect(j.evidence).toBe(DEMO_JUDGE_EVIDENCE);
      expect(isDemoJudgment(j)).toBe(true);
    }
  });

  it("recognises the DeterministicDemoJudge marker too (different casing)", async () => {
    const r = await new DeterministicDemoJudge().judge({
      trackId: "t1", dimension: "comparative", rubricVersion: "v", material: "x", sample: 0,
    });
    expect(isDemoJudgment(r)).toBe(true);
  });

  it("does not mark a judgment that carries real evidence", () => {
    expect(isDemoJudgment({ evidence: "cited §3.2 of the source" })).toBe(false);
    expect(isDemoJudgment({})).toBe(false);
    expect(isDemoScored([{ evidence: "cited §3.2" }])).toBe(false);
    // A model-free track (T2) stores no judgments and is honestly measured.
    expect(isDemoScored([])).toBe(false);
    expect(isDemoScored(undefined)).toBe(false);
    expect(isDemoScored(judgeT1(t1))).toBe(true);
  });
});

describe("formatTrackScore — no number renders without its provenance", () => {
  it("qualifies a demo-judged score everywhere it is printed", () => {
    const s = formatTrackScore({ scaled: 87.94 }, judgeT1(t1));
    expect(s).toBe(`87.9 / 100 · ${DEMO_SCORE_QUALIFIER}`);
    expect(s).toContain(DEMO_SCORE_QUALIFIER);
  });

  it("leaves a measured score unqualified", () => {
    expect(formatTrackScore({ scaled: 6.7 }, [])).toBe("6.7 / 100");
  });

  it("prefers honest absence to a placeholder number", () => {
    expect(formatTrackScore(undefined, judgeT1(t1))).toBe("recorded, not scored");
    expect(formatTrackScore({ scaled: Number.NaN }, [])).toBe("recorded, not scored");
  });

  it("never prints a bare demo number, at any value", () => {
    for (const scaled of [0, 0.04, 12.5, 87.94, 100]) {
      expect(formatTrackScore({ scaled }, judgeT4(t4))).toContain(DEMO_SCORE_QUALIFIER);
    }
    expect(DEMO_SCORE_NOTE).toContain("not a judged result");
  });

  it("is pure", () => {
    expect(runPure(() => formatTrackScore({ scaled: 1 }, judgeT1(t1)))).toBe(
      formatTrackScore({ scaled: 1 }, judgeT1(t1)),
    );
  });
});

describe("an optional written component judges to zero when it is blank (F9)", () => {
  // Both runners tell the candidate "that component then scores zero".
  it("T4: an empty or whitespace-only direction note is a literal zero on every sample", () => {
    for (const note of ["", "   ", "\n\t "]) {
      const rows = judgeT4({ ...t4, note }).filter((j) => j.dimension === "direction-note");
      expect(rows).toHaveLength(3);
      for (const j of rows) expect(j.value).toBe(0);
    }
  });

  it("T1: an empty design rationale is a literal zero on every sample", () => {
    for (const selfReport of ["", "  \n "]) {
      const rows = judgeT1({ ...t1, selfReport }).filter((j) => j.dimension === "rationale");
      expect(rows).toHaveLength(3);
      for (const j of rows) expect(j.value).toBe(0);
    }
  });

  it("still pays a written note, and pays a longer one more", () => {
    const short = median(judgeT4({ ...t4, note: "warm palette" }), "direction-note");
    const long = median(judgeT4({ ...t4, note: "w".repeat(300) }), "direction-note");
    expect(short).toBeGreaterThan(0);
    expect(long).toBeGreaterThan(short);
  });

  it("leaves the other dimensions untouched when the note is blank", () => {
    const blank = judgeT4({ ...t4, note: "" });
    expect(median(blank, "provenance")).toBeGreaterThan(0.5);
    expect(median(blank, "brief-fit")).toBeGreaterThan(0);
  });
});
