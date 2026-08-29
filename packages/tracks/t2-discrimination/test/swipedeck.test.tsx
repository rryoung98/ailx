// @vitest-environment jsdom
/**
 * SwipeDeck regression tests — the card-swipe deck must:
 *  - fall back to DOM cards (no canvas) when WebGL is unavailable (jsdom);
 *  - answer via the keyboard with the same commit path (← = options[0],
 *    → = options[1]);
 *  - commit a pointer drag past the threshold and map direction → option;
 *  - spring back (no commit) on a short, slow drag;
 *  - fade verdict badges in with the drag offset;
 *  - keep the confidence-sheet step and the responded-event contract.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TrackEvent } from "@ailx/core";
import { Runner } from "../src/Runner.js";
import { SwipeDeck, isImageMaterial } from "../src/SwipeDeck.js";
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

function mountRunner(onEvent: (e: TrackEvent) => void, onComplete: (a: unknown) => void = () => {}) {
  act(() => {
    root.render(
      createElement(Runner, {
        attemptId: "att-swipe",
        locale: "en" as const,
        config,
        onEvent,
        onComplete,
        secondsRemaining: 600,
        checkpoint: undefined,
        onCheckpoint: () => {},
      }),
    );
  });
}

function clickByText(text: string) {
  const btn = [...container.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === text,
  );
  if (!btn) throw new Error(`button "${text}" not found`);
  act(() => btn.click());
}

function startDeck() {
  clickByText("Start the deck");
}

function key(k: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });
}

type PointerInit = { clientX: number; clientY: number; pointerId?: number };
function firePointer(el: Element, type: string, init: PointerInit) {
  // jsdom has no PointerEvent; React listens by event name, so a MouseEvent
  // with pointer fields is sufficient.
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.assign(ev, { pointerId: init.pointerId ?? 1, pointerType: "touch" });
  act(() => {
    el.dispatchEvent(ev);
  });
}

function topCard(): Element {
  const el = container.querySelector('[data-testid="top-card"]');
  if (!el) throw new Error("top card not rendered");
  return el;
}

function setSliderValue(el: HTMLInputElement, value: number) {
  // React tracks the input's value via a patched setter; assigning
  // el.value directly makes React see "no change". Use the native setter.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, String(value));
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Move the confidence slider — "Lock in" stays disabled until it is set. */
function setConfidence(value: number) {
  const slider = container.querySelector<HTMLInputElement>('input[type="range"]');
  if (!slider) throw new Error("confidence slider not rendered");
  act(() => setSliderValue(slider, value));
}

function sheet(): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-testid="confidence-sheet"]');
  if (!el) throw new Error("confidence sheet not rendered");
  return el;
}

describe("non-WebGL fallback (jsdom has no WebGL)", () => {
  it("renders the image item as a visible DOM card with no canvas", () => {
    mountRunner(() => {});
    startDeck();
    const deck = container.querySelector('[data-testid="swipe-deck"]');
    expect(deck).not.toBeNull();
    expect(deck?.getAttribute("data-webgl")).toBe("0");
    expect(container.querySelector("canvas")).toBeNull();
    const img = topCard().querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.style.opacity).not.toBe("0"); // visible in the DOM fallback
  });

  it("classifies materials correctly for the WebGL/DOM split", () => {
    expect(isImageMaterial(items[0].material)).toBe(true);
    expect(isImageMaterial("From: someone@example.com")).toBe(false);
  });
});

describe("keyboard path (arrow keys fling like a swipe)", () => {
  it("ArrowRight commits options[1] and opens the confidence sheet", () => {
    const events: TrackEvent[] = [];
    mountRunner((e) => events.push(e));
    startDeck();
    key("ArrowRight");
    expect(sheet().textContent).toContain(`Your call: ${items[0].options[1]}`);
    setConfidence(70);
    clickByText("Lock in");
    expect(events).toHaveLength(1);
    const r = events[0].result as { choice: number; confidence: number };
    expect(events[0].verb).toBe("responded");
    expect(r.choice).toBe(1);
  });

  it("ArrowLeft commits options[0]", () => {
    const events: TrackEvent[] = [];
    mountRunner((e) => events.push(e));
    startDeck();
    key("ArrowLeft");
    expect(sheet().textContent).toContain(`Your call: ${items[0].options[0]}`);
    setConfidence(70);
    clickByText("Lock in");
    expect((events[0].result as { choice: number }).choice).toBe(0);
  });

  it("ignores arrows while the confidence sheet is open (no double answer)", () => {
    const events: TrackEvent[] = [];
    mountRunner((e) => events.push(e));
    startDeck();
    key("ArrowRight");
    key("ArrowLeft"); // must be a no-op
    setConfidence(70);
    clickByText("Lock in");
    expect(events).toHaveLength(1);
    expect((events[0].result as { choice: number }).choice).toBe(1);
  });
});

describe("pointer drag physics", () => {
  it("a drag past ~35% of the width commits the matching option", () => {
    const events: TrackEvent[] = [];
    mountRunner((e) => events.push(e));
    startDeck();
    const card = topCard();
    // jsdom rects are 0 → the engine falls back to a 320px width; the
    // commit line is 320 * 0.35 = 112px.
    firePointer(card, "pointerdown", { clientX: 200, clientY: 100 });
    firePointer(card, "pointermove", { clientX: 260, clientY: 100 });
    firePointer(card, "pointermove", { clientX: 330, clientY: 105 });
    firePointer(card, "pointerup", { clientX: 330, clientY: 105 });
    expect(sheet().textContent).toContain(`Your call: ${items[0].options[1]}`);
    setConfidence(70);
    clickByText("Lock in");
    expect((events[0].result as { choice: number }).choice).toBe(1);
  });

  it("a leftward drag past the line commits options[0]", () => {
    const events: TrackEvent[] = [];
    mountRunner((e) => events.push(e));
    startDeck();
    const card = topCard();
    firePointer(card, "pointerdown", { clientX: 300, clientY: 100 });
    firePointer(card, "pointermove", { clientX: 180, clientY: 100 });
    firePointer(card, "pointermove", { clientX: 160, clientY: 100 });
    firePointer(card, "pointerup", { clientX: 160, clientY: 100 });
    setConfidence(70);
    clickByText("Lock in");
    expect((events[0].result as { choice: number }).choice).toBe(0);
  });

  it("a short slow drag springs back without committing", () => {
    // Fake performance/time so the drag is genuinely SLOW (30px over 400ms
    // = 0.075 px/ms, far under the fling threshold). Without this, all
    // events land in the same millisecond and read as an instant fling.
    vi.useFakeTimers({ toFake: ["performance", "Date", "setTimeout", "clearTimeout"] });
    const events: TrackEvent[] = [];
    mountRunner((e) => events.push(e));
    startDeck();
    const card = topCard();
    firePointer(card, "pointerdown", { clientX: 200, clientY: 100 });
    act(() => vi.advanceTimersByTime(200));
    firePointer(card, "pointermove", { clientX: 215, clientY: 100 });
    act(() => vi.advanceTimersByTime(200));
    firePointer(card, "pointermove", { clientX: 230, clientY: 100 });
    firePointer(card, "pointerup", { clientX: 230, clientY: 100 });
    vi.useRealTimers();
    // No commit: sheet stays closed, nothing recorded.
    expect(sheet().getAttribute("aria-hidden")).toBe("true");
    expect(events).toHaveLength(0);
  });

  it("verdict badges fade in with the drag offset and use option labels", () => {
    mountRunner(() => {});
    startDeck();
    const card = topCard();
    const right = container.querySelector<HTMLElement>('[data-testid="badge-right"]');
    expect(right?.textContent).toBe(items[0].options[1]);
    expect(Number(right?.style.opacity)).toBe(0);
    firePointer(card, "pointerdown", { clientX: 200, clientY: 100 });
    firePointer(card, "pointermove", { clientX: 256, clientY: 100 }); // +56px = half the line
    const rightAfter = container.querySelector<HTMLElement>('[data-testid="badge-right"]');
    expect(Number(rightAfter?.style.opacity)).toBeCloseTo(0.5, 1);
    firePointer(card, "pointerup", { clientX: 256, clientY: 100 });
  });
});

describe("deck structure", () => {
  it("shows the next cards behind the top card and the mapping legend", () => {
    act(() => {
      root.render(
        createElement(SwipeDeck, {
          item: items[0],
          nextItems: items.slice(1, 3),
          enabled: true,
          onChoose: () => {},
        }),
      );
    });
    // Top card + 2 stacked cards.
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(2);
    const text = container.textContent ?? "";
    expect(text).toContain(items[0].options[0]);
    expect(text).toContain(items[0].options[1]);
    expect(text).toContain("swipe or");
  });

  it("multi-option (provenance) items render option buttons, not a swipe surface", () => {
    const chosen: number[] = [];
    const prov = items.find((i) => i.options.length > 2)!;
    act(() => {
      root.render(
        createElement(SwipeDeck, {
          item: prov,
          nextItems: [],
          enabled: true,
          onChoose: (i: number) => chosen.push(i),
        }),
      );
    });
    expect(container.querySelector('[data-testid="badge-left"]')).toBeNull();
    clickByText(prov.options[1]);
    expect(chosen).toEqual([1]);
  });
});
