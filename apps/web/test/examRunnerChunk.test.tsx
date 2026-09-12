// @vitest-environment jsdom
/**
 * TEN-207: a runner chunk that will not load may not become a demo stand-in.
 *
 * `loadTrackModule` catches a failed dynamic import (a 404 on a hashed chunk
 * after a deploy, a dropped connection, a blocking extension) and returns
 * `PlaceholderRunner` with `placeholder: true`. The exam page used to mount
 * whatever came back, so four grey demo buttons replaced a real timed track
 * and the `{demo: true}` artifact they submit was scored as the candidate's
 * work. A module this build cannot load is our fault, exactly like a deck
 * fetch that fails (TEN-116): it is SHOWN, with a retry, and the clock is
 * held while it is on screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ATTEMPT_KEY, append, project, saveAttempt,
  type SequencedEntry, type SessionConfig,
} from "@ailx/session";
import { PlaceholderRunner } from "../components/PlaceholderRunner";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * What the REAL registry returns when the dynamic import throws
 * (`lib/instrument/registry.ts`): the placeholder, flagged as one.
 */
vi.mock("../lib/instrument/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/instrument/registry")>();
  return {
    ...actual,
    loadTrackModule: async () => ({ placeholder: true, Runner: PlaceholderRunner }),
  };
});

const ExamPage = (await import("../app/exam/page")).default;

const ATTEMPT = "00000000-0000-4000-8000-00000000020a";

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

/** A run sitting T2, whose runner chunk will not load. */
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

describe("a runner chunk that will not load", () => {
  it("never mounts the placeholder over a scored track", async () => {
    await mountExam();
    expect(host!.textContent).not.toContain("placeholder runner");
    expect(host!.textContent).not.toContain("Prompt the assistant");
  });

  it("shows the failure with a retry", async () => {
    await mountExam();
    expect(host!.querySelector('[data-testid="runner-error"]')).not.toBeNull();
    expect(host!.textContent).toContain("Retry loading your track");
  });

  it("holds the clock and scores nothing while it is on screen", async () => {
    await mountExam();
    await advance(90_000); // three times the whole T2 budget
    const s = stored();
    expect(s.tracks.t2.status, "the track must still be sittable").not.toBe("completed");
    expect(s.tracks.t2.score, "nothing may be scored from a track never shown").toBeUndefined();
    expect(host!.textContent).not.toContain("Time up");
  });
});
