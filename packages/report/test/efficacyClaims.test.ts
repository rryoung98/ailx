/**
 * The efficacy-claim gate, at the layer where the words are decided.
 *
 * WHY THIS FILE EXISTS. AILX's practice surface is gamified drilling with
 * immediate right/wrong feedback. Those are precisely the two arms that
 * FAILED in the only well-powered trial of this intervention class —
 * Geissler, Robertson & Feuerriegel, arXiv 2507.23492, N = 1,200: gamified
 * p_adj = 0.310, feedback p_adj = 1.000, and at a two-week follow-up NO arm
 * beat control. Gray et al. (R. Soc. Open Sci. 12:250921, 2025) adds the
 * second half of the problem: their trained typical adults gained accuracy
 * with d' = -0.066 (p = .279), i.e. the CRITERION moved and the SENSITIVITY
 * did not. A product that tells such a person they are "getting better at
 * spotting fakes" is manufacturing false confidence.
 *
 * So the rule this file enforces is narrow and absolute: the pure copy layer
 * (@ailx/report), which is where every product surface gets its sentences
 * from, may describe ACTIVITY — cards, days, streaks, what changed — and may
 * DENY efficacy, but may never ASSERT it.
 *
 * The denial constants are excluded from the scan by identity, not by
 * cleverness about negation: a rule that tried to parse "we do not claim it
 * makes you better" would be the kind of test that cannot fail.
 */
import { describe, expect, it } from "vitest";
import {
  DIAGNOSIS_BASIS,
  PRACTICE_ACCURACY_CAVEAT,
  PRACTICE_EFFICACY_NOTE,
  PRACTICE_EFFICACY_NOTE_SHORT,
  PROGRESS_BASIS,
  diagnose,
} from "../src/index.js";
import type { TrackRawScores } from "@ailx/session";

/**
 * Assertions of an ability gain. Shared with apps/web's rendered-surface gate
 * in spirit; kept here as the canonical list because this package owns the
 * words. Each pattern is an assertion form, never a denial form.
 */
export const EFFICACY_CLAIM = [
  /\bmoves detection\b/i,
  /\bimproves? (your|their|people'?s?)\b/i,
  /\bmakes you (better|sharper)\b/i,
  /\bgetting better at\b/i,
  /\bbetter at (spotting|detecting|telling)\b/i,
  /\byou will (get|be) better\b/i,
  /\btrains your\b/i,
  /\bsharpens? your\b/i,
  /\bboosts? your\b/i,
  /\bmeasurably (works|improves)\b/i,
  /\bproven to\b/i,
  /\braises? your (score|accuracy|d')\b/i,
];

/**
 * Remove the DENIAL constants before scanning. They legitimately contain the
 * banned words ("we do not claim it makes you better"), and excluding them by
 * exact identity is the only way to do this that a future rewording cannot
 * quietly defeat — change the constant and it stops being excluded.
 */
export function withoutDenials(text: string): string {
  return [PRACTICE_EFFICACY_NOTE, PRACTICE_EFFICACY_NOTE_SHORT].reduce(
    (acc, denial) => acc.split(denial).join(" "),
    text,
  );
}

export function findEfficacyClaim(raw: string): string | null {
  const text = withoutDenials(raw);
  for (const re of EFFICACY_CLAIM) {
    const m = text.match(re);
    if (m !== null) return m[0];
  }
  return null;
}

const WEAK: TrackRawScores = { t1: 40, t2: 20, t3: 40, t4: 40 };
const STRONG: TrackRawScores = { t1: 90, t2: 90, t3: 90, t4: 90 };

function diagnosisText(trackRaw: TrackRawScores): string {
  const d = diagnose({ trackRaw });
  return [
    d.summary,
    d.basis,
    ...d.findings.map((f) => `${f.headline} ${f.name}`),
    ...d.actions.map((a) => `${a.label} ${a.detail}`),
    ...d.process.map((p) => `${p.headline} ${p.detail}`),
  ].join(" ");
}

describe("no unevidenced efficacy claim in the copy layer", () => {
  it("the T2 drill action describes the drill and claims nothing for it", () => {
    const action = diagnose({ trackRaw: WEAK }).actions.find((a) => a.drill);
    expect(action).toBeDefined();
    expect(findEfficacyClaim(action!.detail)).toBeNull();
    // the ban is real: the sentence we removed would still be caught
    expect(findEfficacyClaim("immediate right/wrong on each call is what moves detection"))
      .toBe("moves detection");
    // and it carries the denial rather than merely omitting the claim
    expect(action!.detail).toContain(PRACTICE_EFFICACY_NOTE_SHORT);
  });

  it("no diagnosis a run can produce asserts an ability gain", () => {
    for (const raw of [WEAK, STRONG, { t1: 90, t2: 20, t3: 55, t4: 70 }]) {
      const text = diagnosisText(raw);
      expect(findEfficacyClaim(text), `${findEfficacyClaim(text)} in: ${text}`).toBeNull();
    }
  });

  it("the standing qualifiers assert nothing either", () => {
    for (const s of [DIAGNOSIS_BASIS, PROGRESS_BASIS, PRACTICE_ACCURACY_CAVEAT]) {
      expect(findEfficacyClaim(s), s).toBeNull();
    }
  });
});

describe("the denial itself", () => {
  it("the short note is the first sentence of the long one, so they cannot drift", () => {
    expect(PRACTICE_EFFICACY_NOTE.startsWith(PRACTICE_EFFICACY_NOTE_SHORT)).toBe(true);
  });

  it("denies the efficacy claim rather than going quiet about it", () => {
    expect(PRACTICE_EFFICACY_NOTE_SHORT).toMatch(/\bdo not claim\b/i);
    expect(PRACTICE_EFFICACY_NOTE_SHORT).toMatch(/\bbetter\b/i);
  });

  it("names the two things that make a rising practice percentage unreadable", () => {
    // repetition of a small corpus, and criterion vs sensitivity. Both have to
    // be in the words a person actually reads, not only in a code comment.
    expect(PRACTICE_ACCURACY_CAVEAT).toMatch(/again and again|already been given the answer/i);
    expect(PRACTICE_ACCURACY_CAVEAT).toMatch(/readiness to call/i);
  });

  it("the long note reports that the trial found no advantage, with its size", () => {
    expect(PRACTICE_EFFICACY_NOTE).toMatch(/1,200/);
    expect(PRACTICE_EFFICACY_NOTE).toMatch(/no advantage/i);
    expect(PRACTICE_EFFICACY_NOTE).toMatch(/two weeks/i);
  });
});
