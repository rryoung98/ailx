// @vitest-environment jsdom
/**
 * P0 FAIRNESS: the track clock must not run over a post-submit PRESENTATION
 * screen — T2's replay, T3's reveal, T4's delivery gallery. A real candidate
 * answered the T2 deck, reached the replay (the one screen in T2 that
 * teaches), read it at human pace, and the exam watchdog force-finished the
 * track and dumped them on "2 of 4 tracks complete" with no word of a
 * timeout. It read as a crash, and the report then blamed them for it.
 *
 * What is pinned here:
 *  - entering a presentation screen HOLDS the clock, and the hold is in the
 *    append-only log (cause event + `paused` carrying its reason);
 *  - the timeout watchdog cannot force-finish while a hold is in place —
 *    including when the budget was already spent as the screen opened;
 *  - the pause veil never covers the screen being read, and no Resume
 *    control is offered that could restart the clock under a reader;
 *  - a reload mid-presentation restores the hold from the log;
 *  - a GENUINE timeout during the working phase says so explicitly;
 *  - working-phase timing is untouched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ATTEMPT_KEY, append, project, saveAttempt,
  type SequencedEntry, type SessionConfig, type TrackId,
} from "@ailx/session";
import type { TrackUIProps } from "@ailx/core";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** Flipped by each test before mount: which screen the mocked runner shows. */
let screenId: string | null = null;
/** Captured so a test can drive the runner the way a real one does. */
let lastProps: TrackUIProps | null = null;

vi.mock("../lib/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/registry")>();
  return {
    ...actual,
    loadTrackModule: async () => ({
      placeholder: false,
      Runner: (props: TrackUIProps) => {
        lastProps = props;
        // Exactly what the three real runners do: report the presentation
        // screen while it is up, and null when it is not.
        useEffect(() => { props.onPresentation?.(screenId); }, [props.onPresentation]);
        return createElement("p", { "data-testid": "runner" }, screenId ?? "working");
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
  budgets: { t1: 600, t2: 300, t3: 600, t4: 600 }, demo: true,
};

/**
 * A live track with one recorded response, started at `startedAt`. The
 * sitting order is fixed T1→T4, so any earlier track is opened and closed
 * instantly (no budget consumed, so nothing times out).
 */
function seedInTrack(trackId: TrackId, startedAt: number): SequencedEntry[] {
  let log = append([], { type: "attempt_started", attemptId: "att-pres", config, ts: startedAt });
  for (const prior of ["t1", "t2", "t3", "t4"] as TrackId[]) {
    if (prior === trackId) break;
    log = append(log, { type: "track_started", trackId: prior, ts: startedAt });
    log = append(log, {
      type: "track_completed", trackId: prior, artifact: {}, timedOut: false, ts: startedAt,
    });
  }
  log = append(log, { type: "track_started", trackId, ts: startedAt });
  log = append(log, {
    type: "track_event", trackId, ts: startedAt,
    event: { verb: "responded", object: "item:1", clientTs: new Date(startedAt).toISOString() },
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

beforeEach(() => {
  screenId = null;
  lastProps = null;
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
  await act(async () => { await Promise.resolve(); });
}

function timerText(): string {
  const el = host!.querySelector('[role="timer"]');
  if (!el) throw new Error("timer not rendered");
  return el.textContent ?? "";
}

function pauses(log: SequencedEntry[]) {
  return log.filter((e): e is Extract<SequencedEntry, { type: "paused" }> => e.type === "paused");
}

function verbs(log: SequencedEntry[]): string[] {
  return log
    .filter((e): e is Extract<SequencedEntry, { type: "track_event" }> => e.type === "track_event")
    .map((e) => e.event.verb);
}

describe.each([
  { trackId: "t2" as TrackId, screen: "t2-replay" },
  { trackId: "t3" as TrackId, screen: "t3-reveal" },
  { trackId: "t4" as TrackId, screen: "t4-gallery" },
])("the clock is held on $screen", ({ trackId, screen }) => {
  it("does not advance while the presentation screen is shown", async () => {
    const t0 = Date.now();
    screenId = screen;
    saveAttempt(window.localStorage, seedInTrack(trackId, t0));
    await mountExam();

    const frozen = timerText();
    await act(async () => { vi.advanceTimersByTime(120_000); });
    expect(timerText(), "reading a post-submit screen must cost no time").toBe(frozen);

    const state = project(storedLog());
    expect(state.phase).toBe("paused");
    expect(state.pauseReason).toBe("presentation");
    expect(state.tracks[trackId].runningSince).toBeUndefined();
  });

  it("appends an auditable hold: a cause event, then the reasoned pause", async () => {
    const t0 = Date.now();
    screenId = screen;
    const before = seedInTrack(trackId, t0);
    saveAttempt(window.localStorage, before);
    await mountExam();

    const log = storedLog();
    // Append-only: the seeded prefix is untouched.
    expect(log.slice(0, before.length)).toEqual(before);
    expect(verbs(log)).toContain("presentation_opened");
    const cause = log
      .filter((e): e is Extract<SequencedEntry, { type: "track_event" }> => e.type === "track_event")
      .map((e) => e.event)
      .find((e) => e.verb === "presentation_opened");
    expect(cause!.context).toMatchObject({ track: trackId, screen, clock: "held" });
    expect(pauses(log)).toHaveLength(1);
    expect(pauses(log)[0].reason).toBe("presentation");
    // The cause is recorded BEFORE the clock change, as with a crash.
    expect(log.findIndex((e) => e.type === "track_event" && e.event.verb === "presentation_opened"))
      .toBeLessThan(log.findIndex((e) => e.type === "paused"));
  });

  it("shows the screen — not the pause veil — and offers no Resume", async () => {
    const t0 = Date.now();
    screenId = screen;
    saveAttempt(window.localStorage, seedInTrack(trackId, t0));
    await mountExam();

    expect(host!.querySelector('[role="dialog"][aria-label="Paused"]')).toBeNull();
    expect(host!.querySelector('[data-testid="runner"]')!.textContent).toBe(screen);
    const held = host!.querySelector('[data-testid="clock-held"]');
    expect(held, "the candidate is told the clock is held").not.toBeNull();
    expect(held!.textContent).toContain("not timed");
    const buttons = Array.from(host!.querySelectorAll("button")).map((b) => b.textContent);
    expect(buttons).not.toContain("Resume");
    expect(buttons).not.toContain("Pause");
  });

  it("cannot be force-finished by the watchdog while the screen is up", async () => {
    // The exact F3 sequence: the screen opens with time left, then the
    // budget would have run out behind it. It must not eject the reader.
    const t0 = Date.now();
    screenId = screen;
    saveAttempt(window.localStorage, seedInTrack(trackId, t0));
    await mountExam();

    await act(async () => { vi.advanceTimersByTime(config.budgets[trackId] * 1000 + 60_000); });
    const state = project(storedLog());
    expect(state.tracks[trackId].status, "no silent force-finish").not.toBe("completed");
    expect(host!.querySelector('[data-testid="runner"]')!.textContent).toBe(screen);
    expect(host!.textContent).not.toContain("tracks complete");
  });

  it("survives a reload onto a held clock whose budget is already spent", async () => {
    // The nastiest case: the deck's last item lapsed at the buzzer, so the
    // hold sits on an exhausted budget. The watchdog must still not fire —
    // the track ends when the candidate leaves the screen.
    const t0 = Date.now() - config.budgets[trackId] * 1000 - 60_000;
    screenId = screen;
    let log = seedInTrack(trackId, t0);
    log = append(log, { type: "paused", reason: "presentation", ts: Date.now() - 30_000 });
    saveAttempt(window.localStorage, log);
    await mountExam();

    expect(timerText()).toBe("00:00");
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(project(storedLog()).tracks[trackId].status).not.toBe("completed");
    expect(host!.querySelector('[data-testid="runner"]')!.textContent).toBe(screen);
    // No duplicate hold: the log already held the clock.
    expect(pauses(storedLog())).toHaveLength(1);

    // Leaving the screen ends the track, honestly flagged as timed out.
    await act(async () => { lastProps!.onComplete({ responses: [] }); });
    const state = project(storedLog());
    expect(state.tracks[trackId].status).toBe("completed");
    expect(state.tracks[trackId].timedOut).toBe(true);
    expect(host!.querySelector('[data-testid="time-up"]'), "and it says so").not.toBeNull();
  });

  it("restores the hold after a reload mid-screen", async () => {
    const t0 = Date.now();
    screenId = screen;
    saveAttempt(window.localStorage, seedInTrack(trackId, t0));
    await mountExam();
    const heldLog = storedLog();

    // Reload: a fresh page over the same stored log.
    await act(async () => { root!.unmount(); });
    host!.remove();
    await mountExam();

    expect(project(storedLog()).pauseReason).toBe("presentation");
    // No duplicate hold, and no veil over the screen being read.
    expect(pauses(storedLog())).toHaveLength(1);
    expect(storedLog().length).toBe(heldLog.length);
    expect(host!.querySelector('[role="dialog"][aria-label="Paused"]')).toBeNull();
    const frozen = timerText();
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(timerText()).toBe(frozen);
  });
});

describe("the working phase is unchanged", () => {
  it("charges working time exactly as before", async () => {
    const t0 = Date.now();
    screenId = null;
    saveAttempt(window.localStorage, seedInTrack("t2", t0));
    await mountExam();

    expect(project(storedLog()).phase).toBe("in_track");
    expect(storedLog().some((e) => e.type === "paused")).toBe(false);
    expect(timerText()).toBe("05:00");
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(timerText()).toBe("04:50");
  });

  it("still force-finishes a track whose budget runs out while working", async () => {
    const t0 = Date.now() - 299_000; // 1 s of t2 budget left, still working
    screenId = null;
    saveAttempt(window.localStorage, seedInTrack("t2", t0));
    await mountExam();

    await act(async () => { vi.advanceTimersByTime(2_000); });
    const state = project(storedLog());
    expect(state.tracks.t2.status).toBe("completed");
    expect(state.tracks.t2.timedOut).toBe(true);
  });

  it("says TIME UP explicitly instead of teleporting to the track list", async () => {
    const t0 = Date.now() - 299_000;
    screenId = null;
    saveAttempt(window.localStorage, seedInTrack("t2", t0));
    await mountExam();
    await act(async () => { vi.advanceTimersByTime(2_000); });

    const notice = host!.querySelector('[data-testid="time-up"]');
    expect(notice, "a timeout must be stated, not silently applied").not.toBeNull();
    expect(notice!.querySelector("h1")!.textContent).toBe("Time up");
    // It says what happened to the work, and does not blame the candidate
    // for time spent on screens that are not charged.
    expect(notice!.textContent).toContain("scored from everything saved");
    expect(notice!.textContent).toContain("Only working time is charged");
    expect(host!.textContent).not.toContain("of 4 tracks complete");

    // Continue is the way on — and only then does the track list appear.
    await act(async () => {
      (host!.querySelector('[data-testid="time-up-continue"]') as HTMLButtonElement).click();
    });
    expect(host!.querySelector('[data-testid="time-up"]')).toBeNull();
    expect(host!.textContent).toContain("of 4 tracks complete");
  });

  it("does not show a time-up notice for a track finished by hand", async () => {
    const t0 = Date.now();
    screenId = null;
    saveAttempt(window.localStorage, seedInTrack("t2", t0));
    await mountExam();
    await act(async () => { lastProps!.onComplete({ responses: [] }); });

    expect(project(storedLog()).tracks.t2.timedOut).toBe(false);
    expect(host!.querySelector('[data-testid="time-up"]')).toBeNull();
    expect(host!.textContent).toContain("of 4 tracks complete");
  });
});

describe("leaving a presentation screen", () => {
  it("completes the track from the held clock, charging nothing for the read", async () => {
    const t0 = Date.now();
    screenId = "t2-replay";
    saveAttempt(window.localStorage, seedInTrack("t2", t0));
    await mountExam();
    await act(async () => { vi.advanceTimersByTime(240_000); });

    // The runner's "Finish track" button.
    await act(async () => { lastProps!.onComplete({ responses: [] }); });
    const state = project(storedLog());
    expect(state.tracks.t2.status).toBe("completed");
    expect(state.tracks.t2.timedOut, "the read must not time the track out").toBe(false);
    expect(state.tracks.t2.activeMs).toBeLessThan(1_000);
    expect(host!.querySelector('[data-testid="time-up"]')).toBeNull();
  });

  it("resumes the clock if a screen closes back into the working phase", async () => {
    const t0 = Date.now();
    screenId = "t2-replay";
    saveAttempt(window.localStorage, seedInTrack("t2", t0));
    await mountExam();
    const frozen = timerText();
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(timerText()).toBe(frozen);

    await act(async () => { lastProps!.onPresentation!(null); });
    expect(project(storedLog()).phase).toBe("in_track");
    expect(verbs(storedLog())).toContain("presentation_closed");
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(timerText(), "working time is charged again").not.toBe(frozen);
  });

  it("never restarts a clock the CANDIDATE stopped", async () => {
    const t0 = Date.now();
    screenId = null;
    let log = seedInTrack("t2", t0);
    log = append(log, { type: "paused", ts: t0 });
    saveAttempt(window.localStorage, log);
    await mountExam();

    // A runner-internal timer reporting a screen under the pause veil must
    // not convert a candidate pause into a presentation hold, and closing
    // one must not resume the candidate's pause for them.
    await act(async () => { lastProps!.onPresentation!("t2-replay"); });
    expect(project(storedLog()).pauseReason).toBe("candidate");
    expect(pauses(storedLog())).toHaveLength(1);
    await act(async () => { lastProps!.onPresentation!(null); });
    expect(storedLog().some((e) => e.type === "resumed")).toBe(false);
    expect(project(storedLog()).phase).toBe("paused");
  });
});
