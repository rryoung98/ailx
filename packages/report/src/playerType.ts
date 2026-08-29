/**
 * Player type — an MBTI-style lens on a finished run. PLAYFUL, not
 * psychometric: four axes, one per track, split at this demo cohort's
 * per-track median. The scored composite never reads this.
 */
import { demoCohort, TRACK_IDS, type TrackRawScores } from "@ailx/session";
import { DEMO_COHORT_SEED, DEMO_COHORT_SIZE } from "./demo.js";

export interface Pole {
  track: (typeof TRACK_IDS)[number];
  letter: string;
  label: string;
  high: boolean;
}

export interface PlayerType {
  code: string;
  name: string;
  tagline: string;
  poles: Pole[];
  strengths: string[];
  watchouts: string[];
}

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

/** Per-track cohort medians (demo cohort, deterministic). */
export function cohortMedians(): TrackRawScores {
  const cohort = demoCohort(DEMO_COHORT_SEED, DEMO_COHORT_SIZE);
  const med = {} as TrackRawScores;
  for (const t of TRACK_IDS) {
    const v = cohort.map((r) => r[t]).sort((a, b) => a - b);
    med[t] = (v[Math.floor((v.length - 1) / 2)] + v[Math.ceil((v.length - 1) / 2)]) / 2;
  }
  return med;
}

export function playerType(trackRaw: TrackRawScores): PlayerType {
  const med = cohortMedians();
  const poles: Pole[] = AXES.map((a) => {
    const high = trackRaw[a.track] >= med[a.track];
    const side = high ? a.hi : a.lo;
    return { track: a.track, letter: side.letter, label: side.label, high };
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
