// @vitest-environment jsdom
/**
 * TEN-219: a checkpoint write that fails may not be silent.
 *
 * For a COMPLETED track the log holds the artifact, so a lost checkpoint
 * costs nothing. For the track being sat right now the checkpoint IS the
 * artifact of record on timeout: the watchdog scores whatever
 * `loadCheckpoint` returns. A candidate whose later checkpoints silently
 * failed was therefore scored on the last one that fit, and told nothing.
 *
 * The store refusing a checkpoint is the same event as the store refusing a
 * log entry (TEN-208), so it gets the same answer: the clock is held and the
 * candidate is asked to decide.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TrackUIProps } from "@ailx/core";
import { append, saveAttempt, type SessionConfig } from "@ailx/session";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** A runner that saves one checkpoint, as every real runner does. */
function CheckpointingRunner(props: TrackUIProps) {
  useEffect(() => { props.onCheckpoint?.({ draft: "the candidate's work" }); }, [props.onCheckpoint]);
  return createElement("p", null, "runner alive");
}

vi.mock("../lib/instrument/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/instrument/registry")>();
  return { ...actual, loadTrackModule: async () => ({ placeholder: false, Runner: CheckpointingRunner }) };
});

const ExamPage = (await import("../app/exam/page")).default;

const ATTEMPT = "00000000-0000-4000-8000-000000000219";

/** Storage that holds the run log but has no room for a CHECKPOINT. */
function noRoomForCheckpoints(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => { m.delete(k); },
    setItem: (k: string, v: string) => {
      if (k.includes(":checkpoint:")) throw new Error("QuotaExceededError");
      m.set(k, String(v));
    },
  } as Storage;
}

const config: SessionConfig = {
  instrument: "ailx", version: "2026.1", locale: "en",
  budgets: { t1: 600, t2: 300, t3: 600, t4: 600 }, demo: true,
};

let root: Root | null = null;
let host: HTMLElement | null = null;

function seed(): void {
  Object.defineProperty(window, "localStorage", { value: noRoomForCheckpoints(), configurable: true });
  const ts = Date.now();
  let log = append([], { type: "attempt_started", attemptId: ATTEMPT, config, ts });
  log = append(log, { type: "track_started", trackId: "t3", ts });
  saveAttempt(window.localStorage, log);
}

async function mountExam() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(ExamPage)); });
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

beforeEach(() => { seed(); });

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a checkpoint the browser will not store", () => {
  it("is shown to the candidate, with what the browser said", async () => {
    await mountExam();
    expect(host!.textContent).toContain("This browser cannot save any more of your run.");
    expect(host!.textContent).toContain("QuotaExceededError");
  });

  it("holds the track clock until the candidate has decided", async () => {
    await mountExam();
    expect(host!.querySelector('[data-testid="storage-stop"]')).not.toBeNull();
    expect(host!.textContent).toContain("Your track clock is held");
  });
});
