// @vitest-environment jsdom
/**
 * T4 finals gallery — regression tests.
 * Submit must open the presentation-only gallery (chosen finals large,
 * drafts filmstrip, disclosure badge, direction-note caption) BEFORE
 * onComplete fires; deliver fires onComplete exactly once with the
 * unchanged artifact shape. Rehydrating a submitted checkpoint reopens the
 * gallery without auto-completing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TrackEvent } from "@ailx/core";
import { Runner } from "../src/Runner.js";
import { decodeT4Checkpoint, encodeT4Checkpoint, type T4CheckpointState } from "../src/checkpoint.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const checkpoint: T4CheckpointState = {
  drafts: [
    { index: 0, prompt: "a boat", svg: "<svg>d0</svg>", clientTs: "t0" },
    { index: 1, prompt: "three boats on a wave", svg: "<svg>d1</svg>", clientTs: "t1" },
  ],
  finals: {
    images: [
      { kind: "image", fromDraftIndex: 1, prompt: "three boats on a wave", asset: "<svg>f0</svg>", clientTs: "t2" },
      { kind: "image", fromDraftIndex: 0, prompt: "a boat", asset: "<svg>f1</svg>", clientTs: "t3" },
    ],
    video: { kind: "video", fromDraftIndex: 1, prompt: "three boats on a wave", asset: "<svg>v</svg>", clientTs: "t4" },
  },
  chosenSet: [0],
  note: "Lead with the wave image; the star anchors the eye.",
  disclosed: true,
  submitted: false,
};

function buttons(c: HTMLElement): Record<string, HTMLButtonElement> {
  const out: Record<string, HTMLButtonElement> = {};
  for (const b of c.querySelectorAll("button")) out[b.textContent ?? ""] = b;
  return out;
}

let reactRoot: Root | null = null;
afterEach(() => {
  if (reactRoot) act(() => reactRoot!.unmount());
  reactRoot = null;
});

function mount(cp: T4CheckpointState, onComplete: (a: unknown) => void, onEvent: (e: TrackEvent) => void = () => {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  reactRoot = createRoot(container);
  act(() =>
    reactRoot!.render(
      createElement(Runner, {
        attemptId: "a-1",
        locale: "en" as const,
        config: {},
        onEvent,
        onComplete,
        secondsRemaining: 3600,
        checkpoint: cp,
        onCheckpoint: () => {},
      }),
    ),
  );
  return container;
}

describe("T4 finals gallery flow", () => {
  it("submit opens the gallery BEFORE onComplete; deliver completes exactly once with the unchanged artifact", () => {
    const onComplete = vi.fn();
    const events: TrackEvent[] = [];
    const c = mount(checkpoint, onComplete, (e) => events.push(e));

    act(() => buttons(c)["Direction note"].click());
    act(() => buttons(c)["Submit final set + note"].click());

    // Gallery is visible; artifact NOT yet delivered.
    expect(c.textContent).toContain("Final set");
    expect(c.textContent).toContain("CHOSEN FINAL #1");
    expect(c.textContent).not.toContain("CHOSEN FINAL #2"); // only the chosen set is large
    expect(c.textContent).toContain("FINAL VIDEO");
    expect(c.textContent).toContain("AI-GENERATED · DISCLOSED");
    expect(c.textContent).toContain("Direction note");
    expect(c.textContent).toContain(checkpoint.note);
    expect(c.textContent).toContain("Drafts — the road to the final set");
    expect(onComplete).not.toHaveBeenCalled();
    // The submitted event was already captured (events unchanged by the gallery).
    expect(events.filter((e) => e.verb === "submitted")).toHaveLength(1);

    const deliverBtn = buttons(c)["Deliver final set →"];
    act(() => deliverBtn.click());
    act(() => deliverBtn.click()); // double-click must not double-complete
    expect(onComplete).toHaveBeenCalledTimes(1);
    // Artifact shape is exactly what submit() has always produced.
    expect(onComplete.mock.calls[0][0]).toEqual({
      drafts: checkpoint.drafts,
      finals: checkpoint.finals,
      chosenSet: [0],
      note: checkpoint.note,
      disclosed: true,
    });
  });

  it("shows the no-disclosure badge when disclosure is off", () => {
    const c = mount({ ...checkpoint, disclosed: false }, vi.fn());
    act(() => buttons(c)["Direction note"].click());
    act(() => buttons(c)["Submit final set + note"].click());
    expect(c.textContent).toContain("NO DISCLOSURE ATTACHED");
    expect(c.textContent).not.toContain("AI-GENERATED · DISCLOSED");
  });

  it("rehydrating a submitted checkpoint reopens the gallery without auto-completing", () => {
    const onComplete = vi.fn();
    const c = mount({ ...checkpoint, submitted: true }, onComplete);
    expect(c.textContent).toContain("Final set");
    expect(c.textContent).toContain("presentation only");
    expect(onComplete).not.toHaveBeenCalled();
    act(() => buttons(c)["Deliver final set →"].click());
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("empty chosenSet falls back to every final image in the gallery and artifact", () => {
    const onComplete = vi.fn();
    const c = mount({ ...checkpoint, chosenSet: [] }, onComplete);
    act(() => buttons(c)["Direction note"].click());
    act(() => buttons(c)["Submit final set + note"].click());
    expect(c.textContent).toContain("CHOSEN FINAL #1");
    expect(c.textContent).toContain("CHOSEN FINAL #2");
    act(() => buttons(c)["Deliver final set →"].click());
    expect((onComplete.mock.calls[0][0] as { chosenSet: number[] }).chosenSet).toEqual([0, 1]);
  });
});

describe("T4 checkpoint submitted flag", () => {
  it("round-trips submitted and defaults to false for legacy checkpoints", () => {
    const enc = encodeT4Checkpoint({ ...checkpoint, submitted: true });
    expect(decodeT4Checkpoint(JSON.parse(JSON.stringify(enc)))?.submitted).toBe(true);
    const legacy: Record<string, unknown> = { ...checkpoint };
    delete legacy.submitted;
    expect(decodeT4Checkpoint(JSON.parse(JSON.stringify(legacy)))?.submitted).toBe(false);
  });
});

describe("T4 gallery a11y", () => {
  it("moves focus to the gallery heading on submit (focus management)", () => {
    const c = mount(checkpoint, vi.fn());
    act(() => buttons(c)["Direction note"].click());
    act(() => buttons(c)["Submit final set + note"].click());
    const heading = [...c.querySelectorAll("h2")].find((h) =>
      (h.textContent ?? "").includes("Final set"),
    );
    expect(heading).toBeDefined();
    expect(heading!.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(heading);
  });
});
