// @vitest-environment jsdom
/**
 * Integration: the REAL T2 Runner inside the REAL exam page.
 *
 * The unit tests for the clock hold drove a mocked runner, which hid a
 * production failure: on staging the replay still ran the clock down and
 * ejected the reader. This test mounts the actual T2 Runner through the
 * page's own props so the whole chain — runner effect → onPresentation →
 * pause(reason) → held clock — is exercised end to end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Runner as T2Runner } from "@ailx/track-t2";
import {
  ATTEMPT_KEY, append, project, saveAttempt,
  type SequencedEntry, type SessionConfig,
} from "@ailx/session";
import { saveCheckpoint } from "../lib/checkpoints";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../lib/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/registry")>();
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
  budgets: { t1: 600, t2: 300, t3: 600, t4: 600 }, demo: true,
};

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  const ts = Date.now();
  let log = append([], { type: "attempt_started", attemptId: "att-t2", config, ts });
  log = append(log, { type: "track_started", trackId: "t1", ts });
  log = append(log, { type: "track_completed", trackId: "t1", artifact: {}, timedOut: false, ts });
  log = append(log, { type: "track_started", trackId: "t2", ts });
  saveAttempt(window.localStorage, log);
  // The candidate has answered the deck and is on the replay.
  saveCheckpoint(window.localStorage, "att-t2", "t2", {
    phase: "replay", deckIndex: 6, replayIdx: 0, responses: [],
  });
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
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

function timerText(): string {
  return host!.querySelector('[role="timer"]')!.textContent ?? "";
}

function storedLog(): SequencedEntry[] {
  return (JSON.parse(window.localStorage.getItem(ATTEMPT_KEY)!) as { log: SequencedEntry[] }).log;
}

describe("the real T2 replay inside the real exam page", () => {
  it("holds the clock and never ejects the reader", async () => {
    await mountExam();
    expect(host!.textContent).toContain("how each call should be reasoned");

    const frozen = timerText();
    await act(async () => { vi.advanceTimersByTime(120_000); });
    expect(timerText(), "the replay must not burn the track budget").toBe(frozen);
    expect(project(storedLog()).pauseReason).toBe("presentation");
    expect(host!.querySelector('[data-testid="clock-held"]')).not.toBeNull();

    // Past the whole budget: the watchdog must not force-finish the track.
    await act(async () => { vi.advanceTimersByTime(400_000); });
    expect(project(storedLog()).tracks.t2.status).not.toBe("completed");
    expect(host!.textContent).toContain("how each call should be reasoned");
  });
});
