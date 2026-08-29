// @vitest-environment jsdom
/**
 * Event-flow integration audit: every event a REAL Runner emits must be
 * persisted as a track_event — none silently dropped — including events a
 * runner's internal timer fires while the session is PAUSED (the runner
 * stays mounted under the pause veil). Also proves the T2 latency anchor:
 * latencyMs is measured from ITEM RENDER, not from deck start or track
 * start (fake timers make the expected value exact).
 *
 * The onEvent handler here replicates the exam page's semantics verbatim
 * (project → phase gate → monotonic stamp → budget gate → append).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { itemId, type TrackEvent } from "@ailx/core";
import {
  append, project, secondsRemaining, type SequencedEntry,
} from "@ailx/session";
import { Runner as T2Runner } from "@ailx/track-t2";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const BIN = ["Authentic / legitimate", "AI-generated / hostile"];

function ci(item: Record<string, unknown>) {
  return { ...item, id: itemId(item) };
}

/** Tiny 3-item deck: two 6 s timed items + one untimed provenance item. */
const items = [
  ci({
    type: "media-image", stem: "Camera-captured or AI-generated?",
    material: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
    options: [...BIN], key: 1, signal: 1, difficulty: 0.5, exposureSeconds: 6,
    rationale: "r1",
  }),
  ci({
    type: "message-email", stem: "Hostile attempt or legitimate communication?",
    material: "From: x@example.com",
    options: ["Legitimate", "Hostile"], key: 0, signal: 1, difficulty: 0.5, exposureSeconds: 6,
    rationale: "r2",
  }),
  ci({
    type: "provenance", stem: "What does a valid C2PA manifest establish?",
    material: "panel", options: ["a", "b", "c"], key: 1, difficulty: 0.5,
    rationale: "r3",
  }),
];
const t2cfg = { items, weights: { sensitivity: 60, calibration: 25, provenance: 15 } };

function clickByText(container: HTMLElement, text: string) {
  const btn = [...container.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === text,
  );
  if (!btn) throw new Error(`button "${text}" not found`);
  act(() => btn.click());
}

/** Confidence is scored, so it is never assumed: the slider must be moved
 *  before "Lock in" is enabled. */
function setConfidence(container: HTMLElement, value: number) {
  const slider = container.querySelector('input[type="range"]') as HTMLInputElement | null;
  if (!slider) throw new Error("confidence slider not found");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(slider, String(value));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("runner → session log event flow (audit: zero silent drops)", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"],
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("persists EVERY Runner emission — counts match, incl. a mid-pause lapse — with render-anchored latency", () => {
    // ---- Session harness: the exam page's exact onEvent semantics --------
    const T0 = Date.now();
    let log: SequencedEntry[] = append([], {
      type: "attempt_started", attemptId: "att-flow",
      config: { instrument: "ailx", version: "2026.1", locale: "en", budgets: { t1: 600, t2: 600, t3: 600, t4: 600 }, demo: true },
      ts: T0,
    });
    log = append(log, { type: "track_started", trackId: "t1", ts: T0 });
    log = append(log, { type: "track_completed", trackId: "t1", artifact: { html: "", promptLog: [], selfReport: "" }, timedOut: false, ts: T0 });
    log = append(log, { type: "track_started", trackId: "t2", ts: T0 });

    const emitted: TrackEvent[] = [];
    const phaseAtPersist: string[] = [];
    let completedArtifact: unknown;
    const stamp = () => Math.max(Date.now(), log[log.length - 1].ts);
    const onEvent = (event: TrackEvent) => {
      emitted.push(event);
      const cur = project(log);
      if ((cur.phase !== "in_track" && cur.phase !== "paused") || cur.currentTrack !== "t2") return;
      const ts = stamp();
      if (secondsRemaining(cur, "t2", ts) <= 0) return;
      log = append(log, { type: "track_event", trackId: "t2", event, ts });
      phaseAtPersist.push(cur.phase);
    };

    // ---- Mount the REAL T2 Runner ---------------------------------------
    act(() => {
      root.render(createElement(T2Runner, {
        attemptId: "att-flow", locale: "en" as const, config: t2cfg,
        onEvent, onComplete: (a: unknown) => { completedArtifact = a; },
        secondsRemaining: 600, checkpoint: undefined, onCheckpoint: () => {},
      }));
    });
    clickByText(container, "Start the deck");

    // Item 1 (timed): wait exactly 3 s from ITEM RENDER before answering.
    act(() => { vi.advanceTimersByTime(3000); });
    clickByText(container, "AI-generated / hostile");
    setConfidence(container, 70);
    clickByText(container, "Lock in");
    const r0 = (emitted[0] as { result?: { latencyMs?: number } }).result;
    expect(emitted[0].verb).toBe("responded");
    // Anchored at item render: exactly the 3 s that elapsed on this item —
    // NOT the time since deck start or track start.
    expect(r0?.latencyMs).toBeGreaterThanOrEqual(2900);
    expect(r0?.latencyMs).toBeLessThanOrEqual(3100);

    // Item 2 (timed): PAUSE the session, then let the 6 s exposure lapse.
    // The mounted runner's timer fires under the pause veil; the lapse
    // event must still be persisted (previously: silently dropped).
    log = append(log, { type: "paused", ts: stamp() });
    act(() => { vi.advanceTimersByTime(7000); });
    expect(emitted).toHaveLength(2);
    const r1 = (emitted[1] as { result?: { choice?: number; confidence?: number } }).result;
    expect(r1?.choice).toBe(-1);       // lapse recorded verbatim
    expect(r1?.confidence).toBe(0);
    log = append(log, { type: "resumed", ts: stamp() });
    // The lapse notice briefly disables the deck so a click meant for the
    // lapsed item cannot land on the next one — let it clear.
    act(() => { vi.advanceTimersByTime(2000); });

    // Item 3 (untimed provenance): answer normally.
    clickByText(container, "b");
    setConfidence(container, 40);
    clickByText(container, "Lock in");

    // Replay phase teaches all 3 items, then Finish emits "submitted".
    clickByText(container, "Next");
    clickByText(container, "Next");
    clickByText(container, "Finish track");

    // ---- Audit assertions ------------------------------------------------
    expect(completedArtifact).toBeDefined();
    const responses = (completedArtifact as { responses: unknown[] }).responses;
    expect(responses).toHaveLength(3);

    const persisted = log.filter((e) => e.type === "track_event");
    // ZERO silent drops: every emission is in the durable log.
    expect(emitted.length).toBe(4); // 3 responded + 1 submitted
    expect(persisted).toHaveLength(emitted.length);
    expect(persisted.map((e) => (e as { event: TrackEvent }).event.verb))
      .toEqual(["responded", "responded", "responded", "submitted"]);
    // The lapse was persisted WHILE PAUSED.
    expect(phaseAtPersist[1]).toBe("paused");
    // Log ↔ artifact consistency: every artifact response has a matching
    // persisted "responded" event, 1:1.
    const respondedEvents = persisted.filter((e) => (e as { event: TrackEvent }).event.verb === "responded");
    expect(respondedEvents).toHaveLength(responses.length);
  });
});
