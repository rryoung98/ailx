/**
 * Player type — an MBTI-style lens on a finished run. PLAYFUL, not
 * psychometric: four axes, ONE PER TRACK, and a four-letter code.
 *
 * There is exactly one identity in the report. An earlier second system
 * (`personality.ts`, codes like `KCVI`) derived a parallel set of sixteen
 * archetypes from behavioural measures, with letters that COLLIDED with these
 * ones (`V`/`A` meant two different things). It is gone; what was good about
 * it — deriving an axis from what the candidate DID, and printing the
 * measurement under each axis — moved here.
 *
 * HOW AN AXIS IS DECIDED
 *  - With a behavioural SIGNAL (`identitySignals`): the axis reads the
 *    candidate's own recorded behaviour — T1 iteration, T2 sensitivity, T3
 *    verification events.
 *  - Without one: the axis falls back to this track's score against the demo
 *    cohort's per-track median. `worldAggregates` only ever holds four
 *    aggregate scores per run, so the world distribution always reads this
 *    way, and so does any caller that has no event log.
 *
 * Every axis carries the string it was decided from, so the card can show its
 * own evidence instead of asking to be believed. The scored composite never
 * reads any of this.
 */
import { TRACK_IDS, type SessionState, type TrackId, type TrackRawScores } from "@ailx/session";
import { demoCohortRows } from "./demo.js";
import { trackInsights, type TrackProcessInsight } from "./insights.js";
import { TRACK_META } from "./tracks.js";

export interface Pole {
  track: TrackId;
  letter: string;
  label: string;
  high: boolean;
  /** 50–100: how far toward the chosen pole the evidence sits. */
  strength: number;
  /** The measured quantity this pole was read from, in words. */
  evidence: string;
}

export interface PlayerType {
  code: string;
  name: string;
  tagline: string;
  poles: Pole[];
  strengths: string[];
  watchouts: string[];
}

/**
 * One axis' behavioural reading: position toward the HIGH pole in [0,1], plus
 * the measurement it came from. Supplied per track; a missing track falls back
 * to the cohort-median split on that track's score.
 */
export interface AxisSignal {
  /** 0–1 toward the HIGH pole. 0.5 and above chooses the high letter. */
  value: number;
  /** Human-readable measurement, e.g. "Brier 0.183 over 6 of 6 items". */
  evidence: string;
}

export type PlayerTypeSignals = Partial<Record<TrackId, AxisSignal>>;

export const AXES = [
  { track: "t1" as const, hi: { letter: "M", label: "Maker" }, lo: { letter: "P", label: "Prompter" },
    strength: "You ship: direction turns into a working thing.",
    watchout: "Your builds lean on the model's first answer — push a revision further next run." },
  { track: "t2" as const, hi: { letter: "S", label: "Skeptic" }, lo: { letter: "T", label: "Truster" },
    strength: "Fakes have a hard time getting past you.",
    watchout: "Polished synthetic media still reads as real to you — slow down on the pretty ones." },
  { track: "t3" as const, hi: { letter: "V", label: "Verifier" }, lo: { letter: "A", label: "Accepter" },
    strength: "You check the assistant against the source before you act on it.",
    watchout: "A confident assistant can walk you past a planted error — verify the numbers." },
  { track: "t4" as const, hi: { letter: "D", label: "Director" }, lo: { letter: "E", label: "Explorer" },
    strength: "You direct generation toward one readable idea and know when it landed.",
    watchout: "Your prompts wander — pick the message first, then spend your renders on it." },
];

const NAMES: Record<string, [string, string]> = {
  MSVD: ["The Full-Stack Skeptic", "Builds it, doubts it, checks it, directs it. The whole game, played straight."],
  MSVE: ["The Craft Detective", "Makes real things and catches fake ones; the camera work is still warming up."],
  MSAD: ["The Sharp-Eyed Director", "Strong hands and a strong eye — the assistant just gets more trust than it earned."],
  MSAE: ["The Street-Smart Maker", "Ships and spots fakes on instinct; sources and storyboards come second."],
  MTVD: ["The Trusting Auteur", "Builds and directs with real control, and takes images at face value."],
  MTVE: ["The Careful Builder", "Solid work, checked claims — the visual side is still finding its voice."],
  MTAD: ["The Flow Director", "Momentum player: makes and directs fast, believes fast too."],
  MTAE: ["The Easygoing Maker", "Happy building; the adversarial half of the game hasn't bitten yet."],
  PSVD: ["The Discerning Director", "Sees through fakes, checks the record, frames the shot — building is delegated."],
  PSVE: ["The Critical Eye", "A reviewer's run: sharp on what's false, lighter on what's made."],
  PSAD: ["The Instinct Director", "Good eye, good frame, quick trust — a fact-check away from dangerous."],
  PSAE: ["The Gut-Check Player", "Runs on instinct: strong on fakes, loose everywhere else."],
  PTVD: ["The Methodical Director", "Verifies and directs with intent; making and detecting want more reps."],
  PTVE: ["The Quiet Verifier", "Trusts images, not claims. The receipts get read."],
  PTAD: ["The Bold Director", "All frame, no brakes — the set looks great and nobody checked anything."],
  PTAE: ["The Explorer", "First contact with all four tracks. Every axis is still in play."],
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Per-track cohort medians (demo cohort, deterministic). */
export function cohortMedians(): TrackRawScores {
  const cohort = demoCohortRows();
  const med = {} as TrackRawScores;
  for (const t of TRACK_IDS) {
    const v = cohort.map((r) => r[t]).sort((a, b) => a - b);
    med[t] = (v[Math.floor((v.length - 1) / 2)] + v[Math.ceil((v.length - 1) / 2)]) / 2;
  }
  return med;
}

/**
 * Points the T2 scorer awards for sensitivity — the denominator that turns
 * earned sensitivity points into "fraction of ATTAINABLE d′". The scorer's
 * own deck-aware ceiling is already inside that number, so a flawless short
 * deck reads as fully Skeptic rather than being punished for a small deck.
 */
const T2_SENSITIVITY_POINTS = 60;

/**
 * Display saturation points, NOT norms. They fix where a meter reaches its
 * end; they never enter a score and no cohort claim is made from them.
 * `1` revise/regenerate per prompt is a fully iterative build; three checked
 * claims is a run that went back to the source as a habit.
 */
const T1_FULL_ITERATION_RATIO = 1;
const T3_FULL_VERIFICATION_EVENTS = 3;

/**
 * Read the behavioural signals for the four axes out of a scored session.
 *
 * A signal is emitted ONLY where the run actually recorded the behaviour:
 * silence is no evidence, not evidence of the low pole, so a track with
 * nothing recorded falls back to its score rather than reading as Prompter or
 * Accepter for free. T4 has no process measure that means "directed", so it
 * always reads from the score.
 */
export function identitySignals(
  state: SessionState,
  insights: readonly TrackProcessInsight[] = trackInsights(state),
): PlayerTypeSignals {
  const signals: PlayerTypeSignals = {};
  const by = (t: TrackId) => insights.find((i) => i.trackId === t);

  // T1 Maker/Prompter — did the build get revised, or was the model's first
  // answer the answer? Exactly the behaviour the axis' watchout describes.
  const t1 = by("t1");
  if (t1 && t1.iterationRatio !== null) {
    signals.t1 = {
      value: clamp01(t1.iterationRatio / T1_FULL_ITERATION_RATIO),
      evidence: `${t1.iterationRatio.toFixed(2)} revise/regenerate action${
        t1.iterationRatio === 1 ? "" : "s"
      } per prompt in T1`,
    };
  }

  // T2 Skeptic/Truster — sensitivity (d′), not the composite track score: the
  // track score also carries calibration and provenance points, which are not
  // what "spots a fake" means.
  const t2raw = state.tracks.t2.score?.raw;
  if (t2raw && t2raw.invalid === undefined && typeof t2raw.sensitivity === "number") {
    const dPrime = typeof t2raw.dPrime === "number" ? t2raw.dPrime : 0;
    signals.t2 = {
      value: clamp01(t2raw.sensitivity / T2_SENSITIVITY_POINTS),
      evidence: `T2 sensitivity d′ ${dPrime.toFixed(2)} (${t2raw.sensitivity.toFixed(
        1,
      )} of ${T2_SENSITIVITY_POINTS} attainable points)`,
    };
  }

  // T3 Verifier/Accepter — the candidate's own verification actions. Same
  // field the narratives and the share process section read (verified +
  // UNIQUE challenged claims), so the report can never disagree with itself.
  const t3 = by("t3");
  if (t3 && t3.eventCount > 0) {
    signals.t3 = {
      value: clamp01(t3.verificationEvents / T3_FULL_VERIFICATION_EVENTS),
      evidence: `${t3.verificationEvents} verification event${
        t3.verificationEvents === 1 ? "" : "s"
      } (unique claims) in the T3 log`,
    };
  }

  return signals;
}

/**
 * Decide the type. `signals` is optional: with it each axis reads behaviour,
 * without it every axis reads its track score against the cohort median.
 */
export function playerType(trackRaw: TrackRawScores, signals: PlayerTypeSignals = {}): PlayerType {
  const med = cohortMedians();
  const poles: Pole[] = AXES.map((a) => {
    const signal = signals[a.track];
    // Fallback position: distance from this track's median on the 0-100
    // scale, halved onto [0,1]. `>= 0.5` is exactly `score >= median`, so the
    // letter and the meter can never disagree.
    const value = signal
      ? clamp01(signal.value)
      : clamp01(0.5 + (trackRaw[a.track] - med[a.track]) / 200);
    const high = value >= 0.5;
    const side = high ? a.hi : a.lo;
    return {
      track: a.track,
      letter: side.letter,
      label: side.label,
      high,
      strength: Math.round((high ? value : 1 - value) * 100),
      evidence:
        signal?.evidence ??
        `${TRACK_META[a.track].code} score ${trackRaw[a.track].toFixed(1)} vs cohort median ${med[
          a.track
        ].toFixed(1)}`,
    };
  });
  const code = poles.map((p) => p.letter).join("");
  const [name, tagline] = NAMES[code];
  return {
    code,
    name,
    tagline,
    poles,
    strengths: AXES.filter((_, i) => poles[i].high).map((a) => a.strength),
    watchouts: AXES.filter((_, i) => !poles[i].high).map((a) => a.watchout),
  };
}

/** The type for a scored session, reading behaviour wherever it was recorded. */
export function playerTypeFor(
  state: SessionState,
  trackRaw: TrackRawScores,
  insights?: readonly TrackProcessInsight[],
): PlayerType {
  return playerType(trackRaw, identitySignals(state, insights ?? trackInsights(state)));
}
