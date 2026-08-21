import { describe, it, expect } from "vitest";
import {
  generateImage,
  readPrompt,
  svgDataUrl,
  simulateVideo,
  COLOR_VOCAB,
} from "../src/imageModel.js";
import { sha256Hex } from "../src/sha256.js";
import { t4Plugin } from "../src/plugin.js";
import type { TrackCtx } from "@ailx/core";

describe("sha256 (pure TS, client-safe)", () => {
  it("matches known vectors", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("demo image model — deterministic, prompt-steered", () => {
  it("same prompt, same image", () => {
    expect(generateImage("a red boat at dawn")).toBe(generateImage("a red boat at dawn"));
  });
  it("different prompts, different images", () => {
    expect(generateImage("a red boat")).not.toBe(generateImage("a blue tower"));
  });
  it("named colors steer the palette", () => {
    expect(generateImage("a crimson sun")).toContain(COLOR_VOCAB.crimson);
    expect(generateImage("a teal wave")).toContain(COLOR_VOCAB.teal);
  });
  it("named objects appear (via extraction)", () => {
    const r = readPrompt("three boats under a gold star near the mountain");
    expect(r.objects).toEqual(expect.arrayContaining(["boat", "star", "mountain"]));
    expect(r.colors).toContain(COLOR_VOCAB.gold);
  });
  it("composition and mood words steer the scene", () => {
    const r = readPrompt("a calm centered moon");
    expect(r.composition).toBe("centered");
    expect(r.mood).toBe("calm");
    // night sky gradient differs from storm
    expect(generateImage("night city")).not.toBe(generateImage("storm city"));
  });
  it("emits valid standalone SVG with the prompt as title, escaped", () => {
    const svg = generateImage('x <script>"&');
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });
  it("svgDataUrl produces an image data url", () => {
    expect(svgDataUrl("<svg/>")).toBe("data:image/svg+xml;utf8,%3Csvg%2F%3E");
  });
  it("simulateVideo produces labeled, animated SVG markup deterministically (F9)", () => {
    const draft = generateImage("three boats in a storm");
    const video = simulateVideo(draft);
    expect(video).toContain("<animate");
    expect(video).toContain("VIDEO · simulated");
    expect(video.endsWith("</svg>")).toBe(true);
    expect(simulateVideo(draft)).toBe(video);
  });
});

const ctx: TrackCtx = {
  attemptId: "a-1",
  trackId: "t4-generative",
  locale: "en",
  emit: async () => {},
};

describe("t4Plugin", () => {
  it("has the contract identity", () => {
    expect(t4Plugin.id).toBe("t4-generative");
    expect(t4Plugin.apiVersion).toBe(2);
  });
  it("validateConfig defaults to the spec quota: 3 final images + 1 video (F9)", () => {
    const cfg = t4Plugin.validateConfig(undefined);
    expect(cfg.finalImageQuota).toBe(3);
    expect(cfg.finalVideoQuota).toBe(1);
    expect(() => t4Plugin.validateConfig([])).toThrow();
    expect(() => t4Plugin.validateConfig({ finalImageQuota: 0 })).toThrow();
    expect(() => t4Plugin.validateConfig({ finalImageQuota: 2.5 })).toThrow();
    expect(() => t4Plugin.validateConfig({ finalVideoQuota: -1 })).toThrow();
    expect(t4Plugin.validateConfig({ finalImageQuota: 2 }).finalImageQuota).toBe(2);
    // Legacy keys are ignored, not fatal.
    expect(t4Plugin.validateConfig({ maxGenerations: 6 }).finalImageQuota).toBe(3);
  });
  it("ingest is idempotent, validates the deliverable structure (F9)", async () => {
    const cfg = t4Plugin.validateConfig({});
    const s = await t4Plugin.startSession(ctx, cfg);
    const drafts = [
      { index: 0, prompt: "p0", svg: "<svg/>", clientTs: "t" },
      { index: 1, prompt: "p1", svg: "<svg/>", clientTs: "t" },
    ];
    const final = (kind: "image" | "video", fromDraftIndex: number) => ({
      kind, fromDraftIndex, prompt: "p", asset: "<svg/>", clientTs: "t",
    });
    const payload = {
      kind: "t4-artifact",
      json: {
        drafts,
        finals: { images: [final("image", 1)], video: final("video", 1) },
        chosenSet: [0, 99], // out-of-range entries dropped
        note: "n",
        disclosed: true,
      },
    };
    const a1 = await t4Plugin.ingest(ctx, s, payload);
    const a2 = await t4Plugin.ingest(ctx, s, payload);
    expect(a1).toEqual(a2);
    expect(a1.chosenSet).toEqual([0]);
    expect(a1.disclosed).toBe(true);
    expect(a1.finals.video?.kind).toBe("video");
    await expect(
      t4Plugin.ingest(ctx, s, { kind: "t4-artifact", json: { drafts: [] } }),
    ).rejects.toThrow();
  });
  it("ingest enforces the HARD final-image quota", async () => {
    const cfg = t4Plugin.validateConfig({});
    const s = await t4Plugin.startSession(ctx, cfg);
    const drafts = [{ index: 0, prompt: "p0", svg: "<svg/>", clientTs: "t" }];
    const img = { kind: "image", fromDraftIndex: 0, prompt: "p", asset: "<svg/>", clientTs: "t" };
    await expect(
      t4Plugin.ingest(ctx, s, {
        kind: "t4-artifact",
        json: { drafts, finals: { images: [img, img, img, img] }, note: "" },
      }),
    ).rejects.toThrow(/quota/);
  });
  it("exposes a lazy ui() loader resolving to the Runner (F11)", async () => {
    expect(typeof t4Plugin.ui).toBe("function");
    const mod = await t4Plugin.ui!();
    expect(typeof mod.Runner).toBe("function");
  });
  it("pipeline declares safety, judging, human CJ and aggregate stages", () => {
    const ids = t4Plugin.pipeline(t4Plugin.validateConfig({})).map((s) => s.id);
    expect(ids).toContain("safety-pass");
    expect(ids).toContain("judge-t4-generations");
    expect(ids).toContain("pairwise-comparative");
    expect(ids[ids.length - 1]).toBe("aggregate");
  });
});
