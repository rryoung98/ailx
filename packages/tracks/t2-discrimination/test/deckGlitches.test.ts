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
  it("masks upcoming card content while the confidence step is open", () => {
    expect(deck).toContain("stepOpen ? null : <CardBody item={n}");
  });
  it("runner masks upcoming while the sheet is open", () => {
    expect(runner).toContain("stepOpen={sheetOpen}");
  });
  it("scenario options clear the stack overhang and sit above overlays", () => {
    const optionsBlock = deck.slice(deck.lastIndexOf("t2-option-btn") - 800, deck.lastIndexOf("t2-option-btn"));
    expect(optionsBlock).toContain('marginTop: "2.8rem"');
    expect(optionsBlock).toContain("zIndex: 7");
  });
  it("confidence sheet shows the judged image stimulus", () => {
    expect(runner).toMatch(/isImageMaterial\(item\.material\)[\s\S]{0,600}src=\{item\.material\}/);
  });
  it("never scrolls anything into view — the confidence step happens in place", () => {
    // The sheet used to sit below the deck, so opening it scrolled down and
    // the next item scrolled back up. It now fills the card frame, so there
    // is nothing to scroll to. Behaviour is pinned in confidenceInPlace.test.tsx.
    expect(runner).not.toMatch(/\.scrollIntoView\(/);
  });
  it("renders the confidence step inside the deck frame, not after it", () => {
    expect(runner).toContain("overlay={");
    expect(deck).toContain("zIndex: 3");
  });

  it("GL frameloop never toggles to 'never' (blank-card race) and context loss falls back to DOM", () => {
    const scene = readFileSync(join(here, "../src/swipe/CardScene.tsx"), "utf8");
    expect(scene).not.toContain('frameloop={props.imageUrl ? "always" : "never"}');
    expect(scene).toContain('frameloop="always"');
    expect(scene).toContain("webglcontextlost");
    expect(deck).toContain("handleContextLost");
    expect(deck).toContain("onContextLost={handleContextLost}");
  });
});
