// @vitest-environment jsdom
/**
 * T2's fixed exposure is a WALL-CLOCK window, not a count of interval ticks
 * (TEN-231).
 *
 * A background tab is throttled to roughly one timer tick a minute, so an
 * exposure counted in ticks stretches to whatever the tab was allowed to run
 * while the decision latency beside it stayed wall clock. The two must agree,
 * because the exposure is a controlled measurement condition: a candidate who
 * switches tabs may not silently get a longer look.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TrackEvent } from "@ailx/core";
import { Runner } from "../src/Runner.js";
import { config, items } from "./fixtures.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const EXPOSURE_MS = items[0].exposureSeconds! * 1000;

let container: HTMLElement;
let root: Root;
let events: TrackEvent[];
/** Wall-clock time the tab spent throttled: real seconds, no timer ticks. */
let skew = 0;

beforeEach(() => {
  // Timers AND `performance` are faked, so the only way time moves is the
  // way this test moves it: `tick()` runs timers, `backgrounded()` does not.
  vi.useFakeTimers({
    toFake: ["performance", "Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  skew = 0;
  const faked = performance.now.bind(performance);
  vi.spyOn(performance, "now").mockImplementation(() => faked() + skew);
  events = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function mount() {
  act(() => {
    root.render(
      createElement(Runner, {
        attemptId: "att-throttle",
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
  const start = [...container.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === "Start the deck",
  )!;
  act(() => start.click());
  const img = container.querySelector<HTMLImageElement>('[data-testid="top-card"] img');
  if (img) act(() => img.dispatchEvent(new Event("load")));
}

/** Time passes for the world; no timer is allowed to run. */
function backgrounded(ms: number) {
  skew += ms;
}

/** One tick gets through — what a throttled tab gives about once a minute. */
function tick(ms = 1000) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

const responded = () => events.filter((e) => e.verb === "responded");

describe("T2 exposure is wall clock, not ticks", () => {
  it("lapses on the first tick after the window has really passed", () => {
    mount();
    backgrounded(EXPOSURE_MS + 5_000);
    expect(responded()).toHaveLength(0); // nothing ran: no tick, no render
    tick();
    expect(responded()).toHaveLength(1);
    const r = responded()[0].result as { choice: number; itemId: string };
    expect(r.choice).toBe(-1);
    expect(r.itemId).toBe(items[0].id);
  });

  it("does not lapse early: ticks alone never outrun the wall clock", () => {
    mount();
    // Every tick fires, but the clock is frozen one second short of the
    // window. A tick-counting countdown would have lapsed here.
    const faked = performance.now.bind(performance);
    vi.spyOn(performance, "now").mockImplementation(() => Math.min(faked(), EXPOSURE_MS - 1_000));
    tick(EXPOSURE_MS + 5_000);
    expect(responded()).toHaveLength(0);
  });
});
