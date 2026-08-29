/**
 * Practice — the repeatable, UNSCORED training drill (spec §13 "Mastery").
 *
 * The spec's T2 training round moves typical participants from 31% to 51%
 * detection in about five minutes by drilling the DURABLE ARTEFACT FAMILIES
 * with immediate right/wrong feedback. This module is that drill's content
 * and its selection rule, and nothing else.
 *
 * THE HARD SEPARATION — read this before adding content.
 *
 * Practice must never draw from, reveal, or teach the answers to the scored
 * item bank (`instruments/2026.1/tracks/t2-discrimination/items/bank.jsonl`).
 * The bank IS the instrument: an item whose answer has been practised is a
 * dead item, and there is no way to un-leak one. So:
 *
 *  1. This module imports NO instrument content and takes NO bank argument.
 *     The only material practice can ever show is `PRACTICE_BANK` below.
 *     `packages/report/test/practice.test.ts` asserts the separation at this
 *     selection layer, against the real scored bank on disk.
 *  2. Every practice id is prefixed `practice:` and is content-addressed over
 *     practice material only, so a practice id can never collide with, or be
 *     mistaken for, a scored item id.
 *  3. Practice is UNSCORED. Its answers reach no `score()`, no composite and
 *     no report figure — spec §13's governing rule ("every game mechanic
 *     lives in onboarding, pacing, reveal, or social layers; none of them
 *     enters score()").
 *
 * WHAT THIS CONTENT HONESTLY IS. A placeholder set: 18 hand-authored TEXT
 * passages, six per artefact family, half carrying a planted artefact and
 * half clean. The task is "does this passage carry a <family> artefact?",
 * NOT T2's authentic-vs-synthetic call — a synthetic-vs-human drill needs a
 * human-written corpus we do not have practice rights to, and faking one
 * would teach the wrong tell. The families, the immediate feedback and the
 * five-minute shape are the spec's; the corpus is a stand-in and is labelled
 * as such everywhere it is shown.
 */
import { seededUniform } from "@ailx/session";

/**
 * The durable artefact families (spec §13): the tells that survive model
 * generations, because they come from not having a world model rather than
 * from a particular decoder.
 */
export const ARTEFACT_FAMILIES = ["physics", "function", "social"] as const;
export type ArtefactFamily = (typeof ARTEFACT_FAMILIES)[number];

export interface FamilyMeta {
  family: ArtefactFamily;
  name: string;
  /** One line, shown on the card and in the feedback. */
  blurb: string;
}

export const FAMILY_META: Readonly<Record<ArtefactFamily, FamilyMeta>> = {
  physics: {
    family: "physics",
    name: "Physics violation",
    blurb: "Light, shadow, scale, gravity or time doing something the world does not do.",
  },
  function: {
    family: "function",
    name: "Functional implausibility",
    blurb: "An object or process described in a way that could not actually work.",
  },
  social: {
    family: "social",
    name: "Sociocultural error",
    blurb: "A detail wrong for the place, period, role or institution being claimed.",
  },
};

/** The two calls. Index 0 is the SIGNAL call: "this carries an artefact". */
export const PRACTICE_OPTIONS = ["Artefact", "Clean"] as const;
export const SIGNAL_CHOICE = 0;
export const CLEAN_CHOICE = 1;

export interface PracticeItem {
  /** `practice:<family>:<slug>` — never a scored bank id (see module note). */
  id: string;
  family: ArtefactFamily;
  /** The passage under inspection. Plain text; never rendered as HTML. */
  passage: string;
  /** Index into PRACTICE_OPTIONS of the correct call. */
  key: number;
  /** Shown immediately after the call — this is the teaching. */
  tell: string;
}

/**
 * The practice corpus. Six per family, three carrying a planted artefact and
 * three clean, so any family-balanced deck is also class-balanced.
 */
export const PRACTICE_BANK: readonly PracticeItem[] = [
  // ---- physics ------------------------------------------------------------
  {
    id: "practice:physics:harbour-shadows",
    family: "physics",
    passage:
      "Morning shot of the harbour: the mast shadows run away from the camera towards the "
      + "breakwater, while the crane on the same quay throws its shadow back towards the town.",
    key: SIGNAL_CHOICE,
    tell: "Two shadows in one scene point in opposite directions. One sun, one direction — "
      + "conflicting shadow azimuths in a single outdoor frame are the oldest tell there is.",
  },
  {
    id: "practice:physics:kettle-steam",
    family: "physics",
    passage:
      "The kettle had just boiled. The steam was invisible for the first inch above the spout, "
      + "then went white where it cooled, and the window above the sink fogged from the bottom up.",
    key: CLEAN_CHOICE,
    tell: "Correct: steam is clear until it condenses, and a cold pane fogs where the warm air "
      + "reaches it. Nothing here disagrees with the physics.",
  },
  {
    id: "practice:physics:mirror-crowd",
    family: "physics",
    passage:
      "She is photographed from behind at the dressing mirror. Her reflection looks straight out "
      + "at the camera, and the room behind her is empty in the glass but crowded in the frame.",
    key: SIGNAL_CHOICE,
    tell: "A reflection that changes gaze or drops the room's contents is a world-model failure: "
      + "a mirror is a projection of the scene, not a second scene.",
  },
  {
    id: "practice:physics:puddle-rain",
    family: "physics",
    passage:
      "It had rained for an hour. The puddles carried rings where new drops landed, the pavement "
      + "was dark except under the parked van, and the gutter ran towards the drain at the corner.",
    key: CLEAN_CHOICE,
    tell: "Dry patch under the van, rings on standing water, water flowing downhill to the drain. "
      + "Consistent — resist calling artefact on a merely ordinary description.",
  },
  {
    id: "practice:physics:candle-scale",
    family: "physics",
    passage:
      "A single tea light on the far side of the hall lit every face in the room evenly, and cast "
      + "no shadow behind any of the forty people standing there.",
    key: SIGNAL_CHOICE,
    tell: "Light falls off with distance and a point source casts shadows. Even illumination with "
      + "no shadows from one small source is lighting that no physical lamp produces.",
  },
  {
    id: "practice:physics:ice-glass",
    family: "physics",
    passage:
      "The ice had shrunk to a flat disc and the outside of the glass was beaded with water, with "
      + "a wet ring already spreading on the paper coaster underneath.",
    key: CLEAN_CHOICE,
    tell: "Melting, condensation on the cold exterior, and a wet ring below. The whole chain is "
      + "consistent with a cold drink in a warm room.",
  },
  // ---- function -----------------------------------------------------------
  {
    id: "practice:function:bicycle-chain",
    family: "function",
    passage:
      "The chain leaves the front chainring, loops over the top of the rear sprocket, and returns "
      + "along the same upper run to the pedals, so both runs of chain sit above the axle.",
    key: SIGNAL_CHOICE,
    tell: "A chain is a closed loop with an upper and a lower run. Both runs above the axle "
      + "cannot close the loop — the drivetrain described could not turn.",
  },
  {
    id: "practice:function:door-hinge",
    family: "function",
    passage:
      "The hinges are on the corridor side, so the door swings out into the hallway, and there is "
      + "a rubber stop screwed to the skirting board where the handle would otherwise hit the wall.",
    key: CLEAN_CHOICE,
    tell: "Hinges on the side the door opens towards, and a stop where the swing ends. Ordinary "
      + "and correct joinery.",
  },
  {
    id: "practice:function:staircase-landing",
    family: "function",
    passage:
      "The staircase climbs eleven steps to a landing, turns, climbs nine more, and arrives back "
      + "at the same landing it left, one floor higher.",
    key: SIGNAL_CHOICE,
    tell: "Twenty steps up cannot terminate at their own starting landing. Impossible-circuit "
      + "geometry is the classic architectural artefact.",
  },
  {
    id: "practice:function:scissors-grip",
    family: "function",
    passage:
      "The blades cross at a single rivet, the smaller loop takes the thumb and the longer one "
      + "takes two fingers, and the cutting edges face each other along the inside of the blades.",
    key: CLEAN_CHOICE,
    tell: "One pivot, asymmetric loops, edges facing inwards. That is how scissors work.",
  },
  {
    id: "practice:function:cable-power",
    family: "function",
    passage:
      "The desk lamp is plugged into the extension lead, and the extension lead is plugged into "
      + "the socket on the side of the desk lamp, which is how the lamp powers the whole desk.",
    key: SIGNAL_CHOICE,
    tell: "A closed power loop with no source. Circular supply is a functional impossibility even "
      + "though every individual sentence sounds like normal office description.",
  },
  {
    id: "practice:function:umbrella-wind",
    family: "function",
    passage:
      "The gust caught it from underneath and two of the ribs inverted, so the canopy stood up in "
      + "a bowl until she turned to face the wind and it snapped back the right way.",
    key: CLEAN_CHOICE,
    tell: "Inversion under an updraught and recovery by turning into the wind is exactly how an "
      + "umbrella fails and unfails.",
  },
  // ---- social -------------------------------------------------------------
  {
    id: "practice:social:tokyo-train",
    family: "social",
    passage:
      "Rush hour at Shinjuku, 1974. Commuters tap their phones against the gate readers and the "
      + "platform staff wave the last passengers through before the doors close.",
    key: SIGNAL_CHOICE,
    tell: "Contactless gate readers are decades later than the claimed date. Anachronistic "
      + "technology in a dated scene is the commonest sociocultural artefact.",
  },
  {
    id: "practice:social:korean-address",
    family: "social",
    passage:
      "She used his job title rather than his given name throughout the meeting, and switched to "
      + "plain speech only afterwards, once the two of them were alone in the corridor.",
    key: CLEAN_CHOICE,
    tell: "Title-plus-honorific in front of colleagues and a register change in private is "
      + "ordinary Korean workplace practice. Unfamiliar is not the same as wrong.",
  },
  {
    id: "practice:social:hospital-badge",
    family: "social",
    passage:
      "The ward round is led by a consultant whose badge reads 'Level 4 Certified Doctor, Grade "
      + "AAA', below the hospital's motto in Latin and a QR code for tips.",
    key: SIGNAL_CHOICE,
    tell: "No medical system grades clinicians like that, and hospitals do not solicit tips on a "
      + "staff badge. Invented institutional vocabulary is a durable tell.",
  },
  {
    id: "practice:social:market-prices",
    family: "social",
    passage:
      "The stall chalks prices by the kilo, rounds to the nearest ten cents, and drops the price "
      + "on the soft fruit in the last hour before closing.",
    key: CLEAN_CHOICE,
    tell: "Per-kilo pricing, coin-friendly rounding, end-of-day markdown on perishables. All "
      + "consistent with an actual market.",
  },
  {
    id: "practice:social:wedding-order",
    family: "social",
    passage:
      "At the reception the best man gave his speech, then the couple signed the register in front "
      + "of the guests, then the officiant asked whether anyone objected to the marriage.",
    key: SIGNAL_CHOICE,
    tell: "The ceremony's steps are in an order no ceremony uses — objection and register belong "
      + "to the service, not after the reception speeches. Ritual sequence is a strong prior.",
  },
  {
    id: "practice:social:school-run",
    family: "social",
    passage:
      "The crossing patrol stops traffic at ten to nine, the same three parents stand at the same "
      + "corner, and the bell goes before the last of them has reached the gate.",
    key: CLEAN_CHOICE,
    tell: "Routine, repetition and slight lateness. Mundane social detail with nothing out of "
      + "period, place or role.",
  },
];

/** Cards dealt per drill. Six is ~2-3 minutes, which is a session people repeat. */
export const PRACTICE_DECK_SIZE = 6;

/**
 * Version of the corpus, recorded on every practice session so a later
 * content change can never be mistaken for a change in a person's accuracy.
 * Bump on ANY edit to PRACTICE_BANK.
 */
export const PRACTICE_BANK_VERSION = "practice-2026.1-placeholder-1";

const BY_ID: ReadonlyMap<string, PracticeItem> = new Map(PRACTICE_BANK.map((i) => [i.id, i]));

/** The item, or null. The only lookup — nothing else indexes the bank. */
export function practiceItem(id: string): PracticeItem | null {
  return BY_ID.get(id) ?? null;
}

/** Every practice id carries this prefix; nothing else in the repo may. */
export const PRACTICE_ID_PREFIX = "practice:";

export function isPracticeItemId(id: string): boolean {
  return id.startsWith(PRACTICE_ID_PREFIX) && BY_ID.has(id);
}

/**
 * Server-side truth for one answer. The client knows the key (practice is
 * unscored teaching material, so hiding it would buy nothing), but the
 * client's OWN verdict is never stored: `correct` is always recomputed here
 * from the item id and the choice — FRONTEND.md §4.7.
 *
 * An unknown id or an out-of-range choice is not correct, and never throws:
 * a hostile client should get a wrong answer, not a 500.
 */
export function gradePractice(itemId: string, choice: number): boolean {
  const item = BY_ID.get(itemId);
  return item !== undefined && choice === item.key;
}

/** Deterministic Fisher-Yates over the @ailx/session seeded PRNG. */
function seededShuffle<T>(arr: readonly T[], seed: string): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(seededUniform(`${seed}:${i}`, i) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Deal one drill: PRACTICE_DECK_SIZE ids, pure and deterministic in `seed`,
 * balanced two ways so the feedback teaches rather than rewards a bias —
 * equal cards per family, and equal artefact/clean cards overall.
 *
 * Degrades honestly on a short corpus: a family with nothing left is skipped
 * rather than back-filled with a duplicate, so the deck may be smaller than
 * PRACTICE_DECK_SIZE but is never unbalanced and never repeats an item.
 */
export function samplePracticeDeck(seed: string): string[] {
  const perFamily = Math.floor(PRACTICE_DECK_SIZE / ARTEFACT_FAMILIES.length);
  const signalPerFamily = Math.ceil(perFamily / 2);
  const picked: PracticeItem[] = [];
  for (const family of ARTEFACT_FAMILIES) {
    const pool = PRACTICE_BANK.filter((i) => i.family === family);
    const signal = seededShuffle(pool.filter((i) => i.key === SIGNAL_CHOICE), `${seed}:${family}:s`);
    const clean = seededShuffle(pool.filter((i) => i.key === CLEAN_CHOICE), `${seed}:${family}:c`);
    picked.push(
      ...signal.slice(0, signalPerFamily),
      ...clean.slice(0, perFamily - signalPerFamily),
    );
  }
  return seededShuffle(picked, `${seed}:order`).map((i) => i.id);
}
