// @vitest-environment jsdom
/**
 * TEN-116: a deck the candidate never saw may not spend their clock.
 *
 * `track_started` starts the clock; the hosted deck fetch runs after it. A
 * fetch that hangs or fails used to spend the whole non-revisitable budget,
 * score an empty artifact as a zero, and then tell the candidate the clock
 * "ran out while you were working" and that "your work was kept". The page
 * already holds the clock for a runner crash — our fault, our cost. Content
 * that is not on screen yet is the same fault.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ATTEMPT_KEY, append, project, saveAttempt,
  type SequencedEntry, type SessionConfig,
} from "@ailx/session";
import { syncKey } from "../lib/data/persistence";

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

const ATTEMPT = "00000000-0000-4000-8000-0000000000dd";
const BANK = "c".repeat(64);

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
  budgets: { t1: 600, t2: 30, t3: 600, t4: 600 }, demo: true,
};

let root: Root | null = null;
let host: HTMLElement | null = null;

/** A hosted run sitting T2, with the deck fetch answered by `deckFetch`. */
function seed(deckFetch: () => Promise<unknown>): void {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
  const ts = Date.now();
  let log = append([], { type: "attempt_started", attemptId: ATTEMPT, config, ts });
  log = append(log, { type: "track_started", trackId: "t1", ts });
  log = append(log, { type: "track_completed", trackId: "t1", artifact: {}, timedOut: false, ts });
  log = append(log, { type: "track_started", trackId: "t2", ts });
  saveAttempt(window.localStorage, log);
  window.localStorage.setItem(
    syncKey(ATTEMPT),
    JSON.stringify({
      serverAttemptId: ATTEMPT,
      syncedThrough: 0,
      finalized: false,
      deck: [{ trackId: "t2", bankSha256: BANK, itemIds: ["srv-1"] }],
    }),
  );
  vi.spyOn(window, "fetch").mockImplementation((async (url: unknown) => {
    if (String(url).endsWith("/items")) return deckFetch();
    return {
      ok: true,
      status: 200,
      json: async () => ({ attempt: { id: ATTEMPT }, response: { seq: 0, created: true } }),
    };
  }) as unknown as typeof fetch);
}

async function mountExam() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(ExamPage)); });
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

/** Fake time in 1 s steps, so the page's 1 Hz clock re-renders between them. */
async function advance(ms: number) {
  for (let left = ms; left > 0; left -= 1000) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(1000, left)); });
  }
}

function stored() {
  const raw = window.localStorage.getItem(ATTEMPT_KEY)!;
  return project((JSON.parse(raw) as { log: SequencedEntry[] }).log);
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a hosted deck fetch that hangs", () => {
  beforeEach(() => seed(() => new Promise(() => {})));

  it("holds the clock instead of spending the track budget", async () => {
    await mountExam();
    await advance(90_000); // three times the whole T2 budget
    const s = stored();
    expect(s.tracks.t2.status, "the track must still be sittable").not.toBe("completed");
    expect(s.tracks.t2.score, "nothing may be scored from a deck never shown").toBeUndefined();
    expect(host!.textContent).not.toContain("Time up");
  });

  it("says the clock is held while the deck loads", async () => {
    await mountExam();
    await advance(5_000);
    expect(host!.querySelector('[data-testid="clock-held"]')).not.toBeNull();
    expect(host!.textContent).toContain("Loading your deck");
    // No pause veil: the candidate did not pause, and there is nothing to hide.
    expect(host!.querySelector('[role="dialog"][aria-label="Paused"]')).toBeNull();
  });

  it("turns a hang into a visible failure with a retry", async () => {
    await mountExam();
    await advance(45_000);
    expect(host!.querySelector('[data-testid="deck-error"]')).not.toBeNull();
    expect(host!.textContent).toContain("Retry loading your deck");
    expect(stored().tracks.t2.status).not.toBe("completed");
  });
});

describe("a hosted deck fetch that fails", () => {
  beforeEach(() =>
    seed(async () => ({ ok: false, status: 503, text: async () => "unavailable", json: async () => ({}) })),
  );

  it("shows the failure and still does not spend the budget", async () => {
    await mountExam();
    await advance(90_000);
    expect(host!.querySelector('[data-testid="deck-error"]')?.textContent).toContain("could not be loaded");
    const s = stored();
    expect(s.tracks.t2.status).not.toBe("completed");
    expect(s.tracks.t2.score).toBeUndefined();
    // The clock stopped at the one-second hold grace and stayed there — 90 s
    // of failure cost the candidate a second of a 30 s budget, not the lot.
    expect(host!.querySelector('[role="timer"]')?.textContent).toBe("00:29");
  });
});
