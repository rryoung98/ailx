/**
 * App-wide button standardization — every .btn (and the runner buttons via
 * their injected stylesheets) shares the same motion: background/color/
 * border 150ms ease, transform 120ms; secondary buttons FILL with the
 * accent + white text on hover; active presses down (scale 0.98).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");
const TRACKS = join(__dirname, "..", "..", "..", "packages", "tracks");

describe("standardized .btn motion (globals.css)", () => {
  it("transition covers background/color/border at 150ms and transform at 120ms", () => {
    expect(css).toContain(
      "transition: background 150ms ease, color 150ms ease, border-color 150ms ease, transform 120ms ease;",
    );
  });

  it("secondary .btn hover fills with the accent and flips to white text", () => {
    expect(css).toMatch(
      /\.btn:hover \{ background: var\(--accent\); border-color: var\(--accent\); color: #ffffff;/,
    );
  });

  it("hover lifts and active presses down with a scale", () => {
    expect(css).toContain(".btn:hover { transform: translateY(-1px); }");
    expect(css).toContain(".btn:active { transform: translateY(0) scale(0.98); }");
  });

  it("start-gate pill + connect attention styles exist", () => {
    expect(css).toContain(".pill-cta.disabled");
    expect(css).toContain("@keyframes ailx-attention");
    expect(css).toContain(".connect-attention");
  });
});

describe("runner buttons share the standardized motion (injected styles)", () => {
  const files = [
    "t1-creative-build/src/Runner.tsx",
    "t2-discrimination/src/SwipeDeck.tsx",
    "t4-generative/src/Runner.tsx",
  ];
  for (const f of files) {
    it(`${f} uses 150ms fills + 120ms transform`, () => {
      const src = readFileSync(join(TRACKS, f), "utf8");
      expect(src).toContain("background 150ms ease");
      expect(src).toContain("transform 120ms ease");
    });
  }
});
