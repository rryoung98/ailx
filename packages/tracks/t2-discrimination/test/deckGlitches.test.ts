/**
 * T2 deck glitches (live dogfood 2026-08-21):
 * 1. Upcoming stimuli must be masked while the confidence sheet is up —
 *    the judged card flies off and the NEXT image showed through.
 * 2. Scenario option lists must clear the stacked cards' overhang
 *    (marginTop + zIndex guard, same as the swipe buttons).
 * 3. The judged image stays visible inside the confidence sheet.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const deck = readFileSync(join(here, "../src/SwipeDeck.tsx"), "utf8");
const runner = readFileSync(join(here, "../src/Runner.tsx"), "utf8");

describe("t2 deck glitch guards", () => {
  it("masks upcoming card content when maskUpcoming is set", () => {
    expect(deck).toContain("maskUpcoming ? null : <CardBody item={n}");
  });
  it("runner masks upcoming while the sheet is open", () => {
    expect(runner).toContain("maskUpcoming={sheetOpen}");
  });
  it("scenario options clear the stack overhang and sit above overlays", () => {
    const optionsBlock = deck.slice(deck.lastIndexOf("t2-option-btn") - 800, deck.lastIndexOf("t2-option-btn"));
    expect(optionsBlock).toContain('marginTop: "2.8rem"');
    expect(optionsBlock).toContain("zIndex: 7");
  });
  it("confidence sheet shows the judged image stimulus", () => {
    expect(runner).toMatch(/media-image[\s\S]{0,400}src=\{item\.material\}/);
  });
  it("advancing scrolls the next item header into view", () => {
    expect(runner).toContain("deckTopRef.current.scrollIntoView");
  });
});
