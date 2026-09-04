/**
 * THE COMPOSITE VIEW MODEL (TEN-92).
 *
 * One card draws both composites, so this module is where the two sources are
 * made to agree about what the card is allowed to print. The tests below pin
 * the parts a reader would be misled by if they drifted: the n, the raw total
 * over SCORED tracks only, and a copied summary that never reads as a rank.
 */
import { describe, expect, it } from "vitest";
import type { AwaitedTrack, IssuedComposite } from "@ailx/contract";
import { candidateComposite } from "@ailx/report";
import { SCORED_TRACKS } from "@ailx/session";
import {
  WITHHELD_LEDE,
  awaitingCopy,
  localCompositeView,
  serviceCompositeView,
  withheldHeadline,
} from "../features/report/compositeView";
import { completedState } from "./helpers/completedAttempt";

const ISSUED: IssuedComposite = {
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
    { trackId: "t2", scoreId: "38", scaled: 30.83, rubricVersion: "r", scoringDigest: "d", weight: 0.213333 },
    { trackId: "t3", scoreId: "39", scaled: 103.333, rubricVersion: "r", scoringDigest: "d", weight: 0.426666 },
  ],
};

describe("the local composite view", () => {
  const summary = candidateComposite(completedState())!;
  const view = localCompositeView("run-1", summary);

  it("carries the four bars and the raw total over the SCORED tracks", () => {
    expect(view.bars.map((b) => b.trackId)).toEqual(["t1", "t2", "t3", "t4"]);
    // T4 is a showcase track. Adding its bar to the total would print a
    // number the instrument cannot reach.
    expect(view.rawTotal).toBeCloseTo(
      SCORED_TRACKS.reduce((a, t) => a + summary.trackRaw[t], 0),
      6,
    );
  });

  it("keeps the cohort it standardized against, for the dot strip", () => {
    expect(view.origin.kind).toBe("local");
    expect(view.cohortSize).toBe(summary.cohortSize);
    expect(view.origin).toMatchObject({ cohortComposites: summary.cohortComposites });
  });

  it("copies a summary with no rank in it", () => {
    expect(view.shareText).toContain(summary.composite.toFixed(1));
    expect(view.shareText).toContain(`synthetic demo cohort of ${summary.cohortSize} generated runs`);
    expect(view.shareText).toContain("no percentile, no judged result");
    expect(view.shareText).not.toMatch(/\bP\d+(\.\d+)? of \d+/);
  });
});

describe("the service composite view", () => {
  const view = serviceCompositeView("run-1", ISSUED);

  it("counts the candidate into the n the card prints", () => {
    // The service counts PEERS; the local card has always printed peers + you.
    expect(ISSUED.cohort.size).toBe(44);
    expect(view.cohortSize).toBe(45);
    expect(view.cohortSeed).toBe("ailx-2026.1-demo-cohort");
  });

  it("draws one bar per cited score row, and totals the same rows", () => {
    expect(view.bars).toEqual([
      { trackId: "t1", value: 55.5 },
      { trackId: "t2", value: 30.83 },
      { trackId: "t3", value: 103.333 },
    ]);
    expect(view.rawTotal).toBeCloseTo(55.5 + 30.83 + 103.333, 6);
  });

  it("drops a source for a track this build does not have", () => {
    const view5 = serviceCompositeView("run-1", {
      ...ISSUED,
      sources: [
        ...ISSUED.sources,
        { trackId: "t5", scoreId: "40", scaled: 10, rubricVersion: "r", scoringDigest: "d", weight: 0.1 },
      ],
    });
    expect(view5.bars.map((b) => b.trackId)).toEqual(["t1", "t2", "t3"]);
  });

  it("says who issued the number in the copied summary", () => {
    expect(view.shareText).toContain("63.4");
    expect(view.shareText).toContain("Merit");
    expect(view.shareText).toContain("synthetic demo cohort of 45 generated runs");
    expect(view.shareText).toContain("Issued by the exam service, not by this browser");
    expect(view.shareText).not.toContain("0.811111");
  });

  it("keeps the percentile out of everything the card prints", () => {
    // It is kept for the floor case only, which is a shape of the cohort and
    // not a rank a candidate is shown.
    expect(view.percentile).toBe(0.811111);
    expect(JSON.stringify(view.bars) + view.shareText).not.toContain("0.81");
  });
});

describe("what a withheld composite says", () => {
  const awaited = (trackState: AwaitedTrack["trackState"], trackId = "t3"): AwaitedTrack => ({
    trackId,
    trackState,
    detail: "",
  });

  it("tells a candidate waiting on a jury that a number is coming", () => {
    const copy = awaitingCopy(awaited("pending_judging"));
    expect(copy).toContain("T3");
    expect(copy).toContain("with the jury");
    expect(copy).toContain("The composite is issued when it does");
  });

  it("tells a candidate who did not sit a track that none is coming", () => {
    const copy = awaitingCopy(awaited("not_sat", "t2"));
    expect(copy).toContain("was not sat");
    expect(copy).toContain("no composite is coming for this sitting");
    expect(copy).not.toContain("jury");
  });

  it("keeps 'no score of record' apart from 'not sat'", () => {
    const unscored = awaitingCopy(awaited("unscored", "t2"));
    expect(unscored).toContain("has no score of record");
    expect(unscored).not.toBe(awaitingCopy(awaited("not_sat", "t2")));
  });

  it("names a track this build does not know rather than dropping it", () => {
    expect(awaitingCopy({ trackId: "t9", trackState: "not_sat", detail: "" })).toContain("T9");
  });

  it("heads the panel with the state, never with a number", () => {
    expect(withheldHeadline({ state: "withheld", reason: "not_finalized", awaiting: [], detail: "" }))
      .toBe("No composite yet");
    expect(
      withheldHeadline({
        state: "withheld",
        reason: "awaiting_track",
        awaiting: [awaited("pending_judging")],
        detail: "",
      }),
    ).toContain("waiting on a judged track");
    expect(
      withheldHeadline({
        state: "withheld",
        reason: "awaiting_track",
        awaiting: [awaited("not_sat", "t2")],
        detail: "",
      }),
    ).toBe("No composite for this sitting");
  });

  it("explains why a partial composite is not issued at all", () => {
    expect(WITHHELD_LEDE.awaiting_track).toContain("shares of the whole instrument");
    expect(WITHHELD_LEDE.not_finalized).toContain("still open");
  });
});
