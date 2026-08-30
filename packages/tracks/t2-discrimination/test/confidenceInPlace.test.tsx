// @vitest-environment jsdom
/**
 * The confidence step happens IN PLACE (2026-08-29 UX report).
 *
 * It used to render as a sibling BELOW the deck, so opening it called
 * `scrollIntoView` to drag the page down and locking in called another one
 * to drag it back up. That ping-pong was the reported problem: hard to
 * follow, and smooth-scroll is exactly where browser engines diverge.
 *
 * The step now fills the deck's own card frame (SwipeDeck's `overlay`), so:
 *  - nothing is ever scrolled into view, and the page height never changes;
 *  - the judged stimulus stays visible in the frame it was judged in;
 *  - the rise is a plain CSS transition, gated on `prefers-reduced-motion`;
 *  - none of it touches decisionLatency, which is anchored at the swipe.
 *
 * Focus, the Tab trap and the closed-sheet inertness are pinned separately
 * in keyboardFocus.test.tsx — this file must not weaken them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TrackEvent } from "@ailx/core";
import { Runner } from "../src/Runner.js";
import { items } from "./fixtures.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** Two binary IMAGE items — the judged stimulus is observable. */
const imageConfig = {
  items: items.filter((i) => i.type === "media-image").slice(0, 2),
  weights: { sensitivity: 60, calibration: 25, provenance: 15 },
};

/** A binary TEXT item, to prove the panel is frame-filling for every type. */
const textConfig = {
  items: items.filter((i) => i.type === "message-email").slice(0, 2),
  weights: { sensitivity: 60, calibration: 25, provenance: 15 },
};

let container: HTMLElement;
let root: Root;
let events: TrackEvent[];
let scrollIntoView: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  events = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // jsdom does not implement scrollIntoView; the spy is both the stub and
  // the assertion that the runner never reaches for it.
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
  scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
});

afterEach(() => {
  scrollIntoView.mockRestore();
  vi.restoreAllMocks();
  act(() => root.unmount());
  container.remove();
});

function mount(config: unknown = imageConfig) {
  act(() => {
    root.render(
      createElement(Runner, {
        attemptId: "att-inplace",
        locale: "en" as const,
        config,
        onEvent: (e: TrackEvent) => events.push(e),
        onComplete: () => {},
        secondsRemaining: 600,
        checkpoint: undefined,
        onCheckpoint: () => {},
      }),
    );
  });
}

function buttons(): HTMLButtonElement[] {
  return [...container.querySelectorAll("button")];
}

function byText(text: string): HTMLButtonElement {
  const b = buttons().find((x) => (x.textContent ?? "").trim() === text);
  if (!b) throw new Error(`button "${text}" not found`);
  return b;
}

const startDeck = () => act(() => byText("Start the deck").click());

function answerButtons(): HTMLButtonElement[] {
  return buttons().filter((b) => b.className.includes("t2-answer-btn"));
}

function deck(): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-testid="swipe-deck"]');
  if (!el) throw new Error("deck not rendered");
  return el;
}

function sheet(): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-testid="confidence-sheet"]');
  if (!el) throw new Error("confidence sheet not rendered");
  return el;
}

function lockIn(): HTMLButtonElement {
  const b = buttons().find((x) => (x.textContent ?? "").includes("Lock in"));
  if (!b) throw new Error("Lock in not found");
  return b;
}

function answer(index = 0) {
  act(() => {
    answerButtons()[index].dispatchEvent(
      new KeyboardEvent("keydown", {
        key: index === 0 ? "ArrowLeft" : "ArrowRight",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

function setConfidence(value: number) {
  const el = container.querySelector<HTMLInputElement>('input[type="range"]')!;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the confidence step occupies the card's own frame", () => {
  it("renders inside the deck, not as a sibling after it", () => {
    mount();
    startDeck();
    expect(deck().contains(sheet())).toBe(true);
    // Out of flow: opening it cannot change the height of the page.
    expect(sheet().style.position).toBe("absolute");
    expect(sheet().style.inset).toMatch(/^0(px)?$/);
  });

  it("does the same for text items, not just image items", () => {
    mount(textConfig);
    startDeck();
    expect(deck().contains(sheet())).toBe(true);
    expect(sheet().style.position).toBe("absolute");
  });

  it("keeps the judged stimulus visible while confidence is being set", () => {
    mount();
    startDeck();
    answer();
    const shown = sheet().querySelector<HTMLImageElement>('[data-testid="judged-stimulus"]');
    expect(shown).not.toBeNull();
    expect(shown!.getAttribute("src")).toBe(imageConfig.items[0].material);
    // Decorative: a descriptive alt would leak the authenticity answer.
    expect(shown!.getAttribute("alt")).toBe("");
    expect(shown!.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps the upcoming stimulus masked behind the step", () => {
    mount();
    startDeck();
    answer();
    const stimuli = [...deck().querySelectorAll("img")].map((i) => i.getAttribute("src"));
    expect(stimuli).not.toContain(imageConfig.items[1].material);
  });
});

describe("nothing is scrolled into view any more", () => {
  it("never calls scrollIntoView through a whole item", () => {
    mount();
    startDeck();
    answer();
    expect(scrollIntoView).not.toHaveBeenCalled();
    setConfidence(80);
    act(() => lockIn().click());
    expect(container.textContent).toContain("Item 2 / 2");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("leaves the window scroll position exactly where the candidate left it", () => {
    mount();
    startDeck();
    const scrollTo = vi.spyOn(window, "scrollTo");
    const before = { x: window.scrollX, y: window.scrollY };
    answer();
    setConfidence(55);
    act(() => lockIn().click());
    expect(scrollTo).not.toHaveBeenCalled();
    expect({ x: window.scrollX, y: window.scrollY }).toEqual(before);
  });
});

describe("motion serves comprehension and respects prefers-reduced-motion", () => {
  it("rises with an ease-out transition and no overshoot by default", () => {
    mount();
    startDeck();
    // Closed: offset and transparent, but still laid out (it transitions).
    expect(sheet().style.opacity).toBe("0");
    expect(sheet().style.transform).not.toBe("none");
    expect(sheet().style.transition).toContain("transform");
    // A cubic-bezier whose control points stay within 0..1 cannot overshoot,
    // so the slider is never still moving when it is reached for.
    const ys = [...sheet().style.transition.matchAll(/cubic-bezier\(([^)]*)\)/g)]
      .flatMap((m) => m[1].split(",").map(Number))
      .filter((_, i) => i % 2 === 1);
    expect(ys.length).toBeGreaterThan(0);
    for (const y of ys) expect(y).toBeLessThanOrEqual(1);

    answer();
    expect(sheet().style.opacity).toBe("1");
    expect(sheet().style.transform).toBe("none");
  });

  it("renders with no transition and no movement under reduced motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    mount();
    startDeck();
    expect(sheet().style.transition).toBe("none");
    expect(sheet().style.transform).toBe("none");
    expect(sheet().style.opacity).toBe("0");
    answer();
    expect(sheet().style.transition).toBe("none");
    expect(sheet().style.transform).toBe("none");
    expect(sheet().style.opacity).toBe("1");
    vi.unstubAllGlobals();
  });
});

describe("the in-place step does not touch scored timing", () => {
  it("anchors latency at the swipe, never at lock-in", () => {
    let clock = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    mount();
    startDeck();
    clock = 1420; // 420ms of looking at the card
    answer();
    clock = 9999; // ...then a long, unhurried think on the slider
    setConfidence(70);
    act(() => lockIn().click());
    const responded = events.filter((e) => e.verb === "responded");
    expect(responded).toHaveLength(1);
    expect((responded[0].result as { latencyMs: number }).latencyMs).toBe(420);
  });
});
