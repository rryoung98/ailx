import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Runner } from "../src/Runner.js";

const props = {
  attemptId: "a-1",
  locale: "en" as const,
  config: {},
  onEvent: () => {},
  onComplete: () => {},
  secondsRemaining: 3600,
  onCheckpoint: () => {},
};

/**
 * Mobile containment — same bug class as the T1 submit-button escape:
 * an INLINE max-height: 78vh cap on the left column let "Generate draft"
 * and "Disconnect" render past the card bottom at 390x844. The cap now
 * lives in the .t4-pane CSS class and is lifted at phone widths.
 */
describe("T4 mobile containment", () => {
  it("left column carries the t4-pane class and NO inline height cap", () => {
    const html = renderToStaticMarkup(createElement(Runner, props));
    expect(html).toContain("t4-pane");
    expect(html).not.toContain("max-height:78vh");
    expect(html).not.toContain("max-height: 78vh;\"");
  });

  it("stylesheet pins the pane cap on desktop and removes it on phones", () => {
    const html = renderToStaticMarkup(createElement(Runner, props));
    expect(html).toMatch(/\.t4-pane \{\s*max-height: 78vh; min-height: 480px;/);
    const mobile = html.slice(html.indexOf("@media (max-width: 900px)"));
    expect(mobile).toContain(".t4-pane { max-height: none; min-height: 0; }");
    expect(html).toContain(".t4-grid > div { min-width: 0; }");
  });

  it("inputs render >= 16px on phones and buttons are >= 44px touch targets", () => {
    const html = renderToStaticMarkup(createElement(Runner, props));
    const mobile = html.slice(html.indexOf("@media (max-width: 900px)"));
    expect(mobile).toContain(".t4-shell textarea, .t4-shell input, .t4-shell select { font-size: 16px !important; }");
    const coarse = html.slice(html.indexOf("@media (pointer: coarse)"));
    expect(coarse).toContain(".t4-shell .t4-btn { min-height: 44px; }");
  });

  it("resizable textareas are clamped (drag handle cannot pull them over the Direction-note card)", () => {
    const html = renderToStaticMarkup(createElement(Runner, props));
    expect(html).toContain(".t4-shell textarea { max-height: 60vh; }");
    const coarse = html.slice(html.indexOf("@media (pointer: coarse)"));
    expect(coarse).toContain(".t4-shell textarea { resize: none !important; }");
  });

  it("the image-prompt textarea is shrinkable and box-sized so it cannot overflow the card", () => {
    const html = renderToStaticMarkup(createElement(Runner, props));
    const m = html.match(/aria-label="Image prompt"[^>]*style="([^"]*)"/);
    expect(m).not.toBeNull();
    expect(m![1]).toContain("min-width:0");
    expect(m![1]).toContain("box-sizing:border-box");
  });

  it("capped pane scrolls internally instead of spilling (mid-width overlap bug)", () => {
    const src = readFileSync(join(here, "../src/Runner.tsx"), "utf8");
    const m = /\.t4-pane \{[^}]*max-height[^}]*\}/s.exec(src);
    expect(m, ".t4-pane rule").toBeTruthy();
    expect(m![0]).toContain("overflow-y: auto");
  });
});
