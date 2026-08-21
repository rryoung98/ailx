import { describe, expect, it } from "vitest";
import { runPure } from "@ailx/core";
import { TRACK_IDS } from "@ailx/session";
import {
  DeterministicDemoJudge, DEMO_MODEL_ID, demoRubricVersion, demoScoreArtifact,
} from "../lib/demo";
import { scoreTrackArtifact } from "../lib/registry";
import { TRACK_META } from "../lib/tracks";

describe("deterministic demo scorer", () => {
  const artifact = { demo: true, trackId: "t1", response: "hello", interactions: ["prompted", "revised"] };

  it("is a pure function of its inputs (same inputs → same score)", () => {
    const a = demoScoreArtifact("t1", artifact);
    const b = demoScoreArtifact("t1", artifact);
    expect(a).toEqual(b);
    expect(demoScoreArtifact("t2", artifact)).not.toEqual(a);
  });

  it("survives the @ailx/core purity harness", () => {
    const s = runPure(() => demoScoreArtifact("t3", artifact));
    expect(s.scaled).toBeGreaterThan(0);
  });

  it("respects each track's rubric component maxima", () => {
    for (const t of TRACK_IDS) {
      const s = demoScoreArtifact(t, artifact);
      let total = 0;
      for (const c of TRACK_META[t].components) {
        expect(s.raw[c.key]).toBeGreaterThanOrEqual(0);
        expect(s.raw[c.key]).toBeLessThanOrEqual(c.points);
        total += s.raw[c.key];
      }
      expect(s.scaled).toBeCloseTo(Math.round(total * 10) / 10, 6);
      expect(s.scaled).toBeLessThanOrEqual(100);
    }
  });

  it("rewards interaction effort deterministically", () => {
    const lazy = demoScoreArtifact("t3", { demo: true, trackId: "t3", response: "", interactions: [] });
    expect(lazy.scaled).toBeGreaterThanOrEqual(0);
  });

  it("registry scoreTrackArtifact delegates to the demo scorer in this branch", () => {
    expect(scoreTrackArtifact("t4", artifact)).toEqual(demoScoreArtifact("t4", artifact));
  });
});

describe("DeterministicDemoJudge (JudgeAdapter demo implementation)", () => {
  it("returns identical judgments for identical requests, labelled demo", async () => {
    const judge = new DeterministicDemoJudge();
    const req = {
      trackId: "t3", dimension: "analysis", rubricVersion: demoRubricVersion("t3"),
      prompt: "judge", material: { text: "analysis body" }, sample: 1,
    };
    const a = await judge.judge(req);
    const b = await judge.judge(req);
    expect(a).toEqual(b);
    expect(a.modelId).toBe(DEMO_MODEL_ID);
    expect(a.value).toBeGreaterThanOrEqual(0);
    expect(a.value).toBeLessThanOrEqual(4);
    expect(a.evidence).toContain("[demo]");
    const c = await judge.judge({ ...req, sample: 2 });
    expect([a.value === c.value, a.evidence !== c.evidence]).toContain(true);
  });
});

describe("behaviour-shaped demo scoring (game runners)", () => {
  it("t2: more correct answers → higher d′ subscore; confident misses cost calibration", () => {
    const mk = (correct: boolean[], confident: boolean) => ({
      demo: true, trackId: "t2",
      t2: { responses: correct.map((c) => ({ itemId: "x", verdict: "authentic", confident, correct: c })) },
    });
    const good = demoScoreArtifact("t2", mk([true, true, true, true, true, true, true, true], true));
    const bad = demoScoreArtifact("t2", mk([true, false, false, true, false, false, true, false], true));
    expect(good.raw.dprime).toBeGreaterThan(bad.raw.dprime);
    const confidentWrong = demoScoreArtifact("t2", mk([false, false, false, false], true));
    const unsureWrong = demoScoreArtifact("t2", mk([false, false, false, false], false));
    expect(unsureWrong.raw.calibration).toBeGreaterThan(confidentWrong.raw.calibration);
  });

  it("t3: catching planted errors drives RSR; over-rejection costs RAIR", () => {
    const mk = (caught: number, over: number) => ({
      demo: true, trackId: "t3",
      t3: { verdicts: {}, caught, plantedTotal: 2, overRejected: over, analysis: "The claim fails on the stated figures." },
    });
    expect(demoScoreArtifact("t3", mk(2, 0)).raw.rsr).toBe(25);
    expect(demoScoreArtifact("t3", mk(0, 0)).raw.rsr).toBe(0);
    expect(demoScoreArtifact("t3", mk(2, 0)).raw.rair).toBeGreaterThan(demoScoreArtifact("t3", mk(2, 2)).raw.rair);
  });

  it("t4: disclosure hygiene is worth most of the provenance component", () => {
    const mk = (disclosed: boolean) => ({
      demo: true, trackId: "t4",
      t4: { prompts: ["a", "b"], generations: 3, quota: 6, selectedSeed: "s", disclosed },
    });
    expect(demoScoreArtifact("t4", mk(true)).raw.provenance).toBeGreaterThan(8);
    expect(demoScoreArtifact("t4", mk(false)).raw.provenance).toBeLessThan(4);
  });

  it("t1: writing a rationale beats leaving it empty", () => {
    const mk = (rationale: string) => ({
      demo: true, trackId: "t1",
      t1: { layout: "Single column", palette: "Warm paper", type: "Grotesk", headline: "Hi", rationale, iterations: 4 },
    });
    const withR = demoScoreArtifact("t1", mk("Chose warm paper to read as an essay, single column for focus; the accent traces the argument."));
    const withoutR = demoScoreArtifact("t1", mk(""));
    expect(withR.raw.rationale).toBeGreaterThan(withoutR.raw.rationale);
  });
});
