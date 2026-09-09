// @vitest-environment jsdom
/**
 * TEN-122 — a hosted T3 transcript turn is EVIDENCE, not telemetry.
 *
 * `record()` used to end in `.catch(console.warn)`: no retry, no visible
 * state. The comments in the same module say those rows are what the SERVER's
 * T3 score reads for stances, so a single transient failure permanently
 * removed a scored challenge from the evidence and the candidate was never
 * told.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { append, ATTEMPT_KEY, type SessionConfig } from "@ailx/session";
import type { T3Turn } from "@ailx/track-t3";
import { withQueryClient } from "./helpers/clientPage";
import {
  TURN_RETRY_DELAYS_MS,
  hostedT3Bridge,
  outstandingTranscriptTurns,
  resetTranscriptTurns,
  turnsOutstandingCopy,
} from "../lib/instrument/hostedDeck";
import ExamPage from "../app/exam/page";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

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

const ATTEMPT = "att-t3";
const TOTAL_RETRY_MS = TURN_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0) + 1_000;

const turn: T3Turn = {
  seq: 3, verb: "challenged", object: "claim:2", text: "that figure is invented",
  clientTs: new Date(3_000).toISOString(),
};

/** Fails the first `fails` posts, then answers 201. */
function transcriptService(fails: number) {
  const posts: string[] = [];
  let left = fails;
  const fetchFn = (async (url: unknown) => {
    posts.push(String(url));
    if (left > 0) {
      left--;
      throw new TypeError("network down");
    }
    return { ok: true, status: 201, json: async () => ({ turn: { seq: 3 } }) } as Response;
  }) as typeof fetch;
  return { fetchFn, posts };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  resetTranscriptTurns();
});
afterEach(() => {
  resetTranscriptTurns();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a transcript turn whose POST fails", () => {
  it("is retried until it lands, instead of being dropped", async () => {
    vi.useFakeTimers();
    const service = transcriptService(1);
    Object.defineProperty(window, "fetch", { value: service.fetchFn, configurable: true });
    vi.stubGlobal("fetch", service.fetchFn);
    const bridge = hostedT3Bridge(ATTEMPT);
    bridge.record(turn);
    expect(outstandingTranscriptTurns()).toBe(1);
    await vi.advanceTimersByTimeAsync(TOTAL_RETRY_MS);
    expect(service.posts).toHaveLength(2); // the failure, then the retry
    expect(service.posts[1]).toContain(`/attempts/${ATTEMPT}/`);
    expect(outstandingTranscriptTurns()).toBe(0);
  });

  it("stays counted, and is still being re-posted, for as long as it has not landed", async () => {
    vi.useFakeTimers();
    const service = transcriptService(Number.MAX_SAFE_INTEGER);
    Object.defineProperty(window, "fetch", { value: service.fetchFn, configurable: true });
    vi.stubGlobal("fetch", service.fetchFn);
    hostedT3Bridge(ATTEMPT).record(turn);
    await vi.advanceTimersByTimeAsync(TOTAL_RETRY_MS);
    expect(service.posts.length).toBe(TURN_RETRY_DELAYS_MS.length + 1);
    expect(outstandingTranscriptTurns()).toBe(1);
    // The listed delays are spent, and the queue has NOT given up: the page
    // says Foray is still sending and keeps finalize shut, so a queue that
    // stopped here would make that sentence false (TEN-122).
    const spent = service.posts.length;
    await vi.advanceTimersByTimeAsync(TURN_RETRY_DELAYS_MS[TURN_RETRY_DELAYS_MS.length - 1] * 3);
    expect(service.posts.length).toBeGreaterThan(spent);
    expect(outstandingTranscriptTurns()).toBe(1);
  });

  it("counts turns from two bridges for the same attempt, not just the newer one", async () => {
    vi.useFakeTimers();
    const service = transcriptService(Number.MAX_SAFE_INTEGER);
    Object.defineProperty(window, "fetch", { value: service.fetchFn, configurable: true });
    vi.stubGlobal("fetch", service.fetchFn);
    // A resumed sitting can build a second bridge while the first still holds
    // a turn. A count read from one queue's length would hide the other's.
    hostedT3Bridge(ATTEMPT).record(turn);
    hostedT3Bridge(ATTEMPT).record({ ...turn, seq: 4 });
    await vi.advanceTimersByTimeAsync(TOTAL_RETRY_MS);
    expect(outstandingTranscriptTurns()).toBe(2);
  });
});

// ---------------------------------------------------------------------------

const config: SessionConfig = {
  instrument: "ailx", version: "2026.1", locale: "en",
  budgets: { t1: 600, t2: 600, t3: 600, t4: 600 }, demo: true,
};

/** A run with every track done: the screen that carries the finalize button. */
function seedFinishedTracks(): void {
  let log = append([], { type: "attempt_started", attemptId: ATTEMPT, config, ts: 1_000 });
  let ts = 2_000;
  const nextTs = (): number => {
    ts += 1_000;
    return ts;
  };
  for (const t of ["t1", "t2", "t3", "t4"] as const) {
    log = append(log, { type: "track_started", trackId: t, ts: nextTs() });
    log = append(log, {
      type: "track_completed", trackId: t, artifact: {}, timedOut: false, ts: nextTs(),
    });
  }
  window.localStorage.setItem(ATTEMPT_KEY, JSON.stringify({ formatVersion: 1, rev: 1, log }));
}

let root: Root | null = null;
let host: HTMLElement | null = null;

async function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(withQueryClient(createElement(ExamPage))); });
  await act(async () => { await Promise.resolve(); });
  return host;
}

describe("finishing a run with a turn still in the browser", () => {
  afterEach(() => {
    if (root) act(() => root!.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it("is blocked, and says why", async () => {
    const service = transcriptService(Number.MAX_SAFE_INTEGER);
    Object.defineProperty(window, "fetch", { value: service.fetchFn, configurable: true });
    vi.stubGlobal("fetch", service.fetchFn);
    seedFinishedTracks();
    const el = await render();
    await act(async () => {
      hostedT3Bridge(ATTEMPT).record(turn);
    });
    const finish = [...el.querySelectorAll("button")].find((b) => /Finish/.test(b.textContent ?? ""));
    expect(finish).toBeTruthy();
    expect((finish as HTMLButtonElement).disabled).toBe(true);
    expect(el.querySelector('[data-testid="turns-outstanding"]')?.textContent).toBe(
      turnsOutstandingCopy(1),
    );
  });

  it("is offered as normal when nothing is outstanding", async () => {
    seedFinishedTracks();
    const el = await render();
    const finish = [...el.querySelectorAll("button")].find((b) => /Finish/.test(b.textContent ?? ""));
    expect((finish as HTMLButtonElement).disabled).toBe(false);
    expect(el.querySelector('[data-testid="turns-outstanding"]')).toBeNull();
  });
});
