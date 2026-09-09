/**
 * THE SENTENCE THE GATE SAYS ABOUT THE EXAM SERVICE, ON A FULL SITTING
 * (TEN-128).
 *
 * WHAT THIS TABLE DOES NOT COVER, said first, because the name used to
 * claim the whole gate and did not freeze it:
 *  - `localSitting.sat` is FOUR TRACKS in every row. A partial sitting has a
 *    lede of its own (`partialSittingLede`) which is not in `SENTENCE` at
 *    all; it is covered in `partialReport.test.ts`, including the case where
 *    no track was sat.
 *  - the `final{}` rows stand for a finalized answer as ONE state. Its
 *    sub-states — how many tracks are still with the jury, and whether the
 *    composite was issued, withheld or never mentioned — are covered in
 *    `scoreOrdering.test.ts` and `partialReport.test.ts`.
 * What it does freeze is every combination of the five inputs that decide
 * WHICH SENTENCE about the exam service a finished full sitting gets.
 *
 * The lede a finished sitting gets when the exam service has not finalized
 * it took THREE review rounds, each one finding a state described in another
 * state's words: a score denied while the panel printed it, a request nobody
 * sent reported as one that came back empty, and a read still in flight
 * reported as one that failed. Each fix was true and each left a neighbour
 * wrong, because the states were never written down together.
 *
 * So they are written down here. Every combination of the five inputs that
 * decide this copy, the sentence each one produces, and whether the running
 * app can reach it at all:
 *
 *  - `asked`      — did a request ever go out (no identity, or no service)
 *  - `reading`    — is the FIRST read still in flight
 *  - `scores`     — undefined (no answer yet) · null (answered, no scores) ·
 *                   an open answer · a finalized answer
 *  - `completed`  — does THIS BROWSER's log say the run ended
 *  - `readFailed` — did the last read fail
 *
 * The unreachable rows are named, not skipped: an answer implies a request,
 * a failure implies a request, and `reading` is false the moment any answer
 * lands (`useScoresOfRecord`). They are asserted all the same, because a
 * future change that makes one reachable should show up as a diff here
 * rather than as a sentence in front of a candidate.
 */
import { describe, expect, it } from "vitest";
import { reportGate, type GateInput } from "../features/report/reportGate";
import type { AttemptScores } from "../features/report/scoresOfRecord";

const OPEN: AttemptScores = {
  finalized: false,
  pending: false,
  pollAfterMs: null,
  tracks: [],
  composite: null,
};
const FINAL: AttemptScores = { ...OPEN, finalized: true };
/** An open answer that nonetheless carries a score: `finalized !== true` is
    not a witness that no score exists, and the panel prints this one. */
const SCORED: AttemptScores = {
  ...OPEN,
  tracks: [
    {
      trackId: "t2",
      state: "scored",
      score: { raw: {}, scaled: 30.83 },
      rubricVersion: "r",
      scoringDigest: "d",
      issuedBy: "finalize",
      computedAt: "",
    },
  ],
};
const SCORES: Record<string, AttemptScores | null | undefined> = {
  undefined: undefined,
  null: null,
  "open{}": OPEN,
  "open+score": SCORED,
  "final{}": FINAL,
};

/** The one fragment that identifies each sentence this gate can produce. */
const SENTENCE: Record<string, string> = {
  reading: "Checking what the exam service has issued",
  finalized: "The scores of record are below, issued by the exam service.",
  "answered-has-scores": "What it has issued is below",
  "answered-no-scores": "and it has issued no scores of record for it",
  "answered-empty": "answered without any scores",
  "never-asked": "never asked the exam service",
  "read-failed": "did not land",
  "in-flight": "has not answered this page yet",
  lock: "Finish the run to see it",
};

/** asked · reading · scores · completed · readFailed · sentence · cta · reachable */
type Row = [string, string, string, string, string, string, string, boolean];

const TABLE: Row[] = [
  ["false", "false", "final{}", "false", "false", "finalized", "-", false],
  ["false", "false", "final{}", "false", "true", "finalized", "-", false],
  ["false", "false", "final{}", "true", "false", "finalized", "-", false],
  ["false", "false", "final{}", "true", "true", "finalized", "-", false],
  ["false", "false", "null", "false", "false", "lock", "/exam", false],
  ["false", "false", "null", "false", "true", "lock", "/exam", false],
  ["false", "false", "null", "true", "false", "answered-empty", "-", false],
  ["false", "false", "null", "true", "true", "answered-empty", "-", false],
  ["false", "false", "open+score", "false", "false", "lock", "/exam", false],
  ["false", "false", "open+score", "false", "true", "lock", "/exam", false],
  ["false", "false", "open+score", "true", "false", "answered-has-scores", "-", false],
  ["false", "false", "open+score", "true", "true", "answered-has-scores", "-", false],
  ["false", "false", "open{}", "false", "false", "lock", "/exam", false],
  ["false", "false", "open{}", "false", "true", "lock", "/exam", false],
  ["false", "false", "open{}", "true", "false", "answered-no-scores", "-", false],
  ["false", "false", "open{}", "true", "true", "answered-no-scores", "-", false],
  ["false", "false", "undefined", "false", "false", "lock", "/exam", true],
  ["false", "false", "undefined", "false", "true", "lock", "/exam", false],
  ["false", "false", "undefined", "true", "false", "never-asked", "-", true],
  ["false", "false", "undefined", "true", "true", "never-asked", "-", false],
  ["false", "true", "final{}", "false", "false", "reading", "-", false],
  ["false", "true", "final{}", "false", "true", "reading", "-", false],
  ["false", "true", "final{}", "true", "false", "reading", "-", false],
  ["false", "true", "final{}", "true", "true", "reading", "-", false],
  ["false", "true", "null", "false", "false", "reading", "-", false],
  ["false", "true", "null", "false", "true", "reading", "-", false],
  ["false", "true", "null", "true", "false", "reading", "-", false],
  ["false", "true", "null", "true", "true", "reading", "-", false],
  ["false", "true", "open+score", "false", "false", "reading", "-", false],
  ["false", "true", "open+score", "false", "true", "reading", "-", false],
  ["false", "true", "open+score", "true", "false", "reading", "-", false],
  ["false", "true", "open+score", "true", "true", "reading", "-", false],
  ["false", "true", "open{}", "false", "false", "reading", "-", false],
  ["false", "true", "open{}", "false", "true", "reading", "-", false],
  ["false", "true", "open{}", "true", "false", "reading", "-", false],
  ["false", "true", "open{}", "true", "true", "reading", "-", false],
  ["false", "true", "undefined", "false", "false", "reading", "-", true],
  ["false", "true", "undefined", "false", "true", "reading", "-", false],
  ["false", "true", "undefined", "true", "false", "reading", "-", true],
  ["false", "true", "undefined", "true", "true", "reading", "-", false],
  ["true", "false", "final{}", "false", "false", "finalized", "-", true],
  ["true", "false", "final{}", "false", "true", "finalized", "-", true],
  ["true", "false", "final{}", "true", "false", "finalized", "-", true],
  ["true", "false", "final{}", "true", "true", "finalized", "-", true],
  ["true", "false", "null", "false", "false", "lock", "/exam", true],
  ["true", "false", "null", "false", "true", "lock", "/exam", true],
  ["true", "false", "null", "true", "false", "answered-empty", "-", true],
  ["true", "false", "null", "true", "true", "answered-empty", "-", true],
  ["true", "false", "open+score", "false", "false", "lock", "/exam", true],
  ["true", "false", "open+score", "false", "true", "lock", "/exam", true],
  ["true", "false", "open+score", "true", "false", "answered-has-scores", "-", true],
  ["true", "false", "open+score", "true", "true", "answered-has-scores", "-", true],
  ["true", "false", "open{}", "false", "false", "lock", "/exam", true],
  ["true", "false", "open{}", "false", "true", "lock", "/exam", true],
  ["true", "false", "open{}", "true", "false", "answered-no-scores", "-", true],
  ["true", "false", "open{}", "true", "true", "answered-no-scores", "-", true],
  ["true", "false", "undefined", "false", "false", "lock", "/exam", true],
  ["true", "false", "undefined", "false", "true", "lock", "/exam", true],
  ["true", "false", "undefined", "true", "false", "in-flight", "-", true],
  ["true", "false", "undefined", "true", "true", "read-failed", "-", true],
  ["true", "true", "final{}", "false", "false", "reading", "-", false],
  ["true", "true", "final{}", "false", "true", "reading", "-", false],
  ["true", "true", "final{}", "true", "false", "reading", "-", false],
  ["true", "true", "final{}", "true", "true", "reading", "-", false],
  ["true", "true", "null", "false", "false", "reading", "-", false],
  ["true", "true", "null", "false", "true", "reading", "-", false],
  ["true", "true", "null", "true", "false", "reading", "-", false],
  ["true", "true", "null", "true", "true", "reading", "-", false],
  ["true", "true", "open+score", "false", "false", "reading", "-", false],
  ["true", "true", "open+score", "false", "true", "reading", "-", false],
  ["true", "true", "open+score", "true", "false", "reading", "-", false],
  ["true", "true", "open+score", "true", "true", "reading", "-", false],
  ["true", "true", "open{}", "false", "false", "reading", "-", false],
  ["true", "true", "open{}", "false", "true", "reading", "-", false],
  ["true", "true", "open{}", "true", "false", "reading", "-", false],
  ["true", "true", "open{}", "true", "true", "reading", "-", false],
  ["true", "true", "undefined", "false", "false", "reading", "-", true],
  ["true", "true", "undefined", "false", "true", "reading", "-", false],
  ["true", "true", "undefined", "true", "false", "reading", "-", true],
  ["true", "true", "undefined", "true", "true", "reading", "-", false],
];

describe("the service sentence on a full sitting: every read state, one sentence each", () => {
  it.each(TABLE)(
    "asked=%s reading=%s scores=%s completed=%s readFailed=%s → %s (cta %s)",
    (asked, reading, scores, completed, readFailed, sentence, cta) => {
      const input: GateInput = {
        localScored: ["t1", "t2", "t3"],
        scores: SCORES[scores],
        reading: reading === "true",
        asked: asked === "true",
        readFailed: readFailed === "true",
        localSitting: { completed: completed === "true", sat: ["t1", "t2", "t3", "t4"] },
      };
      const view = reportGate(input);
      expect(view.lede).toContain(SENTENCE[sentence]);
      // Exactly ONE sentence: no cell may state two of these facts at once.
      const matched = Object.entries(SENTENCE).filter(([, f]) => view.lede.includes(f));
      expect(matched.map(([k]) => k)).toEqual([sentence]);
      expect(view.cta === null ? "-" : view.cta.href).toBe(cta);
    },
  );

  it("offers a way on ONLY where there is one: an unfinished run", () => {
    const withCta = TABLE.filter((r) => r[6] !== "-");
    expect(withCta.every((r) => r[3] === "false")).toBe(true);
    expect(withCta.every((r) => r[5] === "lock")).toBe(true);
  });

  it("covers every combination of the five inputs it varies", () => {
    expect(TABLE).toHaveLength(2 * 2 * 5 * 2 * 2);
    expect(new Set(TABLE.map((r) => r.slice(0, 5).join("|"))).size).toBe(TABLE.length);
  });

  it("names which rows the running app can reach, and reaches no other sentence", () => {
    /* An answer implies a request, a failure implies a request, the first
       read being in flight implies no answer has landed yet, and a failure
       implies the page is no longer reading (`useScoresOfRecord`). Each
       clause is a claim about the PRODUCER, so each is written from the
       hook's own expression rather than from what looks safe. */
    for (const [asked, reading, scores, , readFailed, , , reachable] of TABLE) {
      const impossible =
        (asked === "false" && (scores !== "undefined" || readFailed === "true")) ||
        (reading === "true" && scores !== "undefined") ||
        /* A failed read SETS `failure`, and `reading` is
           `scores === undefined && failure === null && !identityWaited` —
           so a page cannot be reading and holding a failed read at once. */
        (reading === "true" && readFailed === "true");
      expect(reachable).toBe(!impossible);
    }
    // Every sentence the gate can say is reachable in some row.
    const live = new Set(TABLE.filter((r) => r[7]).map((r) => r[5]));
    expect([...live].sort()).toEqual(Object.keys(SENTENCE).sort());
  });
});
