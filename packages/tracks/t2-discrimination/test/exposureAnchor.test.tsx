// @vitest-environment jsdom
/**
 * WHERE THE T2 EXPOSURE STARTS, AND WHY A SLOW PHONE MUST NOT LOSE ANY OF IT.
 *
 * T2 shows timed material for a declared number of seconds. If that clock
 * starts when React selects the item rather than when the picture paints,
 * the exposure a candidate actually gets is the declared exposure minus the
 * device's paint time — and paint time tracks handset price. Nicosia et al.
 * (Behavior Research Methods 2023;55(6):2800-2812, DOI
 * 10.3758/s13428-022-01925-1) measured 35-140 ms of display-plus-touch
 * latency across 26 phones and about 105 ms of spread across a full
 * bring-your-own-device study; image decode on a cheap handset is larger
 * again. Swaroop et al. (arXiv:2306.07458) found accuracy falls under a
 * visible timer, so unequal exposure is not a neutral difference — it moves
 * the score. docs/SAMPLING.md §6.1.
 *
 * The rule this file pins: the countdown starts when the stimulus is
 * visible, and the safety net that stops a hung item may only ever DELAY the
 * start, never shorten the exposure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TrackEvent } from "@ailx/core";
import { Runner } from "../src/Runner.js";
import type { T2Config } from "../src/types.js";
import { config, items } from "./fixtures.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** Mirrors the Runner's unanchored-item safety net. */
const SAFETY_NET_MS = 1500;
const IMAGE_ITEM = items.find((i) => i.type === "media-image")!;
const TEXT_ITEM = items.find((i) => i.type === "message-email")!;
const EXPOSURE_MS = IMAGE_ITEM.exposureSeconds! * 1000;

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

function mount(cfg: T2Config) {
  act(() => {
    root.render(
      createElement(Runner, {
        attemptId: "att-anchor",
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
  const start = [...container.querySelectorAll("button")]
    .find((b) => (b.textContent ?? "").trim() === "Start the deck");
  act(() => start!.click());
}

/** One image item, then a text item so the deck does not end on item 1. */
const oneImage: T2Config = { ...config, items: [IMAGE_ITEM, TEXT_ITEM] };

function advance(ms: number) {
  act(() => vi.advanceTimersByTime(ms));
}

/** The picture painted. jsdom loads no images, so `load` is raised by hand. */
function paint() {
  const img = container.querySelector<HTMLImageElement>('[data-testid="top-card"] img');
  expect(img, "top card image").not.toBeNull();
  act(() => img!.dispatchEvent(new Event("load")));
}

function responded(): TrackEvent[] {
  return events.filter((e) => e.verb === "responded");
}

function answerButtons(): HTMLButtonElement[] {
  return [...container.querySelectorAll("button")].filter((b) => b.className.includes("t2-answer-btn"));
}

describe("T2 exposure anchors on the stimulus, not on the render", () => {
  it("does not run the clock while the card is still blank", () => {
    mount(oneImage);
    // Just short of the safety net, with no picture yet: nothing has elapsed.
    advance(SAFETY_NET_MS - 1);
    paint();
    advance(EXPOSURE_MS - 1000);
    expect(responded(), "still live: the exposure started at the paint").toHaveLength(0);
    advance(1000);
    expect(responded()).toHaveLength(1);
    expect((responded()[0].result as { choice: number }).choice).toBe(-1);
  });

  it("a late paint restarts the exposure at its declared length", () => {
    mount(oneImage);
    // The safety net anchors provisionally at 1500ms and the clock starts on
    // a blank card. Two seconds later the picture arrives.
    advance(SAFETY_NET_MS + 2000);
    expect(responded(), "no lapse yet").toHaveLength(0);
    paint();
    // The candidate now gets the WHOLE declared exposure, not what was left.
    advance(EXPOSURE_MS - 1000);
    expect(responded()).toHaveLength(0);
    advance(1000);
    expect(responded()).toHaveLength(1);
  });

  it("still ends the item when the load event never arrives", () => {
    mount(oneImage);
    advance(SAFETY_NET_MS);
    advance(EXPOSURE_MS);
    expect(responded(), "the safety net kept the deck moving").toHaveLength(1);
  });

  it("a paint after the verdict neither extends the item nor rewrites the latency", () => {
    let t = 0;
    vi.spyOn(performance, "now").mockImplementation(() => t);
    mount(oneImage);
    // No picture: the safety net anchors on the blank card at 1500ms.
    t = SAFETY_NET_MS;
    advance(SAFETY_NET_MS);
    t = SAFETY_NET_MS + 900; // the candidate calls it after 900ms
    act(() => {
      answerButtons()[0].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }),
      );
    });
    // The picture arrives late, after the call. Re-anchoring here would hand
    // out a fresh exposure on an item already judged and would overwrite the
    // decision latency with the wait for the image.
    t = 9000;
    paint();
    const slider = container.querySelector<HTMLInputElement>('input[type="range"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(slider, "70");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const lock = [...container.querySelectorAll("button")]
      .find((b) => (b.textContent ?? "").includes("Lock in"))!;
    act(() => lock.click());
    expect(responded()).toHaveLength(1);
    expect((responded()[0].result as { latencyMs: number }).latencyMs).toBe(900);
    // And the deck moved on rather than sitting on a re-anchored item.
    expect(container.textContent).toContain("Item 2 / ");
  });

  it("a text stimulus is visible on commit and needs no paint", () => {
    mount({ ...config, items: [TEXT_ITEM, IMAGE_ITEM] });
    advance(TEXT_ITEM.exposureSeconds! * 1000);
    expect(responded()).toHaveLength(1);
  });
});
