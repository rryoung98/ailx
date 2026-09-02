// @vitest-environment jsdom
/**
 * Timed-exposure lapse feedback (dogfood papercut 1): when the clock runs
 * out the deck used to advance silently, so the click aimed at the lapsed
 * item landed on the next one. Now the lapse is announced and the deck is
 * inert until the notice clears.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TrackEvent } from "@ailx/core";
import { Runner } from "../src/Runner.js";
import type { T2Config } from "../src/types.js";
import { config, items } from "./fixtures.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** Mirrors LAPSE_NOTICE_MS in the Runner. */
const NOTICE_MS = 1600;
const EXPOSURE_MS = items[0].exposureSeconds! * 1000;

let container: HTMLElement;
let root: Root;
let events: TrackEvent[];

beforeEach(() => {
  vi.useFakeTimers();
  events = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function mount(cfg: T2Config = config) {
  act(() => {
    root.render(
      createElement(Runner, {
        attemptId: "att-lapse",
        locale: "en" as const,
        config: cfg,
        onEvent: (e: TrackEvent) => events.push(e),
        onComplete: () => {},
        secondsRemaining: 600,
        checkpoint: undefined,
        onCheckpoint: () => {},
      }),
    );
  });
  clickByText("Start the deck");
}

function buttons(): HTMLButtonElement[] {
  return [...container.querySelectorAll("button")];
}

function clickByText(text: string) {
  const btn = buttons().find((b) => (b.textContent ?? "").trim() === text);
  if (!btn) throw new Error(`button "${text}" not found`);
  act(() => btn.click());
}

function answerButtons(): HTMLButtonElement[] {
  return buttons().filter((b) => b.className.includes("t2-answer-btn"));
}

function notice(): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="lapse-notice"]');
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/**
 * The picture painted. jsdom loads no images, so the load event that anchors
 * a T2 exposure has to be raised by hand — the exposure starts here, not at
 * mount, and that is the point of the anchor (docs/SAMPLING.md §6.1).
 */
function paint() {
  const img = container.querySelector<HTMLImageElement>('[data-testid="top-card"] img');
  if (img) act(() => img.dispatchEvent(new Event("load")));
}

function responded(): TrackEvent[] {
  return events.filter((e) => e.verb === "responded");
}

describe("T2 exposure lapse feedback", () => {
  it("announces the lapse and records no response for the missed item", () => {
    mount();
    paint();
    advance(EXPOSURE_MS);
    const n = notice();
    expect(n, "lapse notice").not.toBeNull();
    expect(n!.getAttribute("role")).toBe("alert");
    expect(n!.textContent).toContain("Item 1 missed");
    expect(n!.textContent).toContain("no response was recorded");
    expect(responded()).toHaveLength(1);
    const r = responded()[0].result as { choice: number; confidence: number; itemId: string };
    expect(r.choice).toBe(-1);
    expect(r.confidence).toBe(0);
    expect(r.itemId).toBe(items[0].id);
  });

  it("blocks the stale click: answer buttons and arrow keys are inert during the notice", () => {
    mount();
    paint();
    advance(EXPOSURE_MS);
    // aria-disabled, never `disabled`: a disabled control drops focus to
    // <body> (audit P0-2), so the deck is made inert without losing focus.
    for (const b of answerButtons()) {
      expect(b.getAttribute("aria-disabled")).toBe("true");
      expect(b.disabled).toBe(false);
    }
    act(() => answerButtons()[1].click());
    act(() => {
      container
        .querySelector('[data-testid="swipe-deck"]')!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    // Nothing beyond the lapse itself, and no confidence sheet opened.
    expect(responded()).toHaveLength(1);
    expect(container.textContent).toContain("Your call: —");
  });

  it("clears the notice and re-enables the deck, giving the next item a full exposure", () => {
    mount();
    paint();
    advance(EXPOSURE_MS);
    advance(NOTICE_MS);
    paint();
    expect(notice()).toBeNull();
    for (const b of answerButtons()) expect(b.getAttribute("aria-disabled")).toBe("false");
    expect(container.textContent).toContain("Item 2 / ");
    // The clock only starts once the notice is gone: one tick short of the
    // exposure the second item is still live.
    advance(EXPOSURE_MS - 1000);
    expect(responded()).toHaveLength(1);
    advance(1000);
    expect(responded()).toHaveLength(2);
    expect(notice()!.textContent).toContain("Item 2 missed");
  });

  it("handles a zero-second exposure (lapses immediately, still announced)", () => {
    const zero: T2Config = {
      ...config,
      items: [{ ...items[0], exposureSeconds: 0 }, ...items.slice(1)],
    };
    mount(zero);
    paint();
    advance(0);
    expect(notice()!.textContent).toContain("Item 1 missed");
    expect(responded()).toHaveLength(1);
    expect((responded()[0].result as { choice: number }).choice).toBe(-1);
  });

  it("does not fire for an untimed (provenance) item", () => {
    const untimedFirst: T2Config = {
      ...config,
      items: [items.find((i) => i.type === "provenance")!, items[0]],
    };
    mount(untimedFirst);
    advance(60_000);
    expect(notice()).toBeNull();
    expect(responded()).toHaveLength(0);
    expect(container.textContent).toContain("untimed");
  });
});
