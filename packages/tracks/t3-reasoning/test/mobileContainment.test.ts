import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Mobile containment — regression for the 390x844 horizontal-scroll bug:
 * the assistant prompt row (input + Send + Regenerate) had no wrap and the
 * input no min-width, so the row's min-content (403px) forced the whole
 * page wider than the viewport. The analysis textarea was width: 100%
 * WITHOUT border-box, so its padding overflowed the card.
 */
const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/Runner.tsx"),
  "utf8",
);

describe("T3 mobile containment (source pin)", () => {
  it("prompt row wraps and the input is shrinkable", () => {
    const row = src.slice(src.indexOf('aria-label="Prompt the assistant"') - 600);
    expect(row).toContain('flexWrap: "wrap"');
    expect(row).toContain("minWidth: 0");
  });

  it("analysis textarea is border-box so its padding cannot overflow the card", () => {
    const ta = src.slice(src.indexOf('aria-label="Your analysis draft"'));
    expect(ta).toContain('boxSizing: "border-box"');
    expect(ta).toContain('maxWidth: "100%"');
  });

  it("draft action row wraps on narrow screens", () => {
    const row = src.slice(src.indexOf("Save revision") - 400, src.indexOf("Save revision"));
    expect(row).toContain('flexWrap: "wrap"');
  });

  it("scoped stylesheet pins 16px inputs on phones and 44px coarse-pointer buttons", () => {
    expect(src).toContain("const T3_CSS");
    const mobile = src.slice(src.indexOf("@media (max-width: 900px)"));
    expect(mobile).toContain(".t3-shell textarea, .t3-shell input, .t3-shell select { font-size: 16px !important; }");
    const coarse = src.slice(src.indexOf("@media (pointer: coarse)"));
    expect(coarse).toContain(".t3-shell button { min-height: 44px; }");
    expect(src).toContain(".t3-shell textarea { max-height: 60vh; }");
    expect(coarse).toContain(".t3-shell textarea { resize: none !important; }");
    // The style tag must actually be rendered by the working screen.
    expect(src).toContain("<style>{T3_CSS}</style>");
  });
});
