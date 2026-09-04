// @vitest-environment jsdom
/**
 * TEN-115: a pause the candidate was INVITED to take must not cost them a
 * scored item.
 *
 * T2 exposes each timed item for a fixed number of seconds on its own
 * interval. That interval used to keep ticking behind the pause veil, so the
 * item on screen lapsed, was recorded as `choice: -1` (a miss on a signal
 * item, a false alarm on a noise item) and the 1600 ms lapse notice expired
 * unseen — while the pause dialog said "your work is kept".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Runner as T2Runner } from "@ailx/track-t2";
import {
  ATTEMPT_KEY, append, project, saveAttempt,
  type SequencedEntry, type SessionConfig,
} from "@ailx/session";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../lib/instrument/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/instrument/registry")>();
  return { ...actual, loadTrackModule: async () => ({ placeholder: false, Runner: T2Runner }) };
});

const ExamPage = (await import("../app/exam/page")).default;

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => { m.delete(k); },
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
  } as Storage;
}

const config: SessionConfig = {
  instrument: "ailx", version: "2026.1", locale: "en",
  budgets: { t1: 600, t2: 600, t3: 600, t4: 600 }, demo: true,
};

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  const ts = Date.now();
  let log = append([], { type: "attempt_started", attemptId: "att-t2pause", config, ts });
  log = append(log, { type: "track_started", trackId: "t1", ts });
  log = append(log, { type: "track_completed", trackId: "t1", artifact: {}, timedOut: false, ts });
  log = append(log, { type: "track_started", trackId: "t2", ts });
  saveAttempt(window.localStorage, log);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function mountExam() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(ExamPage)); });
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

function button(label: string): HTMLButtonElement | undefined {
  return [...host!.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  ) as HTMLButtonElement | undefined;
}

async function click(label: string) {
  const btn = button(label);
  expect(btn, `button ${label}`).toBeTruthy();
  await act(async () => { btn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

/**
 * Fake time in 1 s steps. One long jump runs the interval callbacks but
 * never re-renders between them, so the lapse effect would not fire and the
 * test would pass for the wrong reason.
 */
async function advance(ms: number) {
  for (let left = ms; left > 0; left -= 1000) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(1000, left)); });
  }
}

function storedEvents(): { verb: string; result?: unknown }[] {
  const raw = window.localStorage.getItem(ATTEMPT_KEY);
  if (!raw) return [];
  const state = project((JSON.parse(raw) as { log: SequencedEntry[] }).log);
  return state.tracks.t2.events as { verb: string; result?: unknown }[];
}

describe("pausing during a timed T2 item", () => {
  it("stops the exposure clock: no lapse is recorded while paused", async () => {
    await mountExam();
    await click("Start the deck");
    await click("Pause");
    // A minute behind the veil — several exposures' worth.
    await advance(60_000);

    const responded = storedEvents().filter((e) => e.verb === "responded");
    expect(
      responded.map((e) => (e.result as { choice?: number } | undefined)?.choice),
      "a pause must not answer the item on the candidate's behalf",
    ).not.toContain(-1);
    expect(responded, "no response at all is recorded during a pause").toHaveLength(0);
  });

  it("gives the item back with its exposure still running after Resume", async () => {
    await mountExam();
    await click("Start the deck");
    await click("Pause");
    await advance(60_000);
    await click("Resume track");
    await advance(1_000);
    expect(storedEvents().filter((e) => e.verb === "responded")).toHaveLength(0);
    // The countdown is live again, so the item is still sittable.
    expect(host!.textContent).toMatch(/\d+s/);
  });
});
