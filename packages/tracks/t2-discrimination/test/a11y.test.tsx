// @vitest-environment jsdom
/**
 * T2 accessibility regression tests (WCAG 2.1 AA pass):
 *  - a polite aria-live region announces item number + stem on every deck
 *    advance, and reveal outcomes during the replay phase;
 *  - the confidence slider is labeled with its current value;
 *  - screen-reader deck instructions name the labeled buttons as the
 *    primary answer path;
 *  - localized item content (ja/ko decks) carries a lang attribute while
 *    UI chrome stays English.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Runner } from "../src/Runner.js";
import { encodeT2Checkpoint } from "../src/checkpoint.js";
import { config, items } from "./fixtures.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(locale: "en" | "ja" | "ko", checkpoint?: unknown) {
  act(() => {
    root.render(
      createElement(Runner, {
        attemptId: "att-a11y",
        locale,
        config,
        onEvent: () => {},
        onComplete: () => {},
        secondsRemaining: 600,
        checkpoint,
        onCheckpoint: () => {},
      }),
    );
  });
}

const deckCheckpoint = () =>
  encodeT2Checkpoint({ phase: "deck", deckIndex: 0, replayIdx: 0, responses: [] });

const replayCheckpoint = () =>
  encodeT2Checkpoint({
    phase: "replay",
    deckIndex: items.length,
    replayIdx: 0,
    responses: items.map((i) => ({ itemId: i.id, choice: i.key, confidence: 70, latencyMs: 900 })),
  });

describe("T2 a11y", () => {
  it("deck phase exposes a polite live region announcing item number + stem", () => {
    mount("en", deckCheckpoint());
    const live = container.querySelector('[data-testid="deck-live-region"]');
    expect(live).not.toBeNull();
    expect(live!.getAttribute("aria-live")).toBe("polite");
    expect(live!.textContent).toContain("Item 1 of");
    expect(live!.textContent).toContain(items[0].stem);
  });

  it("deck phase includes screen-reader instructions naming the buttons as the primary path", () => {
    mount("en", deckCheckpoint());
    expect(container.textContent).toContain("labeled answer buttons");
    expect(container.textContent).toContain("primary path");
  });

  it("confidence slider is labeled with its current value", () => {
    mount("en", deckCheckpoint());
    const slider = container.querySelector('input[type="range"]');
    expect(slider).not.toBeNull();
    expect(slider!.getAttribute("aria-label")).toBe("Confidence: 50 out of 100");
    expect(slider!.getAttribute("aria-valuetext")).toBe("50 out of 100");
  });

  it("localized decks mark item content with the content language (ja)", () => {
    mount("ja", deckCheckpoint());
    // The stem inside the live region and the card carries lang="ja"...
    const localized = [...container.querySelectorAll('[lang="ja"]')];
    expect(localized.length).toBeGreaterThan(0);
    expect(localized.some((el) => (el.textContent ?? "").includes(items[0].stem))).toBe(true);
    // ...while English UI chrome does not.
    const instructions = [...container.querySelectorAll("p")].find((p) =>
      (p.textContent ?? "").includes("labeled answer buttons"),
    );
    expect(instructions?.getAttribute("lang")).toBeNull();
  });

  it("en decks carry no lang override (inherit html lang)", () => {
    mount("en", deckCheckpoint());
    expect(container.querySelector("[lang]")).toBeNull();
  });

  it("replay phase announces the reveal outcome in a polite live region", () => {
    mount("en", replayCheckpoint());
    const live = container.querySelector('[data-testid="replay-live-region"]');
    expect(live).not.toBeNull();
    expect(live!.getAttribute("aria-live")).toBe("polite");
    expect(live!.textContent).toContain("Replay item 1 of");
    expect(live!.textContent).toContain("correct");
  });
});
