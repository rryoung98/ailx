// @vitest-environment jsdom
/**
 * P0 fairness: the post-deck replay is PRESENTATION. Every answer and every
 * latency is already recorded, and the replay is the one screen in T2 that
 * teaches — so it must tell the session engine to hold the track clock. A
 * real candidate was force-finished mid-replay with no notice at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Runner } from "../src/Runner.js";
import type { T2CheckpointState } from "../src/checkpoint.js";
import { config } from "./fixtures.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function mount(checkpoint: T2CheckpointState | undefined, onPresentation: (s: string | null) => void) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      createElement(Runner, {
        attemptId: "att-hold",
        locale: "en" as const,
        config,
        onEvent: () => {},
        onComplete: () => {},
        onPresentation,
        secondsRemaining: 300,
        checkpoint,
        onCheckpoint: () => {},
      }),
    ),
  );
  return container!;
}

function click(text: string) {
  const b = [...container!.querySelectorAll("button")].find((x) => (x.textContent ?? "").trim() === text);
  if (!b) throw new Error(`button "${text}" not found`);
  act(() => b.click());
}

const atReplay: T2CheckpointState = { phase: "replay", deckIndex: config.items.length, replayIdx: 0, responses: [] };

describe("T2 replay holds the track clock", () => {
  it("declares the replay screen on mount", () => {
    const onPresentation = vi.fn();
    const c = mount(atReplay, onPresentation);
    expect(c.textContent).toContain("how each call should be reasoned");
    expect(onPresentation).toHaveBeenCalledWith("t2-replay");
  });

  it("declares NOTHING while the candidate is still answering", () => {
    const onPresentation = vi.fn();
    mount(undefined, onPresentation);
    expect(onPresentation).toHaveBeenCalledWith(null);
    expect(onPresentation).not.toHaveBeenCalledWith("t2-replay");
    click("Start the deck");
    expect(onPresentation).not.toHaveBeenCalledWith("t2-replay");
  });

  it("releases the clock when the replay ends", () => {
    const onPresentation = vi.fn();
    mount({ ...atReplay, replayIdx: config.items.length - 1 }, onPresentation);
    onPresentation.mockClear();
    click("Finish track");
    expect(onPresentation).toHaveBeenLastCalledWith(null);
  });

  it("works when the platform provides no handler (static showcase)", () => {
    expect(() => mount(atReplay, undefined as unknown as () => void)).not.toThrow();
  });
});
