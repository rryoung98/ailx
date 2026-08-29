import { describe, expect, it } from "vitest";
import { runPure } from "@ailx/core";
import { demoCohort } from "@ailx/session";
import {
  DeterministicDemoJudge, DEMO_COHORT_SEED, DEMO_COHORT_SIZE, DEMO_MODEL_ID,
  demoCohortRows, demoRubricVersion,
} from "../src/demo.js";

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

describe("demoCohortRows (the cached demo cohort)", () => {
  it("is exactly demoCohort(SEED, SIZE) — caching changed no number", () => {
    expect(demoCohortRows()).toEqual(demoCohort(DEMO_COHORT_SEED, DEMO_COHORT_SIZE));
    expect(demoCohortRows()).toHaveLength(DEMO_COHORT_SIZE);
  });

  it("hands back the same rows on every call, byte-identically", () => {
    const a = demoCohortRows();
    const b = demoCohortRows();
    expect(b).toBe(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("is frozen, so a caller cannot poison the next reader", () => {
    const rows = demoCohortRows();
    expect(Object.isFrozen(rows)).toBe(true);
    expect(rows.every((r) => Object.isFrozen(r))).toBe(true);
    // Non-strict callers get a silent no-op instead of drift; assert the value.
    expect(() => {
      (rows as unknown as { push: (r: unknown) => void }).push({ t1: 0, t2: 0, t3: 0, t4: 0 });
    }).toThrow();
    expect(demoCohortRows()).toEqual(demoCohort(DEMO_COHORT_SEED, DEMO_COHORT_SIZE));
  });

  it("is pure — no clock, no randomness, no network, and reusable under runPure", () => {
    expect(runPure(() => JSON.stringify(demoCohortRows()))).toBe(
      runPure(() => JSON.stringify(demoCohortRows())),
    );
  });
});
