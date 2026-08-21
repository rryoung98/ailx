import { describe, it, expect } from "vitest";
import { runPure } from "@ailx/core";
import { validateT2Config } from "@ailx/track-t2";
import { validateT3Config } from "@ailx/track-t3";
import { trackConfig, t2Items } from "../lib/instrument";
import { judgeT1, judgeT3, judgeT4 } from "../lib/judging";
import { scoreTrackArtifact } from "../lib/registry";

describe("instrument wiring", () => {
  it("t2 bank adapts into a valid T2Config", () => {
    const cfg = validateT2Config(trackConfig("t2"));
    expect(cfg.items.length).toBeGreaterThanOrEqual(10);
    for (const i of cfg.items) {
      expect(i.id).toMatch(/^[0-9a-f]{64}$/);
      expect(i.key).toBeGreaterThanOrEqual(0);
    }
  });
  it("t2 deck mixes binary and provenance items", () => {
    const items = t2Items("en");
    expect(items.some((i) => i.type === "provenance")).toBe(true);
    expect(items.some((i) => i.type !== "provenance")).toBe(true);
  });
  it("t3 scenario validates", () => {
    const cfg = validateT3Config(trackConfig("t3"));
    expect(cfg.plantedErrors.length).toBe(3);
  });
});

describe("demo judging + real plugin scoring", () => {
  const t1Artifact = {
    html: "<html><style>h1{color:red}</style><header><h1>Hi</h1></header><main><section>x</section></main></html>",
    promptLog: [{ kind: "prompted" }, { kind: "revised" }],
    selfReport: "I aimed for a clean landing structure with semantic landmarks and contrast.",
  };
  it("judgments are deterministic", () => {
    expect(judgeT1(t1Artifact)).toEqual(judgeT1(t1Artifact));
    const t3a = { transcript: [], finalAnswer: "word ".repeat(150) };
    expect(judgeT3(t3a)).toEqual(judgeT3(t3a));
    const t4a = { generations: [{ prompt: "a red fox at dawn, watercolor, wide" }], chosenIndex: 0, note: "note" };
    expect(judgeT4(t4a)).toEqual(judgeT4(t4a));
  });
  it("scoreTrackArtifact is pure and reproducible for every track", () => {
    const artifacts: Record<string, unknown> = {
      t1: t1Artifact,
      t2: { responses: t2Items("en").map((i, idx) => ({ itemId: i.id, choice: idx % 2 === 0 ? i.key : (i.key + 1) % i.options.length, confidence: 70, latencyMs: 1200 })) },
      t3: { transcript: [{ seq: 0, clientTs: "t", verb: "prompted", object: "prompt:1", text: "x" }], finalAnswer: "word ".repeat(140) },
      t4: { generations: [{ prompt: "red fox" }, { prompt: "a red fox at dawn, watercolor, wide composition" }], chosenIndex: 1, note: "The dawn palette communicates warmth for the brief audience." },
    };
    for (const t of ["t1", "t2", "t3", "t4"] as const) {
      const a = runPure(() => scoreTrackArtifact(t, artifacts[t]));
      const b = runPure(() => scoreTrackArtifact(t, artifacts[t]));
      expect(a).toEqual(b);
      expect(a.scaled).toBeGreaterThan(0);
      expect(a.scaled).toBeLessThanOrEqual(100);
    }
  });
  it("malformed artifacts fall back instead of throwing", () => {
    const s = scoreTrackArtifact("t1", { timedOut: true });
    expect(typeof s.scaled).toBe("number");
  });
});
