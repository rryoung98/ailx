import { describe, expect, it } from "vitest";
import {
  DeterministicDemoJudge, DEMO_MODEL_ID, demoRubricVersion,
} from "../lib/demo";

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
    expect(a.evidence).toContain("[demo]");
    const c = await judge.judge({ ...req, sample: 2 });
    expect([a.value === c.value, a.evidence !== c.evidence]).toContain(true);
  });

  it("emits values NORMALIZED to [0,1] per the core JudgeResponse contract", async () => {
    const judge = new DeterministicDemoJudge();
    for (let sample = 0; sample < 20; sample++) {
      const r = await judge.judge({
        trackId: "t1", dimension: "comparative", rubricVersion: demoRubricVersion("t1"),
        prompt: "judge", material: { html: `<p>${sample}</p>` }, sample,
      });
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThanOrEqual(1);
    }
  });
});
