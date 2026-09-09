/**
 * THE REPORT OF A PARTIAL SITTING (TEN-149).
 *
 * A candidate with no model sits the model-free tracks and finishes. The gate
 * used to answer "2 of 4 tracks scored. Finish the run to see it." with a
 * Continue that goes to /exam — which, the run being over, sends them back
 * here. That is the TEN-128 closed loop, and it was still open for a run the
 * exam service never saw.
 */
import { describe, expect, it } from "vitest";
import { TRACK_IDS } from "@ailx/session";
import { reportGate, sittingShape } from "../features/report/reportGate";
import type { AttemptScores } from "../features/report/scoresOfRecord";

/** The dogfooded sitting: T2 scored, T3 with the jury, T1 and T4 never sat. */
const FINALIZED_PARTIAL: AttemptScores = {
  finalized: true,
  pending: true,
  pollAfterMs: 5000,
  tracks: [
    { trackId: "t1", state: "not_sat", reason: "incomplete", detail: "" },
    {
      trackId: "t2",
      state: "scored",
      score: { raw: {}, scaled: 30.884 },
      rubricVersion: "r",
      scoringDigest: "d",
      issuedBy: "finalize",
      computedAt: "2026-09-06T05:38:07.000Z",
    },
    { trackId: "t3", state: "pending_judging", detail: "" },
    { trackId: "t4", state: "not_sat", reason: "incomplete", detail: "" },
  ],
  composite: null,
};

describe("a finished sitting over part of the instrument", () => {
  const gate = reportGate({
    localScored: ["t2", "t3"],
    scores: null,
    reading: false,
    localSitting: { completed: true, sat: ["t2", "t3"] },
  });

  it("says the sitting is finished, not that it is unfinished", () => {
    expect(gate.headline).toBe("Your sitting is finished");
    expect(gate.lede).not.toContain("Finish the run");
  });

  it("names which tracks were sat and which were not", () => {
    expect(gate.lede).toContain("You sat T2 and T3");
    expect(gate.lede).toContain("T1 and T4 were not sat");
  });

  it("gives the composite's own reason, and offers no dead-end Continue", () => {
    expect(gate.lede).toContain("A composite needs every scored track");
    expect(gate.cta).toBeNull();
  });

  it("leaves an UNFINISHED run alone: it still has somewhere to go", () => {
    const open = reportGate({
      localScored: ["t2"],
      scores: null,
      reading: false,
      localSitting: { completed: false, sat: ["t2"] },
    });
    expect(open.lede).toBe("1 of 4 tracks scored. Finish the run to see it.");
    expect(open.cta).toEqual({ href: "/exam", label: "Continue →" });
  });

  /* THIS PIN CHANGED, ON PURPOSE (TEN-128).
     It used to read "leaves a FULL local sitting alone" and expect "The
     report is the reward". That was the original closed loop: a run that
     finished here, whose service read failed or whose service is too old to
     send `scores`, was told "N of 4 tracks scored. Finish the run to see
     it." with a Continue back to /exam, which sends it straight back. A run
     the log says ended IS ended, whatever the service managed to say. */
  it("calls a FULL local sitting finished even when the service answered nothing", () => {
    const full = reportGate({
      localScored: ["t1", "t2", "t3"],
      scores: null,
      reading: false,
      localSitting: { completed: true, sat: ["t1", "t2", "t3", "t4"] },
    });
    expect(full.headline).toBe("Your sitting is finished");
    expect(full.lede).not.toContain("Finish the run");
    expect(full.cta).toBeNull();
    // It says WHY there is nothing of record here, rather than a blank.
    expect(full.lede).toMatch(/exam service/i);
  });

  it("says a failed finalize is a finished run, not an unfinished one", () => {
    /* Finalize failed, so the service still calls the attempt open and the
       sync retries only on the next commit. The run is over all the same:
       /exam has nothing left to give, so the page must not send them there. */
    const stale = reportGate({
      localScored: ["t1", "t2", "t3", "t4"],
      scores: { finalized: false, pending: false, pollAfterMs: null, tracks: [], composite: null },
      reading: false,
      localSitting: { completed: true, sat: ["t1", "t2", "t3", "t4"] },
    });
    expect(stale.headline).toBe("Your sitting is finished");
    expect(stale.cta).toBeNull();
    expect(stale.lede).toContain("has not recorded this sitting as finished");
  });

  it("keeps a previous answer's verdict after a read fails mid-poll", () => {
    /* `failure.kind === "error"` keeps the last good answer on screen
       (`useScoresOfRecord`), so the gate decides from it. The answer here is
       NOT finalized — a finalized one never reached the branch this change
       touched — so the local log is what says the run ended, and one lost
       poll must not turn a finished sitting back into a lock. */
    const view = reportGate({
      localScored: ["t1", "t2", "t3", "t4"],
      scores: { finalized: false, pending: true, pollAfterMs: 5000, tracks: [], composite: null },
      reading: false,
      asked: true,
      localSitting: { completed: true, sat: ["t1", "t2", "t3", "t4"] },
    });
    expect(view.headline).toBe("Your sitting is finished");
    expect(view.lede).not.toContain("Finish the run");
    expect(view.cta).toBeNull();
  });

  it("never denies a score the page is printing below it", () => {
    /* `finalized !== true` is not a witness that no score exists: a body
       with `finalized: false` can still carry a scored track, and the panel
       under this lede prints it. Saying "it has issued no scores of record"
       there would have the page contradict itself. */
    const view = reportGate({
      localScored: ["t1", "t4"],
      scores: {
        finalized: false,
        pending: false,
        pollAfterMs: null,
        tracks: [FINALIZED_PARTIAL.tracks[1]],
        composite: null,
      },
      reading: false,
      asked: true,
      localSitting: { completed: true, sat: ["t1", "t2", "t3", "t4"] },
    });
    expect(view.lede).not.toContain("issued no scores of record");
    expect(view.lede).toContain("What it has issued is below");
  });

  it("says nothing was ASKED when nothing was asked", () => {
    /* No identity ever arrived, so no request was made. "It returned no
       scores, or could not be reached" would describe a request nobody
       sent — and it is what a static export with no service at all would
       have been told too. */
    const view = reportGate({
      localScored: ["t1", "t2", "t3"],
      scores: null,
      reading: false,
      asked: false,
      localSitting: { completed: true, sat: ["t1", "t2", "t3", "t4"] },
    });
    expect(view.headline).toBe("Your sitting is finished");
    expect(view.cta).toBeNull();
    expect(view.lede).toContain("never asked the exam service");
    expect(view.lede).not.toContain("could not be reached");
  });

  it("says a read that DID go out came back with nothing, and says which", () => {
    const view = reportGate({
      localScored: ["t1", "t2", "t3"],
      scores: null,
      reading: false,
      asked: true,
      localSitting: { completed: true, sat: ["t1", "t2", "t3", "t4"] },
    });
    expect(view.lede).toContain("could not be reached");
    expect(view.lede).not.toContain("never asked");
  });
});

describe("a finalized sitting in which no track was sat at all", () => {
  it("does not print an empty list: 'You sat .' is not a sentence", () => {
    const view = reportGate({
      localScored: [],
      scores: {
        finalized: true,
        pending: false,
        pollAfterMs: null,
        tracks: TRACK_IDS.map((trackId) => ({
          trackId,
          state: "not_sat" as const,
          reason: "incomplete",
          detail: "",
        })),
        composite: null,
      },
      reading: false,
      localSitting: { completed: true, sat: [] },
    });
    expect(view.lede).not.toContain("You sat .");
    expect(view.lede).toContain("No track in this sitting was sat.");
    expect(view.lede).toContain("none is coming for this sitting");
  });
});


describe("the shape of a finished sitting", () => {
  it("reads the service's answer: a track it says nothing about is not invented", () => {
    const shape = sittingShape({
      scores: FINALIZED_PARTIAL,
      localSitting: { completed: true, sat: ["t2", "t3"] },
    });
    expect(shape.finished).toBe(true);
    expect(shape.sat).toEqual(["t2", "t3"]);
    expect(shape.partial).toBe(true);
  });

  it("counts a track awaiting its jury as SAT — it is not missing, it is unmarked", () => {
    const shape = sittingShape({ scores: FINALIZED_PARTIAL, localSitting: undefined });
    expect(shape.sat).toContain("t3");
  });

  it("falls back to this browser's log when the service answered nothing", () => {
    const shape = sittingShape({
      scores: null,
      localSitting: { completed: true, sat: ["t1", "t2", "t3", "t4"] },
    });
    expect(shape).toEqual({ finished: true, sat: ["t1", "t2", "t3", "t4"], partial: false });
  });

  it("calls an unfinished run unfinished, and offers it nothing", () => {
    const shape = sittingShape({
      scores: null,
      localSitting: { completed: false, sat: ["t2"] },
    });
    expect(shape.finished).toBe(false);
    expect(shape.partial).toBe(false);
  });
});

describe("a FINALIZED partial sitting, as the exam service describes it", () => {
  const gate = reportGate({
    localScored: [],
    scores: FINALIZED_PARTIAL,
    reading: false,
    localSitting: { completed: true, sat: ["t2", "t3"] },
  });

  it("names the sitting partial rather than letting it read as the whole instrument", () => {
    expect(gate.lede).toContain("You sat T2 and T3");
    expect(gate.lede).toContain("covers part of the instrument");
  });

  it("says once that no composite is coming, and never that one is on its way", () => {
    expect(gate.lede).toContain("none is coming for this sitting");
    expect(gate.lede).not.toContain("It issued the composite too");
  });

  it("still says a judged track has not been marked yet", () => {
    expect(gate.lede).toContain("still being judged");
  });
});

describe("a hosted FULL sitting the service only half describes", () => {
  it("is not called partial because the browser scored the other two tracks", () => {
    /* The run of 2026-09-04: T1 and T4 scored in this browser, T2 and T3 by
       the exam service, and the service's `tracks` list names only its own
       two. A shape read from that list alone would call a full sitting
       partial and offer a credential that lies about it. */
    const shape = sittingShape({
      localScored: ["t1", "t4"],
      scores: {
        finalized: true,
        pending: false,
        pollAfterMs: null,
        tracks: FINALIZED_PARTIAL.tracks.filter((t) => t.trackId === "t2" || t.trackId === "t3"),
        composite: null,
      },
      localSitting: undefined,
    });
    expect(shape.sat).toEqual(["t1", "t2", "t3", "t4"]);
    expect(shape.partial).toBe(false);
  });
});
