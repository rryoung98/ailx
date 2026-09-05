// @vitest-environment jsdom
/**
 * THE HOSTED SCORES OF RECORD ON THE REPORT (TEN-69).
 *
 * The exam service issues a judged track's score AFTER finalize, so the
 * report has to survive a number that does not exist yet: four states that
 * never blur into each other, a poll that stops both ways (the score lands,
 * or the page gives up saying it is coming), and an arrival the reader can
 * see.
 *
 * The service is not running here — the backend half is an unmerged PR — so
 * every body below is a fixture of the documented wire shape.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ScoresOfRecordView } from "../features/report/ScoresOfRecordPanel";
import { useScoresOfRecord } from "../features/report/useScoresOfRecord";
import { installMemoryStorage } from "./helpers/clientPage";
import {
  BOUND_COPY,
  NO_SCORES_COPY,
  OPEN_SITTING_COPY,
  parseAttemptScores,
  pollDelayMs,
  stateCopy,
} from "../features/report/scoresOfRecord";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
installMemoryStorage();

const ATTEMPT = "11111111-2222-3333-4444-555555555555";

const scored = (trackId: string, scaled: number, issuedBy = "judge") => ({
  trackId,
  state: "scored",
  score: { raw: { analysis: 40 }, scaled },
  rubricVersion: "rubric-2026.1-abcdef",
  scoringDigest: "0123456789abcdef",
  scoredBy: "server",
  issuedBy,
  partial: false,
  computedAt: "2026-09-03T10:00:00.000Z",
  custody: {},
});
const pending = (trackId: string) => ({
  trackId,
  state: "pending_judging",
  detail: "the judging pass has not issued this score yet",
});
const notSat = (trackId: string, reason: string) => ({
  trackId,
  state: "not_sat",
  reason,
  detail: `no ${trackId} work recorded`,
});
const unscored = (trackId: string, reason: string) => ({
  trackId,
  state: "unscored",
  reason,
  detail: `${trackId} was scored under rubric rubric-2025.4`,
});

function body(tracks: unknown[], over: Record<string, unknown> = {}) {
  return {
    attempt: { id: ATTEMPT },
    scores: {
      finalized: true,
      pending: tracks.some((t) => (t as { state: string }).state === "pending_judging"),
      pollAfterMs: 5000,
      tracks,
      ...over,
    },
  };
}

let calls: { url: string; headers: Record<string, string> }[] = [];

/** Answer each read in turn; the LAST body repeats for every later read. */
function stubReads(bodies: unknown[], status = 200): void {
  let i = 0;
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[k.toLowerCase()] = v;
    }
    calls.push({ url: String(url), headers });
    const b = bodies[Math.min(i, bodies.length - 1)];
    i += 1;
    return new Response(JSON.stringify(b), { status });
  });
}

/**
 * The report page owns the read and hands it to the panel (TEN-128), so the
 * test mounts the same pairing: one `useScoresOfRecord`, one view.
 */
function Harness() {
  return createElement(ScoresOfRecordView, { view: useScoresOfRecord(ATTEMPT) });
}

interface Mounted {
  html: () => string;
  click: (testId: string) => Promise<void>;
  tick: (ms: number) => Promise<void>;
  unmount: () => Promise<void>;
}

/** Mount for real and keep it mounted: polling is what is under test. */
async function mount(): Promise<Mounted> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  let root: Root;
  await act(async () => {
    root = createRoot(host);
    root.render(createElement(Harness));
  });
  const settle = async () => {
    for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  };
  await settle();
  return {
    html: () => host.innerHTML,
    click: async (testId) => {
      const el = host.querySelector(`[data-testid="${testId}"] button`) as HTMLButtonElement | null;
      if (el === null) throw new Error(`no button in ${testId}`);
      await act(async () => { el.click(); });
      await settle();
    },
    tick: async (ms) => {
      await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
      await settle();
    },
    unmount: async () => {
      await act(async () => { root.unmount(); });
      host.remove();
    },
  };
}

beforeEach(() => {
  calls = [];
  vi.useFakeTimers();
  vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
  window.localStorage.setItem("foray:dev-user", "player-9");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("the read", () => {
  it("goes through the seam: the manifest path, and identity as a header", async () => {
    stubReads([body([scored("t2", 60), pending("t3")])]);
    const m = await mount();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`/api/attempts/${ATTEMPT}`);
    expect(calls[0].headers["x-ailx-dev-user"]).toBe("player-9");
    expect(calls[0].headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    await m.unmount();
  });

  it("renders nothing at all in the static build — it has no exam service", async () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "0");
    stubReads([body([scored("t2", 60)])]);
    const m = await mount();
    expect(m.html()).toBe("");
    expect(calls).toHaveLength(0);
    await m.unmount();
  });
});

describe("four states, kept apart", () => {
  it("shows a pending track as being judged, and shows no number for it", async () => {
    stubReads([body([scored("t2", 60), pending("t3")])]);
    const m = await mount();
    const html = m.html();
    expect(html).toContain('data-state="pending_judging"');
    expect(html).toContain("Being judged.");
    expect(html).toContain("being judged");
    // The judged track carries no number, and the scored one does.
    expect(html).toContain("60.0 / 80");
    expect(html).not.toContain("/ 160");
    await m.unmount();
  });

  it("shows not_sat as itself, with the reason it was given", async () => {
    stubReads([body([notSat("t1", "incomplete"), notSat("t3", "unevidenced")])]);
    const m = await mount();
    const html = m.html();
    expect(html).toContain('data-reason="incomplete"');
    expect(html).toContain("The exam service holds no work for this track.");
    expect(html).toContain('data-reason="unevidenced"');
    expect(html).toContain("the exam service recorded nothing for it");
    await m.unmount();
  });

  it("shows an unscored showcase track as issuing no points, not as a zero", async () => {
    stubReads([body([unscored("t4", "showcase")])]);
    const m = await mount();
    expect(m.html()).toContain("This track is a showcase and issues no points.");
    expect(m.html()).not.toContain("0.0 /");
    await m.unmount();
  });

  it("shows a CUSTODY REFUSAL with no number anywhere near it", async () => {
    stubReads([body([unscored("t3", "instrument_mismatch")])]);
    const m = await mount();
    const html = m.html();
    expect(html).toContain('data-reason="instrument_mismatch"');
    expect(html).toContain("The score cannot be shown.");
    expect(html).toContain("The stored score and its inputs are intact.");
    expect(html).not.toMatch(/\d+\.\d+ \/ \d+/);
    await m.unmount();
  });

  it("says so when the service reported nothing about a track", async () => {
    stubReads([body([scored("t2", 60)])]);
    const m = await mount();
    expect(m.html()).toContain("said nothing about this track");
    await m.unmount();
  });

  it("says the sitting is open rather than listing an empty result", async () => {
    stubReads([body([], { finalized: false, pending: false, pollAfterMs: null })]);
    const m = await mount();
    expect(m.html()).toContain(OPEN_SITTING_COPY);
    await m.unmount();
  });

  it("says so when the service returned no scores object", async () => {
    stubReads([{ attempt: { id: ATTEMPT } }]);
    const m = await mount();
    expect(m.html()).toContain(NO_SCORES_COPY);
    await m.unmount();
  });
});

describe("polling", () => {
  it("re-reads after pollAfterMs and shows the issued score when it lands", async () => {
    stubReads([
      body([scored("t2", 60), pending("t3")]),
      body([scored("t2", 60), scored("t3", 96)]),
    ]);
    const m = await mount();
    expect(m.html()).toContain("Checking again in 5 seconds.");
    expect(m.html()).not.toContain("96.0 / 160");
    await m.tick(5000);
    expect(calls).toHaveLength(2);
    expect(m.html()).toContain("96.0 / 160");
    expect(m.html()).toContain("issued by judge");
    await m.unmount();
  });

  it("makes the arrival visible instead of letting a number appear quietly", async () => {
    stubReads([body([pending("t3")]), body([scored("t3", 96)])]);
    const m = await mount();
    await m.tick(5000);
    expect(m.html()).toContain("This score arrived while you were on this page.");
    expect(m.html()).toContain("T3 has been scored: 96.0 / 160.");
    await m.unmount();
  });

  it("stops the moment nothing is owed", async () => {
    stubReads([body([pending("t3")]), body([scored("t3", 96)])]);
    const m = await mount();
    await m.tick(5000);
    expect(calls).toHaveLength(2);
    await m.tick(120_000);
    expect(calls).toHaveLength(2);
    expect(m.html()).not.toContain("Checking again");
    await m.unmount();
  });

  it("stops on a read the service refused — a 404 does not fix itself", async () => {
    stubReads([body([pending("t3")])], 404);
    const m = await mount();
    expect(m.html()).toContain("status 404");
    await m.tick(60_000);
    expect(calls).toHaveLength(1);
    await m.unmount();
  });

  it("keeps the last good answer when a read fails, and tries again", async () => {
    let i = 0;
    vi.stubGlobal("fetch", async () => {
      calls.push({ url: "", headers: {} });
      i += 1;
      if (i === 2) throw new Error("offline");
      return new Response(JSON.stringify(body([pending("t3")])), { status: 200 });
    });
    const m = await mount();
    await m.tick(5000);
    expect(m.html()).toContain("could not be reached on the last check");
    expect(m.html()).toContain("Being judged.");
    await m.tick(5000);
    expect(calls).toHaveLength(3);
    await m.unmount();
  });

  it("stops polling when the component goes away", async () => {
    stubReads([body([pending("t3")])]);
    const m = await mount();
    await m.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(calls).toHaveLength(1);
  });
});

describe("the bound", () => {
  it("stops saying the score is coming after three minutes, and says why", async () => {
    stubReads([body([pending("t3")])]);
    const m = await mount();
    await m.tick(181_000);
    const seen = calls.length;
    expect(m.html()).toContain(BOUND_COPY);
    expect(m.html()).not.toContain("Checking again in");
    // Bounded means STOPPED: no further read happens on its own.
    await m.tick(120_000);
    expect(calls).toHaveLength(seen);
    await m.unmount();
  });

  it("checks again on request, and shows the score if it has landed by then", async () => {
    stubReads([body([pending("t3")]), body([pending("t3")])]);
    const m = await mount();
    await m.tick(181_000);
    const seen = calls.length;
    vi.stubGlobal("fetch", async () => {
      calls.push({ url: "", headers: {} });
      return new Response(JSON.stringify(body([scored("t3", 96)])), { status: 200 });
    });
    await m.click("scores-bound");
    expect(calls.length).toBe(seen + 1);
    expect(m.html()).toContain("96.0 / 160");
    expect(m.html()).not.toContain(BOUND_COPY);
    await m.unmount();
  });
});

describe("what the wire is allowed to say", () => {
  it("reads pending off the tracks, not off a flag that could disagree", () => {
    const parsed = parseAttemptScores(body([pending("t3")], { pending: false }));
    expect(parsed?.pending).toBe(true);
    const none = parseAttemptScores(body([scored("t3", 96)], { pending: true }));
    expect(none?.pending).toBe(false);
  });

  it("drops a record whose state or reason this build does not know", () => {
    const parsed = parseAttemptScores(body([
      { trackId: "t3", state: "quantum" },
      { trackId: "t1", state: "unscored", reason: "because" },
      { trackId: "nope", state: "scored", score: { scaled: 1 } },
      { trackId: "t2", state: "scored", score: { scaled: "60" } },
    ]));
    expect(parsed?.tracks).toEqual([]);
  });

  it("clamps a poll interval this page will not honour", () => {
    const base = parseAttemptScores(body([pending("t3")]))!;
    expect(pollDelayMs(base)).toBe(5000);
    expect(pollDelayMs({ ...base, pollAfterMs: 0 })).toBe(1000);
    expect(pollDelayMs({ ...base, pollAfterMs: null })).toBe(5000);
    expect(pollDelayMs({ ...base, pollAfterMs: 9_000_000 })).toBe(60_000);
  });

  it("has one sentence for every state, and no two states share it", () => {
    const copies = [
      stateCopy({ trackId: "t3", state: "pending_judging", detail: "" }),
      stateCopy({ trackId: "t1", state: "not_sat", reason: "incomplete", detail: "" }),
      stateCopy({ trackId: "t1", state: "not_sat", reason: "unevidenced", detail: "" }),
      stateCopy({ trackId: "t4", state: "unscored", reason: "showcase", detail: "" }),
      stateCopy({ trackId: "t3", state: "unscored", reason: "no_deck", detail: "" }),
      stateCopy({ trackId: "t3", state: "unscored", reason: "no_score", detail: "" }),
      stateCopy({ trackId: "t3", state: "unscored", reason: "instrument_mismatch", detail: "" }),
    ];
    expect(new Set(copies).size).toBe(copies.length);
    for (const c of copies) expect(c.length).toBeGreaterThan(20);
  });
});
