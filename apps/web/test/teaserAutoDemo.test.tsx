// @vitest-environment jsdom
/**
 * Teaser auto-demo timer: after ~4 s of no interaction the top card
 * demo-swipes itself (toward the CORRECT side) and springs back without
 * consuming the card; any interaction stops the demo forever; reduced
 * motion never demos at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Teaser, AUTO_DEMO_DELAY_MS } from "../features/landing/Teaser";
import { TEASER_ITEMS } from "../lib/instrument/demoItems";
import { DEMO_HOLD_MS, DEMO_OUT_MS, DEMO_RETURN_MS, FLING_MS } from "../features/landing/useSwipeCard";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;

function setMatchMedia(reduced: boolean) {
  (window as unknown as { matchMedia: (q: string) => Partial<MediaQueryList> }).matchMedia =
    (query: string) => ({ matches: reduced && query.includes("prefers-reduced-motion"), media: query });
}

beforeEach(() => {
  vi.useFakeTimers();
  setMatchMedia(false);
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host.remove();
  vi.useRealTimers();
});

function render() {
  root = createRoot(host);
  act(() => { root!.render(createElement(Teaser)); });
}

const group = () => host.querySelector('[data-demo]') as HTMLElement;

describe("teaser idle auto-demo", () => {
  it("demo-swipes toward the correct side after the idle delay, then springs back", () => {
    render();
    expect(group().getAttribute("data-demo")).toBe("false");

    act(() => { vi.advanceTimersByTime(AUTO_DEMO_DELAY_MS + 10); });
    expect(group().getAttribute("data-demo")).toBe("true");

    // Correct side: first item is synthetic → right, authentic → left.
    const card = host.querySelector('[data-top="true"]') as HTMLElement;
    const dx = /translateX\(([-\d.]+)px\)/.exec(card.style.transform)?.[1];
    expect(dx).toBeDefined();
    const expectRight = TEASER_ITEMS[0].key === "synthetic";
    expect(Number(dx) > 0).toBe(expectRight);

    // The demo returns without consuming the card (still 1 / 3).
    act(() => { vi.advanceTimersByTime(DEMO_OUT_MS + DEMO_HOLD_MS + DEMO_RETURN_MS + 20); });
    expect(group().getAttribute("data-demo")).toBe("false");
    expect(host.textContent).toContain("1 / 3");
  });

  it("stops forever once the user interacts", () => {
    render();
    const btn = host.querySelectorAll("button")[0] as HTMLButtonElement;
    act(() => { btn.click(); });                     // interaction: answers card 1
    act(() => { vi.advanceTimersByTime(FLING_MS + 10); });
    expect(group().getAttribute("data-interacted")).toBe("true");
    expect(host.textContent).toContain("2 / 3");

    act(() => { vi.advanceTimersByTime(60_000); });  // idle for a full minute
    expect(group().getAttribute("data-demo")).toBe("false");
  });

  it("never demos under prefers-reduced-motion", () => {
    setMatchMedia(true);
    render();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(group().getAttribute("data-demo")).toBe("false");
  });

  it("arrow keys fling and commit an answer", () => {
    render();
    const correctLeft = TEASER_ITEMS[0].key === "authentic";
    act(() => {
      group().dispatchEvent(new KeyboardEvent("keydown", {
        key: correctLeft ? "ArrowLeft" : "ArrowRight", bubbles: true,
      }));
    });
    act(() => { vi.advanceTimersByTime(FLING_MS + 10); });
    expect(host.textContent).toContain("✓ caught it.");
    expect(host.textContent).toContain("2 / 3");
  });
});
