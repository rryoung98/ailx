/**
 * Skill diagnosis — "what am I actually good at, and what do I do next?"
 *
 * The report already tells a candidate WHERE they landed. This module turns
 * that into something ACTIONABLE: the track that carried the run, the track
 * that cost it, the process habit behind it, and the next concrete thing to
 * do about it — which for the artefact families is a drill that already
 * exists (`practice.ts`), so the loop closes: diagnose -> practice -> re-sit.
 *
 * THREE RULES, all of them load-bearing.
 *
 *  1. HONEST OR ABSENT. Same posture as `PROGRESS_BASIS`: the judging
 *     pipeline (spec Phase 4) is not built and `scores` is empty, so nothing
 *     here emits a percentile, a cohort rank, a judged composite or a norm.
 *     Every figure is either the run's OWN scorer output or a count of the
 *     candidate's own actions, and `DIAGNOSIS_BASIS` says so wherever it is
 *     drawn.
 *  2. NO ITEM LEAKAGE, EVER. The inputs are the four aggregate track values
 *     and the SAME per-track process subset the share payload allowlists
 *     (`ShareProcess`) — time on task, iteration ratio, verification actions.
 *     No item id, no item text, no answer key, no per-item correctness,
 *     confidence or latency, and deliberately no event/verb counts and no T2
 *     d'/Brier/deck sizes: those describe the DECK, not the person, and a
 *     sibling excluded them from sharing for exactly that reason. Every
 *     sentence below is a fixed string chosen by an aggregate, so the text is
 *     INVARIANT to bank content (asserted in the tests).
 *  3. ONE VOCABULARY. The per-track sentences come from `AXES` in
 *     `playerType.ts`, the names from `TRACK_META`, the drill families from
 *     `practice.ts`. Diagnosis adds a priority order and an action; it does
 *     not restate the product's language a second time (DRY).
 *
 * Pure: no clock, no I/O, no randomness.
 */
import type { TrackId, TrackRawScores } from "@ailx/session";
import { AXES, cohortMedians } from "./playerType.js";
import { ARTEFACT_FAMILIES, FAMILY_META } from "./practice.js";
import { TRACK_META } from "./tracks.js";
import type { ShareProcess, ShareProcessTrack } from "./share.js";

/**
 * The one sentence every diagnosis figure is qualified by. Exported so the
 * page, the tests and any future surface share ONE wording (DRY), exactly
 * like `PROGRESS_BASIS`.
 */
export const DIAGNOSIS_BASIS =
  "Read from this one run: each track's own scorer output from its stored event log, plus what "
  + "you did with your own time. No percentile, no cohort rank and no judged result — the judging "
  + "pipeline is not built yet, so a number implying one would be a claim we cannot back.";

/** Strength or watchout, split at the demo cohort's per-track median. */
export type DiagnosisLevel = "strength" | "watch";

export interface DiagnosisFinding {
  track: TrackId;
  /** 'T1'..'T4' — the code the rest of the product shows. */
  code: string;
  /** The track's full name, from TRACK_META. */
  name: string;
  level: DiagnosisLevel;
  /** One line, in the candidate's language. Fixed text, never item-derived. */
  headline: string;
  /** The run's own 0-100 track value, one decimal. */
  value: number;
}

/** What to DO about a finding. `href` is an in-app path, never external. */
export interface DiagnosisAction {
  track: TrackId;
  /** Button text. */
  label: string;
  href: string;
  /** Why this is the next step — one sentence, shown under the button. */
  detail: string;
  /** True when the action is the practice drill (the only one that exists). */
  drill: boolean;
}

export interface DiagnosisProcessNote {
  headline: string;
  detail: string;
}

export interface Diagnosis {
  /** Watchouts first, weakest track first: the thing to fix leads. */
  findings: DiagnosisFinding[];
  /** The single weakest track, or null when nothing sits below the median. */
  weakest: DiagnosisFinding | null;
  /** The single strongest track, or null when nothing sits above it. */
  strongest: DiagnosisFinding | null;
  /** Actions for the watchouts, in the same priority order. Never empty. */
  actions: DiagnosisAction[];
  /** Habits read from the candidate's OWN time and actions. May be empty. */
  process: DiagnosisProcessNote[];
  /** One line, "you X well but Y" — the honest summary the user asked for. */
  summary: string;
  basis: string;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** The families the drill teaches, named once, in the drill's own order. */
const FAMILY_NAMES = ARTEFACT_FAMILIES.map((f) => FAMILY_META[f].name.toLowerCase()).join(", ");

/**
 * The next step per track. T2 has a real drill; the other three do not yet,
 * and saying so is better than inventing one — the action there is the
 * specific behaviour to change on the next sitting.
 */
const ACTIONS: Record<TrackId, Omit<DiagnosisAction, "track">> = {
  t1: {
    label: "Re-read the T1 brief",
    href: "/methodology",
    detail:
      "Push one more revision before you ship: the gates and the design rationale are where "
      + "first-draft builds lose points.",
    drill: false,
  },
  t2: {
    label: "Drill the artefact families",
    href: "/practice",
    detail: `A few minutes on ${FAMILY_NAMES} — immediate right/wrong on each call is what moves detection.`,
    drill: true,
  },
  t3: {
    label: "See how T3 is scored",
    href: "/methodology",
    detail:
      "Check the assistant against a source before you act on it: planted errors are found by "
      + "verifying, not by reading harder.",
    drill: false,
  },
  t4: {
    label: "See how T4 is scored",
    href: "/methodology",
    detail:
      "Decide the message before you spend a generation — the score is agreement with the "
      + "brief's stated intent, not render count.",
    drill: false,
  },
};

/** Under this share of the budget a track was rushed rather than finished. */
export const RUSHED_BUDGET_FRAC = 0.25;
/** At or above this, revise/regenerate reads as deliberate iteration. */
export const DELIBERATE_ITERATION = 0.5;

const codes = (tracks: readonly ShareProcessTrack[]): string =>
  tracks.map((t) => TRACK_META[t.track].code).join(", ");

/**
 * Habits, from the candidate's own figures only. Each note is a fixed string
 * selected by an aggregate; none of them counts an item or an event verb.
 */
function processNotes(process: ShareProcess | null): DiagnosisProcessNote[] {
  if (process === null) return [];
  const notes: DiagnosisProcessNote[] = [];
  const verifications = process.tracks.reduce((a, t) => a + t.verificationEvents, 0);
  notes.push(
    verifications > 0
      ? {
          headline: "You check things",
          detail: `${verifications} verification action(s) recorded across the run. That habit is what T3 rewards.`,
        }
      : {
          headline: "No verification actions recorded",
          detail:
            "You never went back to a source. It is the most common finding here, and the cheapest one to fix.",
        },
  );
  const iterated = process.tracks.filter((t) => t.iterationRatio !== null);
  if (iterated.length > 0) {
    const avg = iterated.reduce((a, t) => a + (t.iterationRatio ?? 0), 0) / iterated.length;
    notes.push(
      avg >= DELIBERATE_ITERATION
        ? {
            headline: "Your iteration is deliberate",
            detail: `About ${avg.toFixed(2)} revisions per prompt — you steer instead of accepting the first answer.`,
          }
        : {
            headline: "You accept the first answer",
            detail: `About ${avg.toFixed(2)} revisions per prompt. One more pass is usually the difference.`,
          },
    );
  }
  const timedOut = process.tracks.filter((t) => t.timedOut);
  const rushed = process.tracks.filter(
    (t) => !t.timedOut && t.budgetSeconds > 0 && t.activeSeconds / t.budgetSeconds < RUSHED_BUDGET_FRAC,
  );
  if (timedOut.length > 0) {
    notes.push({
      headline: "You ran out of clock",
      detail: `${codes(timedOut)} ended on the timer. Bank a submission earlier, then improve it.`,
    });
  } else if (rushed.length > 0) {
    notes.push({
      headline: "You finished early",
      detail: `${codes(rushed)} used under a quarter of the budget. Speed is never rewarded with points — the time was free.`,
    });
  }
  return notes;
}

/**
 * Diagnose one finished run.
 *
 * `trackRaw` is the run's own four aggregate scores; `process` is the
 * allowlisted process subset (pass null when the candidate has none, e.g. a
 * payload whose owner switched the section off). Returns findings ordered
 * watchouts-first-weakest-first, the matching actions, and a one-line
 * summary of the form "you X well, but Y".
 */
export function diagnose(input: {
  trackRaw: TrackRawScores;
  process?: ShareProcess | null;
}): Diagnosis {
  const med = cohortMedians();
  const findings = AXES.map((axis) => {
    const meta = TRACK_META[axis.track];
    const value = input.trackRaw[axis.track];
    // MARGIN, not raw value: the four tracks are scored on their own scales,
    // so "weakest" can only mean furthest below this track's own median.
    // Comparing raw values across tracks would rank the scales, not the run.
    const margin = value - med[axis.track];
    const high = margin >= 0;
    return {
      finding: {
        track: axis.track,
        code: meta.code,
        name: meta.name,
        level: high ? ("strength" as const) : ("watch" as const),
        headline: high ? axis.strength : axis.watchout,
        value: round1(value),
      },
      margin,
    };
  });
  // Watchouts first, and inside each group the most extreme case first: the
  // thing to fix leads, the thing that carried the run reassures.
  const ordered: DiagnosisFinding[] = [...findings]
    .sort((a, b) => {
      if (a.finding.level !== b.finding.level) return a.finding.level === "watch" ? -1 : 1;
      return a.finding.level === "watch" ? a.margin - b.margin : b.margin - a.margin;
    })
    .map((f) => f.finding);
  const watch = ordered.filter((f) => f.level === "watch");
  const strengths = ordered.filter((f) => f.level === "strength");
  const weakest = watch[0] ?? null;
  const strongest = strengths[0] ?? null;

  // An action for every watchout; a run with no watchout still gets the one
  // drill that exists, because "nothing to do" is not a useful diagnosis.
  const actionTracks = watch.length > 0 ? watch.map((f) => f.track) : (["t2"] as TrackId[]);
  const actions = actionTracks.map((track) => ({ track, ...ACTIONS[track] }));

  return {
    findings: ordered,
    weakest,
    strongest,
    actions,
    process: processNotes(input.process ?? null),
    summary: summarize(strongest, weakest),
    basis: DIAGNOSIS_BASIS,
  };
}

/** "You direct models well, but synthetic media gets past you." */
function summarize(strongest: DiagnosisFinding | null, weakest: DiagnosisFinding | null): string {
  if (strongest !== null && weakest !== null) {
    return `${strongest.headline} ${weakest.headline}`;
  }
  if (strongest !== null) {
    return `All four tracks came in at or above this cohort's median. ${strongest.headline}`;
  }
  if (weakest !== null) {
    return `Every track has room in it. Start here: ${weakest.headline}`;
  }
  /* c8 ignore next 2 -- unreachable: TRACK_IDS is non-empty, so one of the
     two branches above always holds. Kept so the return type is total. */
  return DIAGNOSIS_BASIS;
}
