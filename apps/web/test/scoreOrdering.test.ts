/**
 * THE REPORT'S UNLOCK GATE AND THE RUN HUB'S SUMMARY (TEN-126/127/128/129).
 *
 * A live sitting on 2026-09-04 (attempt 856b850c…, 48 responses, finalized)
 * finished, was scored by the exam service, and the report still said
 * "3 of 4 tracks scored. Finish the run to unlock it." — for ever, because
 * the gate read the local event log and a server-issued score never lands
 * there. On the way in, the run hub said "All four tracks are scored" on the
 * same screen as the error saying two were not.
 *
 * Both sentences are derived here, from pure functions, so neither can state
 * something the screen beside it contradicts.
 */
import { describe, expect, it } from "vitest";
import { reportGate, scoredTracks } from "../features/report/reportGate";
import type { AttemptScores } from "../features/report/scoresOfRecord";
import {
  completionSummary,
  SERVICE_SCORES_THIS_TRACK,
  trackList,
  tracksScoredByService,
} from "../lib/instrument/scoreSources";
import type { AttemptComposite } from "@ailx/contract";
import type { TrackId } from "@ailx/session";

const scored = (trackId: TrackId, scaled: number) =>
  ({
    trackId,
    state: "scored" as const,
    score: { raw: {}, scaled },
    rubricVersion: "r",
    scoringDigest: "d",
    issuedBy: "finalize",
    computedAt: "2026-09-04T07:39:31.000Z",
  });

const pending = (trackId: TrackId) =>
  ({ trackId, state: "pending_judging" as const, detail: "the jury has not answered" });

const attemptScores = (over: Partial<AttemptScores> = {}): AttemptScores => ({
  finalized: true,
  pending: false,
  pollAfterMs: 5000,
  tracks: [],
  // Null is what a service that sends no composite field reads as, which is
  // the deployment this gate met before TEN-92.
  composite: null,
  ...over,
});

const ISSUED: AttemptComposite = {
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
    { trackId: "t1", scoreId: "37", scaled: 55.5, rubricVersion: "r", scoringDigest: "d", weight: 0.36 },
  ],
};

const WITHHELD: AttemptComposite = {
  state: "withheld",
  reason: "awaiting_track",
  awaiting: [{ trackId: "t3", trackState: "pending_judging", detail: "the jury has not answered" }],
  detail: "no composite is issued while a scored track has no score of record: T3.",
};

/** The run of record: T1 and T4 scored locally, T2 and T3 by the service. */
const LIVE_RUN = attemptScores({ tracks: [scored("t2", 30.83), scored("t3", 103.333)] });

describe("the unlock gate counts a score of record wherever it was issued", () => {
  it("adds the service's scored tracks to the browser's own", () => {
    expect(scoredTracks({ localScored: ["t1", "t4"], scores: LIVE_RUN }).sort()).toEqual([
      "t1",
      "t2",
      "t3",
      "t4",
    ]);
  });

  it("counts a track once when both sources hold it", () => {
    expect(scoredTracks({ localScored: ["t2"], scores: LIVE_RUN })).toEqual(["t2", "t3"]);
  });

  it("counts only SCORED server tracks — being judged is not a score", () => {
    const s = attemptScores({ tracks: [scored("t2", 30.83), pending("t3")], pending: true });
    expect(scoredTracks({ localScored: ["t1", "t4"], scores: s })).not.toContain("t3");
  });

  it("stops saying 'finish the run' on a run that is finished", () => {
    const view = reportGate({ localScored: ["t1", "t4"], scores: LIVE_RUN, reading: false });
    expect(view.lede).not.toMatch(/finish the run/i);
    expect(view.headline).toBe("Your sitting is finished");
    // The closed loop: Continue → /exam → "run complete" → back to here.
    expect(view.cta).toBeNull();
  });

  it("says why there is no composite instead of showing none silently", () => {
    const view = reportGate({ localScored: ["t1", "t4"], scores: LIVE_RUN, reading: false });
    expect(view.lede).toMatch(/no composite/i);
    expect(view.lede).toContain("did not issue these");
  });

  /* TEN-92: the service issues the composite now, so the three answers it can
     give produce three different ledes. The old sentence is kept for the
     deployment that sends no composite at all, because on that one it is
     still true. */
  it("says the service issued the composite, and claims no replay of it", () => {
    const view = reportGate({
      localScored: [],
      scores: attemptScores({ tracks: [scored("t2", 30.83)], composite: ISSUED }),
      reading: false,
    });
    expect(view.lede).not.toContain("no composite");
    expect(view.lede).toContain("It issued the composite too");
    expect(view.lede).toContain("claims no replay");
  });

  it("leaves a withheld composite to explain itself, and denies nothing", () => {
    const view = reportGate({
      localScored: [],
      scores: attemptScores({ tracks: [pending("t3")], pending: true, composite: WITHHELD }),
      reading: false,
    });
    // The panel below names the track and its state; a second, vaguer
    // sentence up here would contradict it or repeat it.
    expect(view.lede).not.toContain("no composite");
    expect(view.lede).not.toContain("It issued the composite");
    expect(view.lede).toContain("still being judged");
  });

  it("names how many tracks are still with the jury", () => {
    const s = attemptScores({ tracks: [scored("t2", 30.83), pending("t3")], pending: true });
    const view = reportGate({ localScored: ["t1", "t4"], scores: s, reading: false });
    expect(view.lede).toContain("One track is");
  });

  it("does not lock a finished sitting while the first read is in flight", () => {
    const view = reportGate({ localScored: ["t1", "t4"], scores: undefined as never, reading: true });
    expect(view.lede).not.toMatch(/finish the run/i);
    expect(view.cta).toBeNull();
  });

  it("still locks an OPEN sitting, and still offers the way back into it", () => {
    const open = attemptScores({ finalized: false });
    const view = reportGate({ localScored: ["t1"], scores: open, reading: false });
    expect(view.lede).toBe("1 of 4 tracks scored. Finish the run to see it.");
    expect(view.cta).toEqual({ href: "/exam", label: "Continue →" });
  });

  it("locks a static-demo run with no service at all, exactly as before", () => {
    const view = reportGate({ localScored: ["t1", "t2"], scores: null, reading: false });
    expect(view.lede).toBe("2 of 4 tracks scored. Finish the run to see it.");
  });
});

describe("the run hub says who scores each track", () => {
  const state = (scoredLocally: readonly TrackId[], completed: readonly TrackId[]) => ({
    order: ["t1", "t2", "t3", "t4"] as TrackId[],
    tracks: Object.fromEntries(
      (["t1", "t2", "t3", "t4"] as TrackId[]).map((t) => [
        t,
        {
          status: completed.includes(t) ? "completed" : "pending",
          score: scoredLocally.includes(t) ? { raw: {}, scaled: 50 } : undefined,
        },
      ]),
    ) as Record<TrackId, { status: string; score?: unknown }>,
  });

  const HOSTED = state(["t1", "t4"], ["t1", "t2", "t3", "t4"]);

  it("names the tracks the service marks", () => {
    expect(tracksScoredByService(HOSTED)).toEqual(["t2", "t3"]);
  });

  it("never claims four scores when the browser holds two", () => {
    const copy = completionSummary(HOSTED);
    expect(copy).not.toContain("All four tracks are scored");
    expect(copy).toContain("T2 and T3");
    expect(copy).toContain("exam service");
  });

  it("keeps the plain sentence when every track really is scored here", () => {
    const copy = completionSummary(state(["t1", "t2", "t3", "t4"], ["t1", "t2", "t3", "t4"]));
    expect(copy).toContain("All 4 tracks are scored in this browser");
  });

  it("reads as a singular sentence for one service-scored track", () => {
    const copy = completionSummary(state(["t1", "t3", "t4"], ["t1", "t2", "t3", "t4"]));
    expect(copy).toContain("T2 is marked by the exam service");
  });

  it("says nothing about a track that was never sat", () => {
    expect(tracksScoredByService(state(["t1"], ["t1"]))).toEqual([]);
  });

  it("lists track codes in English", () => {
    expect(trackList([])).toBe("");
    expect(trackList(["t2"])).toBe("T2");
    expect(trackList(["t2", "t3"])).toBe("T2 and T3");
    expect(trackList(["t2", "t3", "t4"])).toBe("T2, T3 and T4");
  });

  it("labels an unscored completed track by whose score it is, not as a failure", () => {
    expect(SERVICE_SCORES_THIS_TRACK).toBe("scored by the exam service");
    expect(SERVICE_SCORES_THIS_TRACK).not.toContain("not scored");
  });
});
