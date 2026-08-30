// @vitest-environment jsdom
/**
 * P0 fairness: the T3 reveal says of itself that it is "presentation, not
 * scoring" — the transcript and stances behind it are already stored. It
 * must hold the track clock, or the watchdog can eject a candidate who is
 * reading which planted errors they missed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Runner } from "../src/Runner.js";
import type { T3CheckpointState } from "../src/checkpoint.js";
import { config } from "./fixtures.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const working: T3CheckpointState = {
  phase: "work",
  transcript: [],
  messages: [],
  draft: "My final position, defended.",
  savedDraft: "",
  stances: { "pe-figure": "challenged" },
  seq: 0,
  promptSeq: 0,
  draftRev: 0,
};

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function mount(checkpoint: T3CheckpointState, onPresentation: (s: string | null) => void) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      createElement(Runner, {
        attemptId: "a-1",
        locale: "en" as const,
        config,
        onEvent: () => {},
        onComplete: () => {},
        onPresentation,
        secondsRemaining: 900,
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

describe("T3 reveal holds the track clock", () => {
  it("holds nothing while the candidate is working, and holds on submit", () => {
    const onPresentation = vi.fn();
    const c = mount(working, onPresentation);
    expect(onPresentation).toHaveBeenCalledWith(null);
    expect(onPresentation).not.toHaveBeenCalledWith("t3-reveal");

    click("Submit final");
    expect(c.textContent).toContain("planted errors");
    expect(onPresentation).toHaveBeenLastCalledWith("t3-reveal");
  });

  it("holds on mount when a reveal is rehydrated after a reload", () => {
    const onPresentation = vi.fn();
    mount({ ...working, phase: "reveal", savedDraft: working.draft }, onPresentation);
    expect(onPresentation).toHaveBeenCalledWith("t3-reveal");
  });

  it("works when the platform provides no handler (static showcase)", () => {
    expect(() => mount({ ...working, phase: "reveal" }, undefined as unknown as () => void)).not.toThrow();
  });
});
