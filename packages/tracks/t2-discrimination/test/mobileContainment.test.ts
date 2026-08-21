import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Mobile containment: deck answer/option pills must stay tappable
 * (>= 44px on coarse pointers) and can never force the deck wider than a
 * phone viewport (same bug class as the T1 submit-button escape).
 */
const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/SwipeDeck.tsx"),
  "utf8",
);

describe("T2 mobile containment (source pin)", () => {
  it("answer/option pills are box-sized and capped to the deck width", () => {
    expect(src).toContain(".t2-answer-btn, .t2-option-btn { max-width: 100%; box-sizing: border-box; }");
  });

  it("answer/option pills are >= 44px touch targets on coarse pointers", () => {
    const coarse = src.slice(src.indexOf("@media (pointer: coarse)"));
    expect(coarse).toContain(".t2-answer-btn, .t2-option-btn { min-height: 44px; }");
  });
});
