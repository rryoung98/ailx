// @vitest-environment jsdom
/**
 * Per-claim stance controls (dogfood papercut 3): the Challenge/Accept
 * choice was a border tint only — invisible to a screen reader (no
 * aria-pressed) and nearly invisible on screen. It must now be exposed as
 * a toggle button pair and carry a non-colour visual cue.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TrackEvent } from "@ailx/core";
import { Runner } from "../src/Runner.js";
import type { T3CheckpointState } from "../src/checkpoint.js";
import { config } from "./fixtures.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const CLAIM = config.plantedErrors[0].id;

const workCheckpoint = (stances: Record<string, "challenged" | "accepted"> = {}): T3CheckpointState => ({
  phase: "work",
  transcript: [],
  messages: [
    { role: "user", text: "what does the source say?", claimIds: [], object: "prompt:1" },
    { role: "assistant", text: "here is my answer", claimIds: [CLAIM], object: "assist:1" },
  ],
  draft: "",
  savedDraft: "",
  stances,
  seq: 0,
  promptSeq: 1,
  draftRev: 0,
});

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
});

function mount(checkpoint: T3CheckpointState, onEvent: (e: TrackEvent) => void = () => {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      createElement(Runner, {
        attemptId: "a-stance",
        locale: "en" as const,
        config,
        onEvent,
        onComplete: () => {},
        secondsRemaining: 900,
        checkpoint,
        onCheckpoint: () => {},
      }),
    ),
  );
  return container;
}

function stanceBtn(c: HTMLElement, stance: "challenged" | "accepted"): HTMLButtonElement {
  const b = c.querySelector<HTMLButtonElement>(`[data-testid="stance-${stance}-${CLAIM}"]`);
  if (!b) throw new Error(`stance button ${stance} not found`);
  return b;
}

describe("T3 claim stance controls", () => {
  it("exposes both stances as unpressed toggle buttons before a choice", () => {
    const c = mount(workCheckpoint());
    for (const s of ["challenged", "accepted"] as const) {
      const b = stanceBtn(c, s);
      expect(b.getAttribute("aria-pressed")).toBe("false");
      expect(b.getAttribute("type")).toBe("button");
      // The claim itself names what the button acts on.
      expect(b.getAttribute("aria-describedby")).toBe(`claim-${CLAIM}`);
      expect(c.querySelector(`#claim-${CLAIM}`)!.textContent).toBe(config.plantedErrors[0].claim);
    }
  });

  it("marks the chosen stance aria-pressed and leaves the other unpressed", () => {
    const events: TrackEvent[] = [];
    const c = mount(workCheckpoint(), (e) => events.push(e));
    act(() => stanceBtn(c, "challenged").click());
    expect(stanceBtn(c, "challenged").getAttribute("aria-pressed")).toBe("true");
    expect(stanceBtn(c, "accepted").getAttribute("aria-pressed")).toBe("false");
    expect(events.some((e) => e.verb === "challenged" && e.object === `claim:${CLAIM}`)).toBe(true);
  });

  it("switches the pressed state when the opposite stance is chosen", () => {
    const c = mount(workCheckpoint());
    act(() => stanceBtn(c, "challenged").click());
    act(() => stanceBtn(c, "accepted").click());
    expect(stanceBtn(c, "challenged").getAttribute("aria-pressed")).toBe("false");
    expect(stanceBtn(c, "accepted").getAttribute("aria-pressed")).toBe("true");
  });

  it("gives the selected stance a filled, high-contrast face and a non-colour cue", () => {
    const c = mount(workCheckpoint());
    const before = stanceBtn(c, "challenged");
    expect(before.style.background).toBe("transparent");
    expect(before.textContent).toBe("Challenge");
    act(() => stanceBtn(c, "challenged").click());
    const after = stanceBtn(c, "challenged");
    expect(after.style.background).not.toBe("transparent");
    expect(after.style.color).toBe("rgb(255, 255, 255)");
    expect(after.style.fontWeight).toBe("700");
    // Check glyph: state is never signalled by colour alone (WCAG 1.4.1).
    expect(after.textContent).toBe("\u2713 Challenge");
    // The unchosen stance keeps the plain face.
    expect(stanceBtn(c, "accepted").textContent).toBe("Accept");
  });

  it("restores the pressed state from a resumed checkpoint", () => {
    const c = mount(workCheckpoint({ [CLAIM]: "accepted" }));
    expect(stanceBtn(c, "accepted").getAttribute("aria-pressed")).toBe("true");
    expect(stanceBtn(c, "accepted").textContent).toBe("\u2713 Accept");
    expect(stanceBtn(c, "challenged").getAttribute("aria-pressed")).toBe("false");
  });
});
