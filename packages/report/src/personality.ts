/**
 * MBTI-style "player profile" for the diagnostic report — a playful,
 * deterministic re-read of data the report already shows (T2 signal-
 * detection diagnostics + event-derived process insights). Four bipolar
 * axes produce a four-letter code and an archetype name. It is presentation
 * only: it never adds to or subtracts from any score.
 */

import type { SessionState } from "@ailx/session";
import type { TrackProcessInsight } from "./insights.js";

export interface ProfileAxis {
  key: "eye" | "calibration" | "process" | "making";
  /** Position in [0,1] toward the FIRST pole. */
  value: number;
  /** Chosen pole letter (one of `letters`). */
  letter: string;
  /** Chosen pole name (one of `poles`). */
  pole: string;
  /** 50–100: how far toward the chosen pole. */
  strength: number;
  poles: [string, string];
  letters: [string, string];
  /** The measured quantity this axis was derived from. */
  basis: string;
}

export interface PlayerProfile {
  /** Four letters, e.g. "KCVI". */
  code: string;
  archetype: string;
  blurb: string;
  axes: ProfileAxis[];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function axis(
  key: ProfileAxis["key"],
  poles: [string, string],
  letters: [string, string],
  value: number,
  basis: string,
): ProfileAxis {
  const v = clamp01(value);
  const first = v >= 0.5;
  return {
    key,
    value: Math.round(v * 1000) / 1000,
    letter: first ? letters[0] : letters[1],
    pole: first ? poles[0] : poles[1],
    strength: Math.round((first ? v : 1 - v) * 100),
    poles,
    letters,
    basis,
  };
}

/** 16 archetypes, keyed by the four-letter code. */
export const ARCHETYPES: Record<string, string> = {
  KCVI: "The Forensic Director",
  KCVO: "The Sharpshooter",
  KCAI: "The Craft Skeptic",
  KCAO: "The Quick Judge",
  KBVI: "The Zealous Auditor",
  KBVO: "The Confident Hawk",
  KBAI: "The Instinct Player",
  KBAO: "The Gunslinger",
  TCVI: "The Careful Apprentice",
  TCVO: "The Measured Optimist",
  TCAI: "The Open-Handed Maker",
  TCAO: "The Easygoing Guest",
  TBVI: "The Earnest Tinkerer",
  TBVO: "The Big-Swing Optimist",
  TBAI: "The Free Spirit",
  TBAO: "The True Believer",
};

const POLE_FRAGMENTS: Record<string, string> = {
  K: "you catch the tells in synthetic media",
  T: "you extend good faith to what you are shown",
  C: "your confidence tracks your accuracy",
  B: "you back your calls at full volume",
  V: "you go back to the source before you accept",
  A: "you take outputs as offered",
  I: "you iterate your way to the answer",
  O: "you commit to the first take",
};

function blurbFor(axes: ProfileAxis[]): string {
  const parts = axes.map((a) => POLE_FRAGMENTS[a.letter]);
  const s = parts.join("; ");
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}

/**
 * Derive the profile from a scored session. Returns null until T2 has a
 * valid score (the report only renders once every track is scored).
 */
export function playerProfile(
  state: SessionState,
  insights: TrackProcessInsight[],
): PlayerProfile | null {
  const t2raw = state.tracks.t2.score?.raw;
  if (!t2raw || t2raw.invalid !== undefined) return null;

  const dPrime = t2raw.dPrime ?? 0;
  const brier = t2raw.brier ?? 0.25;
  const answered = t2raw.answeredBinary ?? 0;
  const nBinary = (t2raw.nSignal ?? 0) + (t2raw.nNoise ?? 0);
  const answeredFrac = nBinary > 0 ? answered / nBinary : 0;
  // Same field the narratives read (verified + unique challenged claims) —
  // the two report sections must never disagree about verification.
  const verifyish = insights.reduce((a, i) => a + i.verificationEvents, 0);
  const iterTracks = insights.filter((i) => i.iterationRatio !== null);
  const iterAvg = iterTracks.length
    ? iterTracks.reduce((a, i) => a + (i.iterationRatio ?? 0), 0) / iterTracks.length
    : 0;

  const axes: ProfileAxis[] = [
    axis(
      "eye",
      ["Keen-eyed", "Trusting"],
      ["K", "T"],
      // Fraction of attainable sensitivity points (respects the deck-aware
      // d′ ceiling), so a flawless short deck reads as fully Keen-eyed.
      (t2raw.sensitivity ?? 0) / 60,
      `T2 sensitivity d′ = ${dPrime.toFixed(2)}`,
    ),
    axis(
      "calibration",
      ["Calibrated", "Bold"],
      ["C", "B"],
      // Evidence-weighted: shrink toward the midpoint by answered fraction,
      // so one lucky tap on a lapsed-out deck cannot read as fully
      // Calibrated (the scorer discounts the same way via coverage).
      answered > 0 ? 0.5 + (clamp01(1 - 2 * brier) - 0.5) * answeredFrac : 0.5,
      answered > 0
        ? `Brier ${brier.toFixed(3)} over ${answered} of ${nBinary} answered item${answered === 1 ? "" : "s"}`
        : "no answered T2 items — axis sits at the midpoint",
    ),
    axis(
      "process",
      ["Verifying", "Accepting"],
      ["V", "A"],
      verifyish / 3,
      `${verifyish} verification event${verifyish === 1 ? "" : "s"} (unique claims) in the run log`,
    ),
    axis(
      "making",
      ["Iterating", "One-shot"],
      ["I", "O"],
      // No prompting recorded is NO evidence, not one-shot evidence.
      iterTracks.length ? iterAvg : 0.5,
      iterTracks.length
        ? `${iterAvg.toFixed(2)} revise/regenerate action${iterAvg === 1 ? "" : "s"} per prompt`
        : "no prompting recorded — axis sits at the midpoint",
    ),
  ];

  const code = axes.map((a) => a.letter).join("");
  return {
    code,
    archetype: ARCHETYPES[code] ?? "The Player",
    blurb: blurbFor(axes),
    axes,
  };
}
