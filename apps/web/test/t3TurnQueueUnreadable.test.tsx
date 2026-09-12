// @vitest-environment jsdom
/**
 * AN UNREADABLE T3 TURN QUEUE IS NOT AN EMPTY ONE (TEN-272).
 *
 * The persisted queue promises a resume: "Foray is still sending them, so
 * finishing waits until they land." The WRITE side already withdraws that
 * promise when it cannot store the rows (quota, private mode) and says the
 * turns live in this tab only.
 *
 * The READ side made no such distinction. `readPendingTurns` caught
 * everything and returned `[]`, so a parse failure, storage revoked after a
 * good write, and a value rewritten by another tab all produced the same
 * answer as "nothing was stored": queue empty, outstanding 0, no notice, and
 * FINISH OPEN — with a stance that never reached the service. The sentence
 * that promised the resume was not contradicted, because it was no longer on
 * screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { append, ATTEMPT_KEY, type SessionConfig } from "@ailx/session";
import { withQueryClient } from "./helpers/clientPage";
import {
  discardTranscriptTurns,
  outstandingTranscriptTurns,
  resetTranscriptTurns,
  resumeTranscriptTurns,
  transcriptTurnsKey,
  transcriptTurnsUnreadable,
  TURNS_UNREADABLE_COPY,
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

const CONFIG: SessionConfig = {
  instrument: "ailx", version: "2026.1", locale: "en",
  budgets: { t1: 600, t2: 600, t3: 600, t4: 600 }, demo: true,
};

/** A run with every track done: the screen that carries the finalize button. */
function seedFinishedTracks(): void {
  let log = append([], { type: "attempt_started", attemptId: ATTEMPT, config: CONFIG, ts: 1_000 });
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

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function render(): Promise<HTMLDivElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(withQueryClient(createElement(ExamPage)));
  });
  await act(async () => {
    await Promise.resolve();
  });
  return host;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  resetTranscriptTurns();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  discardTranscriptTurns(ATTEMPT);
  resetTranscriptTurns();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a stored queue that cannot be read", () => {
  it("is not reported as nothing stored", () => {
    window.localStorage.setItem(transcriptTurnsKey(ATTEMPT), "{not json at all");
    resumeTranscriptTurns(ATTEMPT);
    expect(outstandingTranscriptTurns()).toBe(0);
    expect(transcriptTurnsUnreadable()).toBe(true);
  });

  it("counts a rewritten row as unreadable, not as absent", () => {
    window.localStorage.setItem(
      transcriptTurnsKey(ATTEMPT),
      '[{"seq":"three","verb":"challenged","object":"claim:2"}]',
    );
    resumeTranscriptTurns(ATTEMPT);
    expect(transcriptTurnsUnreadable()).toBe(true);
  });

  it("says nothing of the kind when there is genuinely nothing stored", () => {
    resumeTranscriptTurns(ATTEMPT);
    expect(outstandingTranscriptTurns()).toBe(0);
    expect(transcriptTurnsUnreadable()).toBe(false);
  });

  it("says nothing of the kind when the stored queue reads back cleanly", () => {
    window.localStorage.setItem(
      transcriptTurnsKey(ATTEMPT),
      JSON.stringify([{ seq: 3, verb: "challenged", object: "claim:2" }]),
    );
    resumeTranscriptTurns(ATTEMPT);
    expect(outstandingTranscriptTurns()).toBe(1);
    expect(transcriptTurnsUnreadable()).toBe(false);
  });

  it("puts the notice on screen and keeps Finish shut", async () => {
    /* THE WHOLE POINT. Outstanding is 0 — there is nothing left to send —
       and Finish must still not open, because "nothing to send" and "we can
       no longer account for what there was" are different facts. */
    window.localStorage.setItem(transcriptTurnsKey(ATTEMPT), "{not json at all");
    seedFinishedTracks();
    const el = await render();
    expect(outstandingTranscriptTurns()).toBe(0);
    const finish = [...el.querySelectorAll("button")].find((b) => /Finish/.test(b.textContent ?? ""));
    expect(finish).toBeTruthy();
    expect((finish as HTMLButtonElement).disabled).toBe(true);
    expect(el.querySelector('[data-testid="turns-unreadable"]')?.textContent).toBe(
      TURNS_UNREADABLE_COPY,
    );
  });

  it("does not say it on a run whose queue was simply never written", async () => {
    seedFinishedTracks();
    const el = await render();
    const finish = [...el.querySelectorAll("button")].find((b) => /Finish/.test(b.textContent ?? ""));
    expect((finish as HTMLButtonElement).disabled).toBe(false);
    expect(el.querySelector('[data-testid="turns-unreadable"]')).toBeNull();
  });
});

describe("the sentence it puts on screen", () => {
  it("does not promise a resume it cannot make, and says what to do", () => {
    expect(TURNS_UNREADABLE_COPY).not.toContain("still sending");
    expect(TURNS_UNREADABLE_COPY).toContain("could not read them back");
    expect(TURNS_UNREADABLE_COPY).toContain("Finishing is held");
  });
});
