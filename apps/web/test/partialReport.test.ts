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
import { reportGate } from "../features/report/reportGate";

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
