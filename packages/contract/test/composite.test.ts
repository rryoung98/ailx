/**
 * The composite wire shape, read defensively (TEN-92).
 *
 * The service issues the composite for a hosted sitting; the browser only
 * reads it. These tests pin the two things that decide what a candidate is
 * told: a malformed issued composite must not become a number, and a withheld
 * composite must keep its reason and the state of the track it waits on.
 */
import { describe, expect, it } from "vitest";
import { parseAttemptComposite, type IssuedComposite } from "../src/composite.js";

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
      rubricVersion: "2026.1-a1b2c3",
      scoringDigest: "0123456789abcdef",
      weight: 0.36,
    },
  ],
};

const WITHHELD = {
  state: "withheld",
  reason: "awaiting_track",
  awaiting: [{ trackId: "t3", trackState: "pending_judging", detail: "the jury has not reported" }],
  detail: "no composite is issued while a scored track has no score of record: T3.",
};

describe("parseAttemptComposite: the issued arm", () => {
  it("reads every field the service sends", () => {
    const c = parseAttemptComposite(ISSUED) as IssuedComposite;
    expect(c.state).toBe("issued");
    expect(c.composite).toBe(63.412);
    expect(c.band).toBe("Merit");
    expect(c.scoredBy).toBe("server");
    expect(c.cohort).toEqual({ kind: "demo", seed: "ailx-2026.1-demo-cohort", size: 44 });
    expect(c.bandCutlines.Distinction).toBe(76.1);
    expect(c.weights.t3).toBe(0.426666);
    expect(c.sources[0].scoreId).toBe("37");
  });

  it("keeps a null cutline, which a quota that rounded to zero really produces", () => {
    const c = parseAttemptComposite({
      ...ISSUED,
      bandCutlines: { Distinction: null, Merit: 62.9, Pass: 54.2 },
    }) as IssuedComposite;
    expect(c.bandCutlines.Distinction).toBeNull();
  });

  it.each([
    ["a missing composite", { composite: undefined }],
    ["a composite that is not finite", { composite: Number.NaN }],
    ["a band this build cannot name", { band: "Honours" }],
    ["a cutline that is not a number", { bandCutlines: { Distinction: "76.1", Merit: 1, Pass: 0 } }],
    ["a cohort of an unknown kind", { cohort: { kind: "panel", seed: "x", size: 2000 } }],
    ["a composite the browser is told it computed", { scoredBy: "local" }],
    ["a source with no score row to cite", { sources: [{ trackId: "t1", scaled: 1, weight: 0.5 }] }],
    ["sources that are not a list", { sources: null }],
  ])("refuses %s rather than showing half a composite", (_what, patch) => {
    expect(parseAttemptComposite({ ...ISSUED, ...patch })).toBeNull();
  });

  it("drops a weight that is not a number instead of the whole composite", () => {
    const c = parseAttemptComposite({
      ...ISSUED,
      weights: { t1: 0.36, t2: "heavy", t3: 0.426666 },
    }) as IssuedComposite;
    // A weight is provenance next to the number, not the number.
    expect(Object.keys(c.weights)).toEqual(["t1", "t3"]);
  });
});

describe("parseAttemptComposite: the withheld arm", () => {
  it("keeps the reason and the track it waits on", () => {
    const c = parseAttemptComposite(WITHHELD);
    expect(c).toEqual({
      state: "withheld",
      reason: "awaiting_track",
      awaiting: [
        { trackId: "t3", trackState: "pending_judging", detail: "the jury has not reported" },
      ],
      detail: WITHHELD.detail,
    });
  });

  it("reads an open sitting with nothing awaited", () => {
    const c = parseAttemptComposite({
      state: "withheld",
      reason: "not_finalized",
      awaiting: [],
      detail: "the sitting is open",
    });
    expect(c).toMatchObject({ reason: "not_finalized", awaiting: [] });
  });

  it("drops an awaited track whose state this build cannot name", () => {
    const c = parseAttemptComposite({
      ...WITHHELD,
      awaiting: [{ trackId: "t3", trackState: "being_marked_by_a_pigeon", detail: "" }],
    });
    expect(c).toMatchObject({ reason: "awaiting_track", awaiting: [] });
  });

  it("refuses a reason this build cannot name", () => {
    expect(parseAttemptComposite({ ...WITHHELD, reason: "because" })).toBeNull();
  });
});

describe("parseAttemptComposite: nothing readable", () => {
  it.each([[null], [undefined], ["issued"], [42], [{}], [{ state: "maybe" }], [[]]])(
    "reads %s as no answer, never as zero",
    (raw) => {
      expect(parseAttemptComposite(raw)).toBeNull();
    },
  );
});
