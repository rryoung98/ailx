// @vitest-environment jsdom
/**
 * THE COMPOSITE ON A HOSTED REPORT (TEN-92).
 *
 * TEN-128 stopped a finished hosted sitting being told to finish itself, and
 * left the honest hole this suite fills: four track scores and no composite,
 * because the composite is derived from the browser's log and a server-issued
 * score never lands there. The exam service issues the composite now (backend
 * PR #13) and the report shows it.
 *
 * What these tests hold to:
 *  - an issued composite renders in the report's OWN card, with the band, the
 *    exam service's attribution and the score rows it cites;
 *  - a withheld composite renders its reason and names the track it waits on;
 *  - a jury that has not reported and a track that was never sat do not read
 *    the same;
 *  - no state renders a number this browser was not sent, and none of them
 *    renders a percentile.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { append, saveAttempt, type SequencedEntry, type TrackId } from "@ailx/session";
import { buildSampleAttemptLog } from "../lib/instrument/sampleAttempt";
import { scoreTrack, trackScoredEntry } from "../lib/instrument/registry";
import { memoryStorage } from "./helpers/completedAttempt";
import { QueryProvider } from "../lib/QueryProvider";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const ATTEMPT = "856b850c-51ac-4a1a-82a5-24deb8df66ae";

/** A hosted sitting: T1 and T4 scored here, T2 and T3 the service's. */
function hostedLog(): SequencedEntry[] {
  let log = buildSampleAttemptLog();
  let t = log[log.length - 1].ts;
  for (const c of log.filter(
    (e): e is Extract<SequencedEntry, { type: "track_completed" }> => e.type === "track_completed",
  )) {
    const trackId = c.trackId as TrackId;
    if (trackId === "t2" || trackId === "t3") continue;
    t += 1_000;
    log = append(log, trackScoredEntry(trackId, scoreTrack(trackId, c.artifact), t));
  }
  return append(log, { type: "attempt_completed", ts: t + 1_000 });
}

const scored = (trackId: string, scaled: number) => ({
  trackId,
  state: "scored",
  score: { raw: {}, scaled },
  rubricVersion: "2026.1-a1b2c3d4e5f6",
  scoringDigest: "0123456789abcdef",
  issuedBy: "finalize",
  computedAt: "2026-09-04T07:39:31.000Z",
});

/** The service's own example body, field for field (backend PR #13). */
const ISSUED = {
  state: "issued",
  composite: 63.412,
  percentile: 0.811111,
  zComposite: 0.742,
  band: "Merit",
  bandCutlines: { Distinction: 76.1, Merit: 62.9, Pass: 54.2 },
  scoredBy: "server",
  cohort: { kind: "demo", seed: "ailx-2026.1-demo-cohort", size: 44 },
  weights: { t1: 0.36, t2: 0.213333, t3: 0.426666 },
  sources: [
    {
      trackId: "t1",
      scoreId: "37",
      scaled: 55.5,
      rubricVersion: "2026.1-a1b2c3d4e5f6",
      scoringDigest: "0123456789abcdef",
      weight: 0.36,
    },
    {
      trackId: "t2",
      scoreId: "38",
      scaled: 30.83,
      rubricVersion: "2026.1-a1b2c3d4e5f6",
      scoringDigest: "0123456789abcdef",
      weight: 0.213333,
    },
    {
      trackId: "t3",
      scoreId: "39",
      scaled: 103.333,
      rubricVersion: "2026.1-a1b2c3d4e5f6",
      scoringDigest: "0123456789abcdef",
      weight: 0.426666,
    },
  ],
};

const withheld = (awaiting: unknown[], reason = "awaiting_track", detail = "") => ({
  state: "withheld",
  reason,
  awaiting,
  detail,
});

function serviceAnswers(scores: unknown): void {
  vi.stubGlobal("fetch", async (url: unknown) =>
    new Response(
      JSON.stringify(String(url).includes("/attempts/") ? { attempt: { id: ATTEMPT }, scores } : {}),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

let host: HTMLDivElement;
let root: Root;

/**
 * Mount the report and let the service read land.
 *
 * `waitForBand` also waits out the 1.1s reveal timer, which only the band
 * assertion needs; every other test would just pay for it.
 */
async function renderReport(waitForBand = false): Promise<string> {
  const ReportPage = (await import("../app/report/page")).default;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(QueryProvider, null, createElement(ReportPage)));
  });
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  // The band is revealed 1.1s after mount, so a test that never waits would
  // assert on a card the candidate never sees.
  if (waitForBand) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_300));
    });
  }
  return host.textContent ?? "";
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
  window.localStorage.setItem("foray:dev-user", "player-9");
  saveAttempt(window.localStorage, hostedLog());
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const finalized = (composite: unknown, tracks: unknown[] = [scored("t2", 30.83), scored("t3", 103.333)]) => ({
  finalized: true,
  pending: tracks.some((t) => (t as { state: string }).state === "pending_judging"),
  pollAfterMs: 5000,
  tracks,
  composite,
});

describe("an issued composite", () => {
  it("renders in the report's own card, with its band", async () => {
    serviceAnswers(finalized(ISSUED));
    const text = await renderReport(true);
    expect(host.querySelector('[data-testid="composite-card-server"]')).toBeTruthy();
    expect(host.querySelector(".share-card .composite-number")).toBeTruthy();
    expect(text).toContain("Merit");
    expect(host.querySelector('[data-testid="hosted-composite"] .reveal-band')!.textContent)
      .toBe("Merit");
    // The same card, not a second one: the cutline line the local report
    // prints is here too, from the service's own cutlines.
    expect(text).toContain("Distinction ≥ 76.1");
  });

  it("says the exam service issued it and claims no local replay", async () => {
    serviceAnswers(finalized(ISSUED));
    const text = await renderReport();
    expect(host.querySelector('[data-testid="composite-attribution"]')!.textContent)
      .toContain("scoredBy server");
    expect(text).toContain("this browser did not compute it");
    expect(text).toContain("claims no local replay");
    // The local replay line belongs to a score this browser recomputed. The
    // composite card must not carry one.
    expect(host.querySelector('[data-testid="hosted-composite"] [data-replay-status]')).toBeNull();
  });

  it("cites the score rows the number was derived from", async () => {
    serviceAnswers(finalized(ISSUED));
    const text = await renderReport();
    for (const s of ISSUED.sources) {
      const line = host.querySelector(`[data-testid="composite-source-${s.trackId}"]`)!;
      expect(line.textContent).toContain(`score ${s.scoreId}`);
      expect(line.textContent).toContain(s.scaled.toFixed(1));
      expect(line.textContent).toContain(s.weight.toFixed(3));
    }
    expect(text).toContain("scoring 0123456789ab");
  });

  it("says the cohort is a seeded fixture, not peers", async () => {
    serviceAnswers(finalized(ISSUED));
    const text = await renderReport();
    const caption = host.querySelector('[data-testid="composite-cohort-caption"]')!;
    expect(caption.textContent).toContain("Synthetic demo cohort");
    expect(caption.textContent).toContain("44 generated runs");
    expect(caption.textContent).toContain("ailx-2026.1-demo-cohort");
    expect(caption.textContent).toContain("not people");
    expect(caption.textContent).toContain("not a rank among players");
    expect(text).toContain("synthetic demo cohort n = 45");
  });

  it("prints no percentile, though the service sent one", async () => {
    serviceAnswers(finalized(ISSUED));
    const text = await renderReport();
    for (const re of [
      /\d+(\.\d+)?\s*(st|nd|rd|th)\s+percentile/i,
      /\btop\s+\d+\s?%/i,
      /percentile of\b/i,
      /\bP\d+(\.\d+)? of \d+/,
    ]) {
      expect(text).not.toMatch(re);
    }
    expect(text).not.toContain("0.811111");
    expect(text).not.toContain("81.1");
    // Nor the raw z-composite, which reads as a score and is not one.
    expect(text).not.toContain("0.742");
  });

  it("draws no distribution strip: the browser was sent no cohort", async () => {
    serviceAnswers(finalized(ISSUED));
    await renderReport();
    expect(host.querySelector('[data-testid="hosted-composite"] [data-testid="dist-strip"]'))
      .toBeNull();
  });
});

describe("a withheld composite", () => {
  const PENDING_JURY = withheld(
    [{ trackId: "t3", trackState: "pending_judging", detail: "the jury has not reported" }],
    "awaiting_track",
    "no composite is issued while a scored track has no score of record: T3.",
  );
  const NEVER_SAT = withheld(
    [{ trackId: "t2", trackState: "not_sat", detail: "no responses were recorded" }],
    "awaiting_track",
    "no composite is issued while a scored track has no score of record: T2.",
  );

  it("names the track it waits on and says a number is coming", async () => {
    serviceAnswers(
      finalized(PENDING_JURY, [
        scored("t2", 30.83),
        { trackId: "t3", state: "pending_judging", detail: "the jury has not reported" },
      ]),
    );
    const text = await renderReport();
    const panel = host.querySelector('[data-testid="composite-withheld"]')!;
    expect(panel.getAttribute("data-reason")).toBe("awaiting_track");
    expect(text).toContain("waiting on a judged track");
    const line = host.querySelector('[data-testid="composite-awaiting-t3"]')!;
    expect(line.getAttribute("data-track-state")).toBe("pending_judging");
    expect(line.textContent).toContain("is with the jury");
    expect(line.textContent).toContain("The composite is issued when it does");
  });

  it("reads differently for a track that was never sat", async () => {
    serviceAnswers(finalized(NEVER_SAT, [scored("t3", 103.333)]));
    const text = await renderReport();
    const line = host.querySelector('[data-testid="composite-awaiting-t2"]')!;
    expect(line.getAttribute("data-track-state")).toBe("not_sat");
    expect(line.textContent).toContain("was not sat");
    expect(line.textContent).toContain("no composite is coming for this sitting");
    // The two sentences must not be interchangeable.
    expect(line.textContent).not.toContain("with the jury");
    expect(text).not.toContain("waiting on a judged track");
  });

  it("explains an open sitting instead of showing a hole", async () => {
    serviceAnswers({
      finalized: false,
      pending: false,
      pollAfterMs: null,
      tracks: [],
      composite: withheld([], "not_finalized", "the sitting is open"),
    });
    const text = await renderReport();
    expect(text).toContain("No composite yet");
    expect(text).toContain("This sitting is still open");
  });

  it("never renders the withheld composite as a number, blank or unexplained", async () => {
    serviceAnswers(
      finalized(PENDING_JURY, [
        scored("t2", 30.83),
        { trackId: "t3", state: "pending_judging", detail: "the jury has not reported" },
      ]),
    );
    const text = await renderReport();
    expect(host.querySelector('[data-testid="composite-card-server"]')).toBeNull();
    expect(host.querySelector('[data-testid="hosted-composite"]')).toBeNull();
    expect(text).not.toContain("0.0");
    expect(text).not.toMatch(/composite\s*unavailable/i);
    // A reason, always: the panel's own copy plus the service's detail.
    expect(host.querySelector('[data-testid="composite-withheld-detail"]')!.textContent)
      .toContain("no composite is issued while a scored track has no score of record");
  });
});

describe("a service that sends no composite at all", () => {
  it("shows no card and no number, and the lede says why", async () => {
    serviceAnswers(finalized(undefined));
    const text = await renderReport();
    expect(host.querySelector('[data-testid="composite-card-server"]')).toBeNull();
    expect(host.querySelector('[data-testid="composite-withheld"]')).toBeNull();
    expect(text).toContain("no composite");
  });

  it("refuses a malformed composite rather than drawing half a card", async () => {
    serviceAnswers(finalized({ ...ISSUED, composite: null }));
    const text = await renderReport();
    expect(host.querySelector('[data-testid="composite-card-server"]')).toBeNull();
    expect(text).not.toContain("Merit");
  });
});
