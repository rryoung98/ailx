import { describe, it, expect } from "vitest";
import { buildPreviewSrcdoc, PREVIEW_CSP, SANDBOX_ATTR } from "../src/sandbox.js";
import { demoAssist } from "../src/assist.js";
import { sha256Hex } from "@ailx/core";
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

const CSP_AT = (s: string) => s.indexOf("Content-Security-Policy");

describe("buildPreviewSrcdoc — spec §12 + F4 (no regex injection)", () => {
  it("CSP meta precedes any user content, even with an existing head", () => {
    const user = "<html><head><title>t</title></head><body></body></html>";
    const out = buildPreviewSrcdoc(user);
    expect(out).toContain('http-equiv="Content-Security-Policy"');
    expect(CSP_AT(out)).toBeLessThan(out.indexOf("<title>"));
    expect(CSP_AT(out)).toBeLessThan(out.indexOf(user));
  });
  it("wraps fragments in a full shell with CSP", () => {
    const out = buildPreviewSrcdoc("<h1>hi</h1>");
    expect(out).toMatch(/^<!doctype html>/);
    expect(out).toContain("Content-Security-Policy");
    expect(out).toContain("<h1>hi</h1>");
  });
  it("F4 regression: fake <head> inside a comment cannot swallow the CSP", () => {
    const hostile =
      "<!-- <head> --><html><head><title>x</title></head><body><script>fetch('https://evil.example')</script></body></html>";
    const out = buildPreviewSrcdoc(hostile);
    // CSP meta must appear before the FIRST byte of hostile input,
    // so it can never land inside the attacker's comment.
    expect(CSP_AT(out)).toBeGreaterThanOrEqual(0);
    expect(CSP_AT(out)).toBeLessThan(out.indexOf("<!--"));
    expect(CSP_AT(out)).toBeLessThan(out.indexOf(hostile));
  });
  it("F4 regression: uppercase HEAD and attribute-laden head do not matter", () => {
    for (const hostile of [
      "<HTML><HEAD><TITLE>x</TITLE></HEAD><BODY>y</BODY></HTML>",
      '<html><head data-x="1"><title>x</title></head><body>y</body></html>',
      "no head at all <script>fetch('x')</script>",
      "<!-- <HEAD lang=en> --> <head>real</head>",
    ]) {
      const out = buildPreviewSrcdoc(hostile);
      expect(CSP_AT(out)).toBeLessThan(out.indexOf(hostile));
      // the trusted shell prefix is constant: nothing user-supplied precedes it
      expect(out.startsWith("<!doctype html><html><head><meta http-equiv=")).toBe(true);
    }
  });
  it("F4 regression: user input never appears before the CSP meta closes", () => {
    const hostile = "</head></html><head></head>";
    const out = buildPreviewSrcdoc(hostile);
    expect(out.slice(0, CSP_AT(out))).not.toContain(hostile.slice(0, 7));
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
  it("exposes a lazy ui() loader resolving to the Runner (F11)", async () => {
    expect(typeof t1Plugin.ui).toBe("function");
    const mod = await t1Plugin.ui!();
    expect(typeof mod.Runner).toBe("function");
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
