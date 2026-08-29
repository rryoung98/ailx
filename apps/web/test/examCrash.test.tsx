// @vitest-environment jsdom
/**
 * P0-1: a track runner throw must never white-screen a timed, scored run.
 *
 * What is pinned here:
 *  - the crash is caught, and the candidate gets a recovery affordance;
 *  - the stored event log is NOT lost (it is the authoritative record) and
 *    gains an auditable `runner_crashed` event;
 *  - the TRACK CLOCK STOPS. A fault on our side is never charged to the
 *    candidate's budget, so the page commits `paused` on catch and
 *    `resumed` only when the candidate chooses to continue;
 *  - retry remounts the runner and the run keeps going.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ATTEMPT_KEY, append, project, saveAttempt,
  type SequencedEntry, type SessionConfig,
} from "@ailx/session";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** Flipped by the tests: the mocked runner throws while this is true. */
let crashRunner = true;
let runnerMounts = 0;

vi.mock("../lib/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/registry")>();
  return {
    ...actual,
    loadTrackModule: async () => ({
      placeholder: false,
      Runner: () => {
        runnerMounts += 1;
        if (crashRunner) throw new Error("runner exploded");
        return createElement("p", { "data-testid": "runner-ok" }, "runner alive");
      },
    }),
  };
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

/** A live t1 track with one real answer already recorded. */
function seedInTrack(ts: number): SequencedEntry[] {
  let log = append([], { type: "attempt_started", attemptId: "att-crash", config, ts });
  log = append(log, { type: "track_started", trackId: "t1", ts });
  log = append(log, {
    type: "track_event", trackId: "t1", ts,
    event: { verb: "prompted", object: "t1:prompt", clientTs: new Date(ts).toISOString() },
  });
  return log;
}

function storedLog(): SequencedEntry[] {
  const raw = window.localStorage.getItem(ATTEMPT_KEY);
  if (!raw) throw new Error("nothing persisted");
  return (JSON.parse(raw) as { log: SequencedEntry[] }).log;
}

let root: Root | null = null;
let host: HTMLElement | null = null;
let errors: unknown[][] = [];

beforeEach(() => {
  crashRunner = true;
  runnerMounts = 0;
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { errors.push(a); });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
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
  // Let the dynamic track-module import resolve and the runner mount.
  await act(async () => { await Promise.resolve(); });
}

function timerText(): string {
  const el = host!.querySelector('[role="timer"]');
  if (!el) throw new Error("timer not rendered");
  return el.textContent ?? "";
}

describe("exam runner error boundary", () => {
  it("catches a runner throw, keeps the log, stops the clock and recovers", async () => {
    const t0 = Date.now();
    saveAttempt(window.localStorage, seedInTrack(t0));
    await mountExam();

    // ---- 1. No white screen: a recovery panel, not an unmounted tree ----
    const panel = host!.querySelector('[data-testid="runner-crash"]');
    expect(panel, "crash recovery panel").not.toBeNull();
    expect(panel!.getAttribute("role")).toBe("alert");
    expect(panel!.textContent).toContain("Your run is saved");
    expect(host!.querySelector('[data-testid="runner-crash-retry"]')).not.toBeNull();

    // ---- 2. The crash is reported with debuggable context --------------
    const report = errors.find((a) => a[0] === "[ailx] track runner crashed");
    expect(report, "console.error report").toBeDefined();
    const ctx = report![1] as Record<string, unknown>;
    expect(ctx.attemptId).toBe("att-crash");
    expect(ctx.track).toBe("t1");
    expect(ctx.message).toBe("runner exploded");
    expect(typeof ctx.componentStack).toBe("string");

    // ---- 3. The event log survives, and records the fault ---------------
    const afterCrash = storedLog();
    expect(afterCrash[0].type).toBe("attempt_started");
    expect(afterCrash.filter((e) => e.type === "track_event")).toHaveLength(2);
    const crashEvent = afterCrash
      .filter((e): e is Extract<SequencedEntry, { type: "track_event" }> => e.type === "track_event")
      .map((e) => e.event)
      .find((e) => e.verb === "runner_crashed");
    expect(crashEvent, "auditable crash event").toBeDefined();
    expect((crashEvent!.result as { message: string }).message).toBe("runner exploded");

    // ---- 4. The clock is stopped, not merely hidden ---------------------
    const state = project(afterCrash);
    expect(state.phase).toBe("paused");
    expect(state.tracks.t1.runningSince).toBeUndefined();
    const frozen = timerText();
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(timerText(), "a crash must not burn the candidate's budget").toBe(frozen);

    // The pause veil must NOT cover the recovery affordance.
    expect(host!.querySelector('[role="dialog"][aria-label="Paused"]')).toBeNull();

    // ---- 5. Retry remounts the runner and restarts the clock -----------
    crashRunner = false;
    const mountsBefore = runnerMounts;
    await act(async () => {
      (host!.querySelector('[data-testid="runner-crash-retry"]') as HTMLButtonElement).click();
    });
    expect(runnerMounts).toBeGreaterThan(mountsBefore);
    expect(host!.querySelector('[data-testid="runner-ok"]')).not.toBeNull();
    expect(host!.querySelector('[data-testid="runner-crash"]')).toBeNull();

    const afterRetry = storedLog();
    expect(project(afterRetry).phase).toBe("in_track");
    expect(afterRetry.some((e) => e.type === "resumed")).toBe(true);
    // Nothing was dropped by the recovery.
    expect(afterRetry.length).toBeGreaterThan(afterCrash.length - 1);
    expect(afterRetry.slice(0, afterCrash.length)).toEqual(afterCrash);

    // The clock runs again once the candidate has chosen to continue.
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(timerText()).not.toBe(frozen);
  });

  it("does not resume a pause the CANDIDATE chose before the crash", async () => {
    const t0 = Date.now();
    let log = seedInTrack(t0);
    log = append(log, { type: "paused", ts: t0 });
    saveAttempt(window.localStorage, log);
    await mountExam();

    expect(host!.querySelector('[data-testid="runner-crash"]')).not.toBeNull();
    // Already paused: no second `paused` entry, and no auto-resume on retry.
    expect(storedLog().filter((e) => e.type === "paused")).toHaveLength(1);

    crashRunner = false;
    await act(async () => {
      (host!.querySelector('[data-testid="runner-crash-retry"]') as HTMLButtonElement).click();
    });
    expect(storedLog().some((e) => e.type === "resumed")).toBe(false);
    expect(project(storedLog()).phase).toBe("paused");
  });
});
