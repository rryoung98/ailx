/**
 * Practice — the repeatable, UNSCORED training drill (spec §13 "Mastery").
 *
 * The spec's T2 training round drills the DURABLE ARTEFACT FAMILIES with
 * immediate right/wrong feedback on every card. What that is and is not
 * evidenced to do is stated ONCE, below, in PRACTICE_EFFICACY_NOTE and its
 * comment; spec §13 is that note's source. Do not restate the evidence here
 * or on a page — import the constant. This module is that drill's SELECTION
 * RULE and its grading. The content itself is data, not code: it is built by
 * `instruments/practice/2026.1/tools/build-practice-corpus.py` into
 * `corpus.json`, and emitted from there into `./practiceCorpus.ts`.
 *
 * THE HARD SEPARATION — read this before adding content.
 *
 * Practice must never draw from, reveal, or teach the answers to the scored
 * item bank (`instruments/2026.1/tracks/t2-discrimination/items/bank.jsonl`).
 * The bank IS the instrument: an item whose answer has been practised is a
 * dead item, and there is no way to un-leak one. So:
 *
 *  1. Neither this module nor the generated corpus imports instrument
 *     content, takes a bank argument, or reads a file at run time. The only
 *     material practice can ever show is `PRACTICE_BANK`.
 *     `packages/report/test/practice.test.ts` asserts the separation at this
 *     selection layer against the real scored bank on disk — by id, by text
 *     fingerprint, AND by the sha256 of the image bytes, because two media
 *     corpora can collide on a picture without sharing a single word.
 *  2. Every practice id is prefixed `practice:`, so a practice id can never
 *     collide with, or be mistaken for, a scored item id.
 *  3. Practice is UNSCORED. Its answers reach no `score()`, no composite and
 *     no report figure — spec §13's governing rule ("every game mechanic
 *     lives in onboarding, pacing, reveal, or social layers; none of them
 *     enters score()").
 *
 * WHAT THIS CONTENT HONESTLY IS. Real, licensed MEDIA: freely-licensed
 * photographs and freely-licensed model-generated images, both from Wikimedia
 * Commons, asking T2's own question — "is this a photograph or an AI-generated
 * image?". Every item carries its licence and attribution as data, and every
 * item carries a one-line TELL naming the artefact actually visible in that
 * picture, because the tell is the intervention: being shown the thing you
 * looked straight past is what moves detection.
 *
 * The corpus is real but SMALL, and its families are not equally deep — see
 * `docs/PROGRESSION.md` §2.2 for exactly which side is thin and why. The page
 * says so rather than implying a fuller bank than exists.
 */
import { seededUniform } from "@ailx/session";
import { PRACTICE_BANK, PRACTICE_BANK_VERSION } from "./practiceCorpus.js";

export { PRACTICE_BANK, PRACTICE_BANK_VERSION };

/**
 * The durable artefact families (spec §13): the tells that survive model
 * generations, because they come from not having a world model rather than
 * from a particular decoder.
 */
export const ARTEFACT_FAMILIES = ["physics", "function", "social"] as const;
export type ArtefactFamily = (typeof ARTEFACT_FAMILIES)[number];

/** How hard the tell is to SEE, not how rare the artefact is. */
export const PRACTICE_DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type PracticeDifficulty = (typeof PRACTICE_DIFFICULTIES)[number];

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
    blurb: "Light, shadow, reflection, scale or gravity doing something the world does not do.",
  },
  function: {
    family: "function",
    name: "Functional implausibility",
    blurb: "A thing assembled, joined or shaped in a way that could not actually work.",
  },
  social: {
    family: "social",
    name: "Sociocultural error",
    blurb: "A detail wrong for the place, period, role or institution being shown.",
  },
};

/**
 * The two calls. Index 0 is the SIGNAL call — the thing being detected.
 *
 * For media that is "this was generated". Signal-detection terms (hit, false
 * alarm) are defined against this index, so the ORDER is load-bearing and the
 * test asserts it.
 */
export const PRACTICE_OPTIONS = ["AI-generated", "Real photograph"] as const;
export const SIGNAL_CHOICE = 0;
export const CLEAN_CHOICE = 1;

/**
 * Licence and attribution, carried as data on every item.
 *
 * This is not decoration. CC-BY and CC-BY-SA REQUIRE attribution wherever the
 * work is shown, so the drill renders it under the image; an item that lost
 * its credit would be a licence breach, and the corpus test refuses one.
 */
export interface PracticeCredit {
  /**
   * Where the pixels came from. `commons` is somebody else's freely-licensed
   * file; `generated` is ours, made by
   * `instruments/practice/2026.1/tools/generate-practice-images.py`.
   *
   * The corpus needs both. Found generations are scarce and rarely culturally
   * specific enough to be culturally WRONG, so the sociocultural family can
   * only be filled by generating; and a corpus generated by ONE model would
   * teach that model's fingerprint instead of the artefact, so the model is
   * recorded per item and the corpus test refuses a dominant one.
   */
  origin: "commons" | "generated";
  author: string;
  license: string;
  /** Commons retrieval date, or the date the image was generated. */
  retrieved: string;
  /** What was changed from the original (re-encode, crop). */
  derivative: string;
  /** Evidence of model generation: a Commons page phrase, or our own ledger. */
  generator_evidence?: string;

  /** `commons` only. */
  commons_title?: string;
  /** `commons` only. */
  source_url?: string;

  /** `generated` only — the exact model, e.g. `openai/gpt-5-image`. */
  model?: string;
  /** `generated` only — the provider family the model belongs to. */
  provider?: string;
  /** `generated` only — the FULL prompt, so the item is reproducible. */
  prompt?: string;
  /**
   * `generated` only — why we may republish this image, quoted from the
   * provider's own terms. We redistribute the corpus publicly, so "the model
   * returned it" is not a licence; an image whose rights are unclear does not
   * ship at all.
   */
  rights_basis?: string;
}

/**
 * The picture under inspection.
 *
 * `src` is a path relative to `apps/web/public/`, resolved by the web adapter
 * — the same convention the scored image deck uses. `alt` is a NEUTRAL
 * description: it must describe the scene for a screen-reader user without
 * naming the artefact, because an alt text that gave the tell away would
 * hand the answer to exactly the participants the drill is meant to serve.
 */
export interface PracticeImage {
  kind: "image";
  src: string;
  alt: string;
  /**
   * Set only when the picture is NOT photorealistic. A painterly or rendered
   * image can be called from its style in a second, so the candidate never
   * reaches the artefact and learns "painterly = generated" — which fails on
   * genuine paintings and on photorealistic generations alike. Carrying the
   * caveat as data lets the page say so (docs/PROGRESSION.md §2.2) instead of
   * letting the shortcut work silently.
   */
  style?: PracticeStyle;
}

/** Non-photorealistic renditions the corpus admits, and declares. */
export const PRACTICE_STYLES = ["painterly", "render"] as const;
export type PracticeStyle = (typeof PRACTICE_STYLES)[number];

export type PracticeMaterial = PracticeImage;

export interface PracticeItem {
  /** `practice:<family>:<slug>` — never a scored bank id (see module note). */
  id: string;
  family: ArtefactFamily;
  /** Index into PRACTICE_OPTIONS of the correct call. */
  key: number;
  difficulty: PracticeDifficulty;
  /** Shown immediately after the call — this is the teaching. */
  tell: string;
  material: PracticeMaterial;
  credit: PracticeCredit;
}

/** Cards dealt per drill. Six is ~2-3 minutes, which is a session people repeat. */
export const PRACTICE_DECK_SIZE = 6;

/**
 * THE EFFICACY DISCLAIMER, written once and rendered wherever practice is
 * offered or its numbers are drawn. It is a CONSTANT, not page copy, because
 * two surfaces (the drill's own page and /progress) both make a reader
 * wonder whether the drill works, and a claim that drifts between them is
 * how an unevidenced one gets back in.
 *
 * Why it says what it says — the evidence, not our preference:
 *
 *  - Gray, Davis, Bunce, Noyes & Ritchie, R. Soc. Open Sci. 12(11):250921
 *    (2025). The 31%->51% figure this product used to quote is a BETWEEN-
 *    GROUPS contrast across two different samples, not the same people
 *    getting better. In that study trained typical-ability adults sat at
 *    d' = -0.066, not distinguishable from chance (t69 = 1.092, p = 0.279).
 *    Training removed a below-chance bias; it did not build discrimination.
 *  - Geissler, Robertson & Feuerriegel, arXiv 2507.23492 (N = 1,200, five
 *    arms, two-week follow-up). The GAMIFIED arm did not beat control
 *    (p_adj = 0.310) and the FEEDBACK arm did not either (p_adj = 1.000) —
 *    and at two weeks NO arm beat control. This drill is gamified practice
 *    with immediate feedback: it is built out of the two arms that failed.
 *  - Diel et al. (2024) meta-analysis, k = 137, N = 86,155: pooled d' is not
 *    different from chance and raw accuracy in this literature is dominated
 *    by CRITERION, not sensitivity. So "more right answers" is not "better
 *    eyes" until the two are reported apart — docs/TRANSFER-STUDY.md.
 *
 * The engagement claims are untouched by all of this and stay: a streak is a
 * true statement about days you practised.
 */
export const PRACTICE_EFFICACY_NOTE_SHORT =
  "We do not claim it makes you better at spotting AI images.";

/** The long form. Built from the short one so the two can never drift apart. */
export const PRACTICE_EFFICACY_NOTE =
  `${PRACTICE_EFFICACY_NOTE_SHORT} The best-powered trial of practice like this one — gamified `
  + "drilling, immediate feedback, 1,200 people — found no advantage over doing nothing, "
  + "immediately or two weeks later, and the study behind our own artefact families never "
  + "measured the same person improving. Play it because the tells are interesting. We are "
  + "running the test that would settle it, and we will publish the answer whichever way it goes.";

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
