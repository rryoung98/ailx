// @vitest-environment jsdom
/**
 * TEN-122 — a hosted T3 transcript turn is EVIDENCE, not telemetry.
 *
 * `record()` used to end in `.catch(console.warn)`: no retry, no visible
 * state. The comments in the same module say those rows are what the SERVER's
 * T3 score reads for stances, so a single transient failure permanently
 * removed a scored challenge from the evidence and the candidate was never
 * told.
 *
 * The retry fixed the failing POST and left the RELOAD: the queue was memory
 * only, so a refresh took the outstanding turns with it, the count fell to 0,
 * the notice went and Finish enabled with the stance still in this browser.
 * The queue is persisted per attempt now, and the second describe block below
 * is about the tab going away — on disk before the first post, taken up on the
 * next load, gone when the run is discarded, and a candidate told the truth
 * about which of those this browser can do.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { append, ATTEMPT_KEY, type SessionConfig } from "@ailx/session";
import type { T3Turn } from "@ailx/track-t3";
import { withQueryClient } from "./helpers/clientPage";
import {
  TURN_RETRY_DELAYS_MS,
  discardTranscriptTurns,
  hostedT3Bridge,
  outstandingTranscriptTurns,
  resetTranscriptTurns,
  resumeTranscriptTurns,
  transcriptTurnsKey,
  transcriptTurnsSurviveReload,
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

/**
 * A page load forgets everything in memory and keeps everything on disk. The
 * queue is read back through the module's own key, so a test cannot pass by
 * agreeing with itself about a spelling.
 */
const storedTurns = (): unknown[] => {
  const raw = window.localStorage.getItem(transcriptTurnsKey(ATTEMPT));
  return raw === null ? [] : (JSON.parse(raw) as unknown[]);
};

describe("a turn still in the browser when the tab goes", () => {
  it("is on disk before the first post is even attempted", async () => {
    vi.useFakeTimers();
    const service = transcriptService(Number.MAX_SAFE_INTEGER);
    vi.stubGlobal("fetch", service.fetchFn);
    hostedT3Bridge(ATTEMPT).record(turn);
    // Not "after the retries gave up" — now, before anything has been sent.
    expect(service.posts).toHaveLength(0);
    expect(storedTurns()).toHaveLength(1);
    expect((storedTurns()[0] as { seq: number }).seq).toBe(3);
    await vi.advanceTimersByTimeAsync(TOTAL_RETRY_MS);
  });

  it("is taken up again after a reload, and still blocks Finish", async () => {
    vi.useFakeTimers();
    const service = transcriptService(Number.MAX_SAFE_INTEGER);
    vi.stubGlobal("fetch", service.fetchFn);
    hostedT3Bridge(ATTEMPT).record(turn);
    await vi.advanceTimersByTimeAsync(TOTAL_RETRY_MS);
    expect(outstandingTranscriptTurns()).toBe(1);

    // THE RELOAD. Memory goes; localStorage stays, as a browser leaves it.
    resetTranscriptTurns();
    expect(outstandingTranscriptTurns()).toBe(0);
    expect(storedTurns()).toHaveLength(1);

    resumeTranscriptTurns(ATTEMPT);
    // The count is back, so the notice is back and Finish stays shut …
    expect(outstandingTranscriptTurns()).toBe(1);
    // … and the turn is being POSTED again, not merely counted again.
    const before = service.posts.length;
    await vi.advanceTimersByTimeAsync(TOTAL_RETRY_MS);
    expect(service.posts.length).toBeGreaterThan(before);
  });

  it("lands after the reload, and then leaves nothing behind", async () => {
    vi.useFakeTimers();
    const service = transcriptService(Number.MAX_SAFE_INTEGER);
    vi.stubGlobal("fetch", service.fetchFn);
    hostedT3Bridge(ATTEMPT).record(turn);
    await vi.advanceTimersByTimeAsync(TOTAL_RETRY_MS);
    resetTranscriptTurns();

    // The next load meets a service that answers.
    const healthy = transcriptService(0);
    vi.stubGlobal("fetch", healthy.fetchFn);
    resumeTranscriptTurns(ATTEMPT);
    await vi.advanceTimersByTimeAsync(TOTAL_RETRY_MS);
    expect(healthy.posts).toHaveLength(1);
    expect(outstandingTranscriptTurns()).toBe(0);
    // The stance reached the service, so the row must not be posted a third
    // time on the load after this one.
    expect(window.localStorage.getItem(transcriptTurnsKey(ATTEMPT))).toBeNull();
  });

  it("goes with the run when the run is discarded", async () => {
    vi.useFakeTimers();
    const service = transcriptService(Number.MAX_SAFE_INTEGER);
    vi.stubGlobal("fetch", service.fetchFn);
    hostedT3Bridge(ATTEMPT).record(turn);
    await vi.advanceTimersByTimeAsync(TOTAL_RETRY_MS);

    discardTranscriptTurns(ATTEMPT);
    expect(outstandingTranscriptTurns()).toBe(0);
    expect(window.localStorage.getItem(transcriptTurnsKey(ATTEMPT))).toBeNull();
    // And it does not come back on the next load: a discarded run's stances
    // must not keep Finish shut on the run that replaces it.
    resetTranscriptTurns();
    resumeTranscriptTurns(ATTEMPT);
    expect(outstandingTranscriptTurns()).toBe(0);
  });

  it("resumes nothing from a rewritten queue, and does not throw", () => {
    window.localStorage.setItem(
      transcriptTurnsKey(ATTEMPT),
      '[{"seq":"three","verb":"challenged","object":"claim:2"},"nonsense",null]',
    );
    resetTranscriptTurns();
    resumeTranscriptTurns(ATTEMPT);
    // Every row is refused by the shape check, so nothing is counted and
    // nothing is posted — the storage came back through a place any tab or
    // extension can rewrite.
    expect(outstandingTranscriptTurns()).toBe(0);
  });

  it("keeps the good rows of a queue whose other rows were rewritten", () => {
    window.localStorage.setItem(
      transcriptTurnsKey(ATTEMPT),
      JSON.stringify([{ seq: 3, verb: "challenged", object: "claim:2" }, { verb: 7 }]),
    );
    resetTranscriptTurns();
    vi.stubGlobal("fetch", transcriptService(Number.MAX_SAFE_INTEGER).fetchFn);
    resumeTranscriptTurns(ATTEMPT);
    expect(outstandingTranscriptTurns()).toBe(1);
  });

  it("says so, instead of promising a resume, when the browser will not store it", () => {
    // Quota, private mode, or a storage-less embedding. The queue still
    // retries in this tab; what it cannot promise any more is the reload, and
    // NAME-IS-A-CLAIM applies to a sentence a candidate reads.
    const storage = memoryStorage();
    Object.defineProperty(storage, "setItem", {
      value: () => { throw new DOMException("QuotaExceededError"); },
    });
    Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
    resetTranscriptTurns();
    expect(transcriptTurnsSurviveReload()).toBe(true);

    vi.stubGlobal("fetch", transcriptService(Number.MAX_SAFE_INTEGER).fetchFn);
    hostedT3Bridge(ATTEMPT).record(turn);
    expect(transcriptTurnsSurviveReload()).toBe(false);
    expect(outstandingTranscriptTurns()).toBe(1);
    expect(turnsOutstandingCopy(1)).toContain("this tab only");
    expect(turnsOutstandingCopy(1)).not.toContain("next time you open your run");
  });

  it("promises the resume only in the sentence that is true", () => {
    expect(turnsOutstandingCopy(1, true)).toContain("next time you open your run");
    expect(turnsOutstandingCopy(1, true)).not.toContain("this tab only");
    expect(turnsOutstandingCopy(2, false)).toContain("closing it loses them");
    expect(turnsOutstandingCopy(2, false)).toContain("2 T3 turns have");
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

  it("is still blocked after a reload, because the queue outlived the tab", async () => {
    // THE DEFECT THIS FIXES. Before the queue was persisted, a refresh with a
    // turn outstanding lost the queue, reset the count to 0, took the notice
    // away and ENABLED Finish — TEN-122's own end state, reached by a
    // different door, with the stance still in this browser.
    const service = transcriptService(Number.MAX_SAFE_INTEGER);
    Object.defineProperty(window, "fetch", { value: service.fetchFn, configurable: true });
    vi.stubGlobal("fetch", service.fetchFn);
    seedFinishedTracks();
    await act(async () => {
      hostedT3Bridge(ATTEMPT).record(turn);
    });
    // The tab goes: memory is forgotten, localStorage is not.
    resetTranscriptTurns();
    expect(outstandingTranscriptTurns()).toBe(0);

    const el = await render();
    const finish = [...el.querySelectorAll("button")].find((b) => /Finish/.test(b.textContent ?? ""));
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
