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

  it("leaves a FULL local sitting alone", () => {
    const full = reportGate({
      localScored: ["t1", "t2", "t3", "t4"],
      scores: null,
      reading: false,
      localSitting: { completed: true, sat: ["t1", "t2", "t3", "t4"] },
    });
    expect(full.headline).toBe("The report is the reward");
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
