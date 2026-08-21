import { describe, expect, it } from "vitest";
import { assistantReply } from "../src/assistant.js";
import { DemoJudge } from "../src/judge.js";
import { seededIndex, sha256Hex } from "../src/sha256.js";
import { config } from "./fixtures.js";

describe("sha256 (pure, browser-safe)", () => {
  it("matches known vectors", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
  it("seededIndex is stable and bounded", () => {
    expect(seededIndex("seed", 7)).toBe(seededIndex("seed", 7));
    for (let i = 0; i < 20; i++) {
      const v = seededIndex(`s${i}`, 4);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(4);
    }
  });
});

describe("demo assistant (deterministic simulator)", () => {
  const none = new Set<string>();

  it("same inputs produce the identical reply", () => {
    const a = assistantReply(config, "Tell me about the queue wait median.", 1, none);
    const b = assistantReply(config, "Tell me about the queue wait median.", 1, none);
    expect(a).toEqual(b);
  });

  it("surfaces a planted error on topic match", () => {
    const r = assistantReply(config, "What is the median queue wait?", 1, none);
    expect(r.claimIds).toContain("pe-figure");
    expect(r.text).toContain("61 months");
  });

  it("surfaces correct advice on topic match", () => {
    const r = assistantReply(config, "How much did cluster study time improve?", 1, none);
    expect(r.claimIds).toContain("ca-cluster");
  });

  it("plants on the fixed schedule even without a topic match", () => {
    const r = assistantReply(config, "hello there", 2, none);
    expect(r.claimIds.some((id) => id.startsWith("pe-"))).toBe(true);
  });

  it("never re-surfaces an already-surfaced claim", () => {
    const surfaced = new Set(["pe-figure"]);
    const r = assistantReply(config, "What is the median queue wait?", 3, surfaced);
    expect(r.claimIds).not.toContain("pe-figure");
  });

  it("regeneration varies the nonce, not the planted schedule", () => {
    const a = assistantReply(config, "What is the median queue wait?", 1, none, 0);
    const b = assistantReply(config, "What is the median queue wait?", 1, none, 1);
    expect(b.claimIds).toEqual(a.claimIds);
    const b2 = assistantReply(config, "What is the median queue wait?", 1, none, 1);
    expect(b2).toEqual(b);
  });
});

describe("DemoJudge (deterministic JudgeAdapter)", () => {
  const req = {
    trackId: "t3-reasoning",
    dimension: "analysis",
    rubricVersion: "rv-test",
    prompt: "score this",
    material: "A substantial analysis ".repeat(40),
    sample: 0,
  };

  it("is deterministic per request", async () => {
    const j = new DemoJudge();
    expect(await j.judge(req)).toEqual(await j.judge(req));
  });

  it("returns NORMALIZED values in [0,1] (band/5) and demo-labeled evidence", async () => {
    const j = new DemoJudge();
    for (let sample = 0; sample < 3; sample++) {
      const r = await j.judge({ ...req, sample });
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThanOrEqual(1);
      // Bands are integers 0..5, so the normalized value is a multiple of 0.2.
      expect(Number.isInteger(r.value * 5)).toBe(true);
      expect(r.evidence).toContain("[DEMO]");
      expect(r.modelId).toMatch(/^demo-judge-[123]@1$/);
    }
  });
});
