// @vitest-environment jsdom
/**
 * T3 reveal interstitial — regression tests.
 * Submit must show the reveal (caught X of Y over ALL planted errors, with
 * per-claim challenged/accepted/ignored stances) BEFORE onComplete fires;
 * onComplete fires exactly once from the reveal's continue button with the
 * unchanged artifact shape. Celebratory rendering appears only at X == Y.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TrackEvent } from "@ailx/core";
import { revealSummary } from "../src/reveal.js";
import { Runner } from "../src/Runner.js";
import type { T3CheckpointState } from "../src/checkpoint.js";
import { config } from "./fixtures.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe("revealSummary (pure)", () => {
  const surfaced = ["pe-figure", "pe-causal", "ca-cluster"];

  it("counts caught over ALL planted errors and labels each stance", () => {
    const s = revealSummary(config, surfaced, {
      "pe-figure": "challenged",
      "pe-causal": "accepted",
    });
    expect(s.total).toBe(config.plantedErrors.length); // Y = all planted, not just surfaced
    expect(s.caught).toBe(1);
    expect(s.perfect).toBe(false);
    const byId = Object.fromEntries(s.rows.map((r) => [r.id, r]));
    expect(byId["pe-figure"]).toMatchObject({ stance: "challenged", surfaced: true });
    expect(byId["pe-causal"]).toMatchObject({ stance: "accepted", surfaced: true });
    expect(byId["pe-citation"]).toMatchObject({ stance: "ignored", surfaced: false });
    // Truth text rides along for presentation.
    expect(byId["pe-figure"].truth).toContain("38 months");
  });

  it("perfect only when every planted error is challenged", () => {
    const all = Object.fromEntries(
      config.plantedErrors.map((e) => [e.id, "challenged" as const]),
    );
    expect(revealSummary(config, surfaced, all).perfect).toBe(true);
    expect(revealSummary({ plantedErrors: [] }, [], {}).perfect).toBe(false);
  });
});

// ---- Interactive: submit → reveal → continue → onComplete ----------------

const workCheckpoint: T3CheckpointState = {
  phase: "work",
  transcript: [
    { seq: 0, verb: "prompted", object: "prompt:1", text: "hi", clientTs: "t0" },
    { seq: 1, verb: "assisted", object: "assist:1", claimIds: ["pe-figure", "ca-cluster"], clientTs: "t1" },
    { seq: 2, verb: "challenged", object: "claim:pe-figure", clientTs: "t2" },
  ],
  messages: [
    { role: "user", text: "hi", claimIds: [], object: "prompt:1" },
    { role: "assistant", text: "reply", claimIds: ["pe-figure", "ca-cluster"], object: "assist:1" },
  ],
  draft: "My final position, defended.",
  savedDraft: "",
  stances: { "pe-figure": "challenged" },
  seq: 3,
  promptSeq: 1,
  draftRev: 0,
};

function buttons(container: HTMLElement): Record<string, HTMLButtonElement> {
  const out: Record<string, HTMLButtonElement> = {};
  for (const b of container.querySelectorAll("button")) out[b.textContent ?? ""] = b;
  return out;
}

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
});

function mount(checkpoint: T3CheckpointState, onComplete: (a: unknown) => void, onEvent: (e: TrackEvent) => void = () => {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      createElement(Runner, {
        attemptId: "a-1",
        locale: "en" as const,
        config,
        onEvent,
        onComplete,
        secondsRemaining: 900,
        checkpoint,
        onCheckpoint: () => {},
      }),
    ),
  );
  return container;
}

describe("T3 Runner reveal flow", () => {
  it("submit shows the reveal BEFORE onComplete; continue fires onComplete exactly once", () => {
    const onComplete = vi.fn();
    const events: TrackEvent[] = [];
    const c = mount(workCheckpoint, onComplete, (e) => events.push(e));

    act(() => buttons(c)["Submit final"].click());

    // Reveal is visible; artifact NOT yet delivered.
    expect(c.textContent).toContain("You caught 1 of 3 planted errors");
    expect(c.textContent).toContain("✓ challenged");
    expect(c.textContent).toContain("— ignored");
    expect(c.textContent).toContain("never surfaced in your chat");
    expect(onComplete).not.toHaveBeenCalled();
    // The submitted event was already captured (events unchanged by the reveal).
    expect(events.some((e) => e.verb === "submitted")).toBe(true);

    const cont = buttons(c)["Continue →"];
    act(() => cont.click());
    act(() => cont.click()); // double-click must not double-complete
    expect(onComplete).toHaveBeenCalledTimes(1);
    const artifact = onComplete.mock.calls[0][0] as { transcript: unknown[]; finalAnswer: string };
    expect(artifact.finalAnswer).toBe(workCheckpoint.draft);
    expect(Array.isArray(artifact.transcript)).toBe(true);
    expect((artifact.transcript as { verb: string }[]).some((t) => t.verb === "submitted")).toBe(true);
  });

  it("celebratory rendering when every planted error was challenged", () => {
    const onComplete = vi.fn();
    const c = mount(
      {
        ...workCheckpoint,
        stances: { "pe-figure": "challenged", "pe-causal": "challenged", "pe-citation": "challenged" },
      },
      onComplete,
    );
    act(() => buttons(c)["Submit final"].click());
    expect(c.textContent).toContain("You caught 3 of 3 planted errors");
    expect(c.textContent).toContain("Clean sweep");
    expect(c.textContent).toContain("🎉");
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("rehydrating into the reveal phase does not auto-fire onComplete", () => {
    const onComplete = vi.fn();
    const c = mount(
      { ...workCheckpoint, phase: "reveal", savedDraft: workCheckpoint.draft },
      onComplete,
    );
    expect(c.textContent).toContain("planted errors");
    expect(onComplete).not.toHaveBeenCalled();
    act(() => buttons(c)["Continue →"].click());
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect((onComplete.mock.calls[0][0] as { finalAnswer: string }).finalAnswer).toBe(workCheckpoint.draft);
  });
});
