// @vitest-environment jsdom
/**
 * T2 image robustness + answer-button polish — regressions for:
 *  - glitchy/blank images (preload next 2, decode, retry once, fallback)
 *  - the card shadow painting OVER the judgment buttons below the deck
 *  - answer buttons that must FILL green on hover (150ms) with white text
 *  - the "Lock in" button's padlock glyph
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Runner } from "../src/Runner.js";
import { SwipeDeck } from "../src/SwipeDeck.js";
import type { T2Phase } from "../src/checkpoint.js";
import { config, items } from "./fixtures.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  vi.unstubAllGlobals();
});

function mountDeck(itemIndex = 0, nextCount = 2) {
  const c = document.createElement("div");
  document.body.appendChild(c);
  root = createRoot(c);
  act(() =>
    root!.render(
      createElement(SwipeDeck, {
        item: items[itemIndex],
        nextItems: items.slice(itemIndex + 1, itemIndex + 1 + nextCount),
        enabled: true,
        onChoose: () => {},
      }),
    ),
  );
  return c;
}

describe("T2 answer buttons", () => {
  it("carry the t2-answer-btn classes with a solid card background (shadow cannot bleed through)", () => {
    const c = mountDeck();
    const left = c.querySelector("button.t2-answer-btn.tone-left");
    const right = c.querySelector("button.t2-answer-btn.tone-right");
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    const css = c.querySelector("style")!.textContent!;
    expect(css).toContain("background: var(--card");
  });

  it("hover FILLS with the accent green + white text at 150ms (injected stylesheet)", () => {
    const c = mountDeck();
    const css = c.querySelector("style")!.textContent!;
    const hover = css.slice(css.indexOf(".t2-answer-btn:hover"));
    expect(hover).toContain("background: var(--accent");
    expect(hover).toContain("color: #fff");
    expect(css).toContain("background 150ms ease");
    expect(css).toContain("transform 120ms ease");
  });

  it("the card shadow is contained (no 40px-spread dark shadow over the buttons)", () => {
    const c = mountDeck();
    const top = c.querySelector('[data-testid="top-card"]') as HTMLElement;
    expect(top.style.boxShadow).not.toContain("0.35");
    expect(top.style.boxShadow).toContain("rgba(26,26,26,0.14)");
  });
});

describe("T2 stimulus image robustness", () => {
  it("preloads (and decodes) the next two image stimuli", () => {
    const created: string[] = [];
    class FakeImage {
      decoding = "";
      set src(v: string) {
        created.push(v);
      }
      decode() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal("Image", FakeImage);
    mountDeck(0, 2); // items[1] is an image; items[2] is audio text
    expect(created).toContain(items[1].material);
  });

  it("retries a failed image load once, then falls back to a labeled block", () => {
    const c = mountDeck(0, 0);
    const img = () => c.querySelector('[data-testid="top-card"] img') as HTMLImageElement | null;
    expect(img()).not.toBeNull();
    act(() => img()!.dispatchEvent(new Event("error")));
    // Retry: an <img> is still mounted (fresh attempt), no fallback yet.
    expect(img()).not.toBeNull();
    expect(c.querySelector('[data-testid="stimulus-fallback"]')).toBeNull();
    act(() => img()!.dispatchEvent(new Event("error")));
    // Second failure: labeled fallback replaces the broken image.
    expect(c.querySelector('[data-testid="top-card"] [data-testid="stimulus-fallback"]')).not.toBeNull();
  });
});

describe("T2 Lock in button", () => {
  it("shows an inline padlock glyph (aria-hidden) before the label", () => {
    const cp = {
      phase: "deck" as T2Phase,
      deckIndex: 0,
      replayIdx: 0,
      responses: [],
    };
    const c = document.createElement("div");
    document.body.appendChild(c);
    root = createRoot(c);
    act(() =>
      root!.render(
        createElement(Runner, {
          attemptId: "a-1",
          locale: "en" as const,
          config,
          onEvent: () => {},
          onComplete: () => {},
          secondsRemaining: 600,
          checkpoint: cp,
          onCheckpoint: () => {},
        }),
      ),
    );
    const lock = [...c.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Lock in"))!;
    expect(lock).toBeTruthy();
    const svg = lock.querySelector('svg[data-testid="lock-icon"]');
    expect(svg, "padlock svg inside the Lock in button").not.toBeNull();
    expect(svg!.getAttribute("aria-hidden")).toBe("true");
  });
});
