// @vitest-environment jsdom
/**
 * TEN-232: time with the browser closed or asleep is not working time.
 *
 * The budget is wall clock from `runningSince` (packages/session machine),
 * and nothing stopped it when the page went away. A laptop that slept, a tab
 * the OS killed, or a phone that backgrounded the browser came back to a
 * track that was already over — while the page's own copy says "Only working
 * time is charged."
 *
 * The page now pauses on `pagehide`, and what an unattended gap costs is
 * decided in the open: nothing, and the candidate restarts their own clock
 * from the ordinary pause veil. Pausing by hand is already free and
 * unlimited, so this takes no new exploit — it removes a charge for time
 * nobody was working.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ATTEMPT_KEY, append, project, saveAttempt, secondsRemaining,
  type SequencedEntry, type SessionConfig,
} from "@ailx/session";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../lib/instrument/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/instrument/registry")>();
  return {
    ...actual,
    loadTrackModule: async () => ({
      placeholder: false,
      Runner: () => createElement("p", null, "runner alive"),
    }),
  };
});

const ExamPage = (await import("../app/exam/page")).default;

const ATTEMPT = "00000000-0000-4000-8000-000000000232";

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

function seed(): void {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  const ts = Date.now();
  let log = append([], { type: "attempt_started", attemptId: ATTEMPT, config, ts });
  log = append(log, { type: "track_started", trackId: "t2", ts });
  saveAttempt(window.localStorage, log);
}

async function mountExam() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(ExamPage)); });
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

async function advance(ms: number) {
  for (let left = ms; left > 0; left -= 1000) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(1000, left)); });
  }
}

/** The log as the NEXT page load would find it. */
function storedLog(): SequencedEntry[] {
  return (JSON.parse(window.localStorage.getItem(ATTEMPT_KEY)!) as { log: SequencedEntry[] }).log;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  seed();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the page going away mid-track", () => {
  it("records a paused entry, with a cause, where the next load will find it", async () => {
    await mountExam();
    await advance(10_000);
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    const log = storedLog();
    expect(project(log).phase).toBe("paused");
    const verbs = log.flatMap((e) => (e.type === "track_event" ? [e.event.verb] : []));
    expect(verbs, "an involuntary pause carries a recorded cause").toContain("page_hidden");
  });

  it("does not charge the gap while the browser is away", async () => {
    await mountExam();
    await advance(10_000);
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    const atHide = secondsRemaining(project(storedLog()), "t2", Date.now());
    // Two minutes with the machine asleep, then the candidate comes back.
    await advance(120_000);
    expect(secondsRemaining(project(storedLog()), "t2", Date.now())).toBe(atHide);
  });

  it("hands the clock back to the candidate, never restarts it for them", async () => {
    await mountExam();
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    await advance(1_000);
    // The ordinary pause veil, with its own way out: the clock restarts when
    // the candidate says so, which is what "only working time" means.
    expect(host!.querySelector('[role="dialog"][aria-label="Paused"]')).not.toBeNull();
    expect(host!.textContent).toContain("Resume track");
  });

  it("does nothing when the track is already paused", async () => {
    await mountExam();
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    const before = storedLog().length;
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    expect(storedLog().length).toBe(before);
  });
});
