import { describe, it, expect } from "vitest";
import { buildPreviewSrcdoc, PREVIEW_CSP, SANDBOX_ATTR } from "../src/sandbox.js";
import { demoAssist } from "../src/assist.js";
import { sha256Hex } from "../src/sha256.js";
import { t1Plugin } from "../src/plugin.js";
import type { TrackCtx } from "@ailx/core";

describe("sha256 (pure TS, client-safe)", () => {
  it("matches known vectors", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    // > 55 bytes exercises multi-block padding
    expect(sha256Hex("a".repeat(100))).toBe(
      "2816597888e4a0d3a36b82b83316ab32680eb8f00f8cd3b904d681246d285a0e",
    );
  });
});

describe("buildPreviewSrcdoc — spec §12", () => {
  it("injects the CSP meta into an existing head", () => {
    const out = buildPreviewSrcdoc("<html><head><title>t</title></head><body></body></html>");
    expect(out).toContain('http-equiv="Content-Security-Policy"');
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(out.indexOf("<title>"));
  });
  it("wraps fragments in a full shell with CSP", () => {
    const out = buildPreviewSrcdoc("<h1>hi</h1>");
    expect(out).toMatch(/^<!doctype html>/);
    expect(out).toContain("Content-Security-Policy");
    expect(out).toContain("<h1>hi</h1>");
  });
  it("kill switch: default-src none, connect-src none, form-action none", () => {
    expect(PREVIEW_CSP).toContain("default-src 'none'");
    expect(PREVIEW_CSP).toContain("connect-src 'none'");
    expect(PREVIEW_CSP).toContain("form-action 'none'");
  });
  it("sandbox attribute never includes allow-same-origin", () => {
    expect(SANDBOX_ATTR).toBe("allow-scripts");
    expect(SANDBOX_ATTR).not.toContain("allow-same-origin");
  });
});

describe("demoAssist — deterministic demo simulator", () => {
  it("same prompt, same reply", () => {
    expect(demoAssist("give me a hero section")).toEqual(demoAssist("give me a hero section"));
  });
  it("routes on keywords", () => {
    expect(demoAssist("build me a nav menu").title).toBe("Sticky top navigation");
    expect(demoAssist("responsive project grid please").title).toBe("Responsive project grid");
  });
  it("falls back for unmatched prompts and labels itself demo", () => {
    const r = demoAssist("zzzz unrelated");
    expect(r.title).toBe("Semantic page skeleton");
    expect(r.modelId).toBe("demo-assist@1");
    expect(r.note).toContain("Demo assistant");
  });
});

const ctx: TrackCtx = {
  attemptId: "a-1",
  trackId: "t1-creative-build",
  locale: "en",
  emit: async () => {},
};

describe("t1Plugin", () => {
  it("has the contract identity", () => {
    expect(t1Plugin.id).toBe("t1-creative-build");
    expect(t1Plugin.apiVersion).toBe(2);
  });
  it("validateConfig applies defaults and rejects junk", () => {
    const cfg = t1Plugin.validateConfig(undefined);
    expect(cfg.requiredElements.length).toBeGreaterThan(0);
    expect(() => t1Plugin.validateConfig(42)).toThrow();
    expect(() => t1Plugin.validateConfig({ brief: "" })).toThrow();
    expect(() => t1Plugin.validateConfig({ selfReportMaxChars: -1 })).toThrow();
    expect(t1Plugin.validateConfig({ brief: "B" }).brief).toBe("B");
  });
  it("ingest is idempotent and validates html", async () => {
    const cfg = t1Plugin.validateConfig({});
    const s = await t1Plugin.startSession(ctx, cfg);
    const payload = {
      kind: "t1-artifact",
      json: { html: "<p>x</p>", promptLog: [], selfReport: "r" },
    };
    const a1 = await t1Plugin.ingest(ctx, s, payload);
    const a2 = await t1Plugin.ingest(ctx, s, payload);
    expect(a1).toEqual(a2);
    await expect(t1Plugin.ingest(ctx, s, { kind: "t1-artifact", json: {} })).rejects.toThrow();
  });
  it("pipeline declares capture, judging, human CJ and aggregate stages", () => {
    const ids = t1Plugin.pipeline(t1Plugin.validateConfig({})).map((s) => s.id);
    expect(ids).toEqual([
      "capture",
      "judge-t1-screening",
      "pairwise-comparative",
      "aggregate",
    ]);
  });
});
