// @vitest-environment jsdom
/**
 * T3 source-document visibility — regression for the user report
 * "the source/reading text does not show". The source document must be
 * VISIBLE in the work layout by default (not hidden behind a button),
 * scrollable, collapsible, and "Verify against source" stays the
 * instrumented verification act (emits a 'verified' event).
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TrackEvent } from "@ailx/core";
import { Runner } from "../src/Runner.js";
import type { T3CheckpointState } from "../src/checkpoint.js";
import { config } from "./fixtures.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const workCheckpoint: T3CheckpointState = {
  phase: "work",
  transcript: [],
  messages: [],
  draft: "",
  savedDraft: "",
  stances: {},
  seq: 0,
  promptSeq: 0,
  draftRev: 0,
};

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
});

function mount(onEvent: (e: TrackEvent) => void = () => {}) {
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
        onComplete: () => {},
        secondsRemaining: 900,
        checkpoint: workCheckpoint,
        onCheckpoint: () => {},
      }),
    ),
  );
  return container;
}

function btn(c: HTMLElement, text: string): HTMLButtonElement {
  const b = [...c.querySelectorAll("button")].find((x) => (x.textContent ?? "").trim() === text);
  if (!b) throw new Error(`button "${text}" not found`);
  return b as HTMLButtonElement;
}

describe("T3 source document panel", () => {
  it("renders the source text VISIBLY in the work layout without any click", () => {
    const c = mount();
    const panel = c.querySelector('section[aria-label="Source document"]');
    expect(panel, "source panel must be in the layout").not.toBeNull();
    expect(panel!.textContent).toContain(config.sourceTitle);
    // The actual reading text is present, including the trap-bearing figure.
    expect(panel!.textContent).toContain("38 months");
    expect(panel!.textContent).toContain(config.sourceExcerpt.slice(0, 60));
  });

  it("is collapsible and re-expandable", () => {
    const c = mount();
    act(() => btn(c, "Collapse").click());
    expect(c.textContent).not.toContain("38 months in 2025");
    act(() => btn(c, "Expand source").click());
    expect(c.textContent).toContain("38 months in 2025");
  });

  it("'Verify against source' emits an instrumented 'verified' event and reopens the panel", () => {
    const events: TrackEvent[] = [];
    const c = mount((e) => events.push(e));
    act(() => btn(c, "Collapse").click());
    act(() => btn(c, "Verify against source").click());
    expect(events.some((e) => e.verb === "verified" && e.object === "source")).toBe(true);
    expect(c.textContent).toContain("38 months in 2025");
  });

  it("scenario is the trilateral memorandum with the pinned numeric traps intact", () => {
    expect(config.sourceTitle).toContain("Trilateral AI Workforce Readiness Memorandum");
    const ids = [...config.plantedErrors.map((e) => e.id), ...config.correctAdvice.map((a) => a.id)];
    expect(ids).toEqual(["pe-figure", "pe-causal", "pe-citation", "ca-cluster", "ca-equity"]);
    const figure = config.plantedErrors.find((e) => e.id === "pe-figure")!;
    expect(figure.claim).toContain("61 months");
    expect(figure.truth).toContain("38 months");
    expect(config.sourceExcerpt).toContain("38 months");
    expect(config.sourceExcerpt).toContain("41%");
    expect(config.sourceExcerpt).toContain("62% to 29%");
    expect(config.sourceExcerpt).toContain("18%");
  });
});
