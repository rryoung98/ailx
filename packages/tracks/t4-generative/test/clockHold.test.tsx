// @vitest-environment jsdom
/**
 * P0 fairness: the T4 delivery gallery is presentation over an artifact that
 * is already fixed — the set is delivered, the note and disclosure recorded.
 * Nothing on it changes a scored input, so it must hold the track clock.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Runner } from "../src/Runner.js";
import type { T4CheckpointState } from "../src/checkpoint.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const working: T4CheckpointState = {
  drafts: [{ index: 0, prompt: "a boat", svg: "<svg>d0</svg>", clientTs: "t0" }],
  finals: {
    images: [
      { kind: "image", fromDraftIndex: 0, prompt: "a boat", asset: "<svg>f0</svg>", clientTs: "t2" },
    ],
  },
  chosenSet: [0],
  note: "Lead with the wave image.",
  disclosed: true,
  submitted: false,
};

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function mount(cp: T4CheckpointState, onPresentation: (s: string | null) => void) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      createElement(Runner, {
        attemptId: "a-1",
        locale: "en" as const,
        config: {},
        onEvent: () => {},
        onComplete: () => {},
        onPresentation,
        secondsRemaining: 3600,
        checkpoint: cp,
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

describe("T4 delivery gallery holds the track clock", () => {
  it("holds nothing while the candidate is working, and holds on delivery", () => {
    const onPresentation = vi.fn();
    const c = mount(working, onPresentation);
    expect(onPresentation).toHaveBeenCalledWith(null);
    expect(onPresentation).not.toHaveBeenCalledWith("t4-gallery");

    click("Direction note");
    click("Submit final set + note");
    expect(c.textContent).toContain("Final set");
    expect(onPresentation).toHaveBeenLastCalledWith("t4-gallery");
  });

  it("holds on mount when a delivered checkpoint is rehydrated after a reload", () => {
    const onPresentation = vi.fn();
    mount({ ...working, submitted: true }, onPresentation);
    expect(onPresentation).toHaveBeenCalledWith("t4-gallery");
  });

  it("works when the platform provides no handler (static showcase)", () => {
    expect(() => mount({ ...working, submitted: true }, undefined as unknown as () => void)).not.toThrow();
  });
});
