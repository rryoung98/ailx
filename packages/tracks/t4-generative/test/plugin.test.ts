import { describe, it, expect } from "vitest";
import {
  generateImage,
  readPrompt,
  svgDataUrl,
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
  it("validateConfig applies defaults and rejects junk", () => {
    const cfg = t4Plugin.validateConfig(undefined);
    expect(cfg.maxGenerations).toBe(6);
    expect(() => t4Plugin.validateConfig([])).toThrow();
    expect(() => t4Plugin.validateConfig({ maxGenerations: 0 })).toThrow();
    expect(() => t4Plugin.validateConfig({ maxGenerations: 2.5 })).toThrow();
    expect(t4Plugin.validateConfig({ maxGenerations: 3 }).maxGenerations).toBe(3);
  });
  it("ingest is idempotent, validates generations, defaults chosenIndex", async () => {
    const cfg = t4Plugin.validateConfig({});
    const s = await t4Plugin.startSession(ctx, cfg);
    const payload = {
      kind: "t4-artifact",
      json: {
        generations: [
          { index: 0, prompt: "p0", svg: "<svg/>", clientTs: "t" },
          { index: 1, prompt: "p1", svg: "<svg/>", clientTs: "t" },
        ],
        chosenIndex: 99, // out of range -> defaults to last
        note: "n",
      },
    };
    const a1 = await t4Plugin.ingest(ctx, s, payload);
    const a2 = await t4Plugin.ingest(ctx, s, payload);
    expect(a1).toEqual(a2);
    expect(a1.chosenIndex).toBe(1);
    await expect(
      t4Plugin.ingest(ctx, s, { kind: "t4-artifact", json: { generations: [] } }),
    ).rejects.toThrow();
  });
  it("pipeline declares safety, judging, human CJ and aggregate stages", () => {
    const ids = t4Plugin.pipeline(t4Plugin.validateConfig({})).map((s) => s.id);
    expect(ids).toContain("safety-pass");
    expect(ids).toContain("judge-t4-generations");
    expect(ids).toContain("pairwise-comparative");
    expect(ids[ids.length - 1]).toBe("aggregate");
  });
});
