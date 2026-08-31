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

/** Provenance items are answered by BUTTON: the card never flies off. */
const provenanceConfig = {
  items: items.filter((i) => i.type === "provenance").slice(0, 2),
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

  it("shows the judged TEXT material too, so the frame is never half empty", () => {
    mount(textConfig);
    startDeck();
    answer();
    const shown = sheet().querySelector<HTMLElement>('[data-testid="judged-stimulus"]');
    expect(shown).not.toBeNull();
    expect(shown!.textContent).toBe(textConfig.items[0].material);
    // It takes the leftover height instead of leaving white space below
    // the Lock in button (the ~300px empty card reported on mobile).
    expect(shown!.style.flex).toContain("1");
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
  it("never yanks the page: any scroll request is block:\"nearest\", which no-ops when visible", () => {
    // jsdom has no layout, so the OUTCOME (scroll position unchanged) is only
    // provable in a real browser — apps/web/e2e measures window.scrollY across
    // the transition at 390x844 and 1440x700. What is provable HERE is the
    // mechanism: the deck may ask to reveal the panel when the viewport is too
    // short for DECK_MIN_H, but it must never ask with "start"/"center", which
    // are the options that move a page that was already fine.
    mount();
    startDeck();
    answer();
    for (const call of scrollIntoView.mock.calls) {
      expect(call[0]).toMatchObject({ block: "nearest" });
    }
    setConfidence(80);
    act(() => lockIn().click());
    expect(container.textContent).toContain("Item 2 / 2");
    for (const call of scrollIntoView.mock.calls) {
      expect(call[0]).toMatchObject({ block: "nearest" });
    }
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

describe("the step is never hidden behind the card it is about", () => {
  /**
   * The step sits BELOW the top card on purpose, so a swiped card sails
   * across it. A provenance item is answered with a button and never
   * flies off, so the card stayed put and covered the step completely —
   * the candidate was moving a slider they could not see.
   */
  function topCard(): HTMLElement {
    const el = container.querySelector<HTMLElement>('[data-testid="top-card"]');
    if (!el) throw new Error("top card not rendered");
    return el;
  }

  it("fades a non-swipeable card out while the step is open", () => {
    mount(provenanceConfig);
    startDeck();
    expect(topCard().style.opacity).toBe("1");
    const option = buttons().find((b) => b.className.includes("t2-option-btn"))!;
    act(() => option.click());
    expect(sheet().getAttribute("aria-hidden")).toBe("false");
    expect(topCard().style.opacity).toBe("0");
    expect(topCard().style.transition).toContain("opacity");
  });

  it("leaves a swipeable card alone — it flies off across the step", () => {
    mount();
    startDeck();
    answer();
    expect(topCard().style.opacity).toBe("1");
  });
});

describe("no viewport is scrolled when the step opens (mobile regression)", () => {
  /**
   * The 2026-08-30 re-check: on 1440x900 the page did not move a pixel, but
   * on a 390x844 phone it jumped ~464px in ONE frame, every single item,
   * and OVERSHOT — the panel landed above the fold, so the candidate saw an
   * empty card and had to scroll UP to find the slider.
   *
   * It was never scrollIntoView (already gone) and never a layout shift: it
   * was the browser scrolling a newly focused control into view. jsdom does
   * not implement that, so the harness below implements it — focus() without
   * `preventScroll` moves the page, exactly as a real engine does. Drop the
   * `preventScroll` and these tests fail.
   */
  const SHORT_VIEWPORT = 700;
  let scrolled: number;
  let focusOptions: Array<FocusOptions | undefined>;
  let realFocus: typeof HTMLElement.prototype.focus;

  beforeEach(() => {
    scrolled = 0;
    focusOptions = [];
    window.innerHeight = SHORT_VIEWPORT;
    vi.spyOn(window, "scrollY", "get").mockImplementation(() => scrolled);
    realFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function patched(this: HTMLElement, options?: FocusOptions) {
      focusOptions.push(options);
      // What a real browser does: scroll the focused control into view
      // unless it is explicitly told not to.
      if (!options?.preventScroll) scrolled = 464;
      realFocus.call(this, options);
    };
  });

  afterEach(() => {
    HTMLElement.prototype.focus = realFocus;
    window.innerHeight = 768;
  });

  it("leaves the page where it was when the step takes focus on a short viewport", () => {
    mount();
    startDeck();
    answer();
    expect(window.scrollY).toBe(0);
    expect(focusOptions).not.toHaveLength(0);
    for (const o of focusOptions) expect(o?.preventScroll).toBe(true);
  });

  it("leaves it there through lock-in, when focus goes back to the deck", () => {
    mount();
    startDeck();
    answer();
    setConfidence(75);
    act(() => lockIn().click());
    expect(container.textContent).toContain("Item 2 / 2");
    expect(window.scrollY).toBe(0);
    for (const o of focusOptions) expect(o?.preventScroll).toBe(true);
  });

  /**
   * This one also pins a PREMISE OF THE E2E FAULT INJECTOR. `breakNextRunnerFocus`
   * in apps/web/e2e/fixtures.ts crashes the runner by making the first
   * `HTMLElement.focus()` throw, which only faults anything while answering a
   * card really does focus the slider. Its predecessor broke `scrollIntoView`,
   * which this runner had stopped calling, and it silently faulted nothing for
   * hours (FRONTEND.md §6.7.3). If this test ever goes red, the injector has to
   * move with the code — do not just delete the assertion.
   */
  it("still focuses the slider — preventScroll must not cost focus", () => {
    mount();
    startDeck();
    answer();
    expect(document.activeElement).toBe(
      container.querySelector('input[type="range"]'),
    );
  });
});

describe("the frame is sized to the viewport, so nothing needs scrolling to", () => {
  /**
   * The panel IS the deck frame, so "does the deck fit" decides whether the
   * candidate can reach the slider without scrolling. jsdom lays nothing
   * out, so the geometry measured on the real staging page at 390x844 is
   * fed in: 346px of chrome above the deck, 114px of answer buttons below.
   */
  /** Measured on staging: phone 390x844, short desktop 1440x700. */
  const PHONE = { above: 346, below: 114 };
  const DESKTOP = { above: 272, below: 110 };
  let rects: ReturnType<typeof vi.spyOn>;

  function layout(viewportHeight: number, chrome = PHONE, frameHeight = 460) {
    window.innerHeight = viewportHeight;
    rects = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const isRoot = (this as HTMLElement).dataset?.testid === "swipe-deck";
      const top = chrome.above;
      const height = isRoot ? frameHeight + chrome.below : frameHeight;
      return { top, height, bottom: top + height, left: 0, right: 390, width: 390, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
  }

  afterEach(() => {
    rects?.mockRestore();
    window.innerHeight = 768;
  });

  function frame(): HTMLElement {
    const el = sheet().parentElement?.parentElement;
    if (!el) throw new Error("deck frame not found");
    return el;
  }

  it("shrinks the frame so the deck AND its answer buttons fit a phone", () => {
    layout(844, PHONE);
    mount();
    startDeck();
    const h = Number.parseFloat(frame().style.height);
    expect(h).toBeGreaterThan(0);
    // Fully on screen: the panel's top is never above the fold (the
    // overshoot bug) and its bottom is never below it.
    expect(PHONE.above).toBeGreaterThanOrEqual(0);
    expect(PHONE.above + h + PHONE.below).toBeLessThanOrEqual(844);
  });

  it("does the same on a short desktop window", () => {
    layout(700, DESKTOP);
    mount();
    startDeck();
    const h = Number.parseFloat(frame().style.height);
    expect(DESKTOP.above + h + DESKTOP.below).toBeLessThanOrEqual(700);
  });

  it("never grows past the designed card height on a tall window", () => {
    layout(1200, DESKTOP);
    mount();
    startDeck();
    expect(Number.parseFloat(frame().style.height)).toBe(460);
  });

  it("stops shrinking at a card-shaped floor rather than becoming a sliver", () => {
    // A landscape phone cannot fit a card at all; a 120px sliver would be
    // useless, so the deck keeps a card shape and the page may scroll.
    //
    // The floor is 312, not 300: a real browser measured the confidence
    // panel's own content at 308px on a 390x844 phone (provenance item), so
    // the old floor made the candidate scroll 8px INSIDE the step. jsdom
    // cannot re-measure that here — every box it reports is 0x0 — so this
    // guards the NUMBER and apps/web/e2e/visual.spec.ts guards the geometry.
    // The short-desktop test above is the other half of the trade: the floor
    // may not grow so far that the deck stops fitting a 700px window.
    layout(400, PHONE);
    mount();
    startDeck();
    expect(Number.parseFloat(frame().style.height)).toBe(312);
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
