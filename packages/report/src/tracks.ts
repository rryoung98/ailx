import { SCORE_ALLOCATION, trackPoints, type ComponentAllocation } from "@ailx/core";
import { SPEC_BUDGETS_SECONDS, type TrackId } from "@ailx/session";

/**
 * The component list a report renders IS the allocation table — points,
 * labels and all. It used to be a hand-kept copy, which is how the report
 * came to print a component breakdown the scorer had stopped using.
 */
export type TrackComponentMeta = ComponentAllocation;

export interface TrackMeta {
  id: TrackId;
  code: "T1" | "T2" | "T3" | "T4";
  pluginId: string;
  name: string;
  packageName: string;   // '@ailx/track-t1' — built by parallel workers
  /** Derived from the allocation table. 0 for an unscored showcase track. */
  points: number;
  /** False for a SHOWCASE track: run and recorded, but issuing no points. */
  scored: boolean;
  specBudgetSeconds: number;
  /** Compressed budget for the static demo sitting. */
  demoBudgetSeconds: number;
  brief: string;
  /** One-line intro hype shown before the track starts. */
  hype: string;
  components: ReadonlyArray<TrackComponentMeta>;
}

export const TRACK_META: Record<TrackId, TrackMeta> = {
  t1: {
    id: "t1", code: "T1", pluginId: "artifact-hosting@2", name: "Creative Build",
    packageName: "@ailx/track-t1", points: trackPoints("t1"), scored: SCORE_ALLOCATION.t1.scored,
    hype: "T1 — you direct, it renders. Ship a site you'd put your name on.",
    specBudgetSeconds: SPEC_BUDGETS_SECONDS.t1, demoBudgetSeconds: 10 * 60,
    brief:
      "Build a personal site that communicates who you are and what you work on, to a stated audience. AI assistance is unrestricted and expected — the prompt log is a required submission artifact, not a confession.",
    components: SCORE_ALLOCATION.t1.components,
  },
  t2: {
    id: "t2", code: "T2", pluginId: "swipe-deck@2", name: "Synthetic-Media Discrimination",
    packageName: "@ailx/track-t2", points: trackPoints("t2"), scored: SCORE_ALLOCATION.t2.scored,
    hype: "T2 — can you spot the fakes?",
    // 5 min for the 6-item demo deck: the forced-exposure floor is ~62 s, so
    // a diligent full-exposure run stays well clear of the fast-submission
    // insight threshold (< 25% of budget).
    specBudgetSeconds: SPEC_BUDGETS_SECONDS.t2, demoBudgetSeconds: 5 * 60,
    brief:
      "120 rapid binary judgements on synthetic media and hostile messages, at fixed exposure, with confidence capture. The construct is synthetic-media discrimination — sensitivity (d′) AND criterion (c) together — not AI literacy: the evidence says training moves where a person puts their threshold, not how well they can tell the two apart.",
    components: SCORE_ALLOCATION.t2.components,
  },
  t3: {
    id: "t3", code: "T3", pluginId: "instrumented-assistant@2", name: "Calibrated Reliance",
    packageName: "@ailx/track-t3", points: trackPoints("t3"), scored: SCORE_ALLOCATION.t3.scored,
    // Four, and the count is pinned by apps/web/test/wiring.test.ts and tied
    // to the instrument's declaration by apps/web/test/t3Declaration.test.ts.
    // Four is what the forms deal (TEN-91), not what the evidence supports:
    // the planted-error component carries 50 of T3's 160 points, so one event
    // moves it by 12.5, and the rate is reported as provisional for that
    // reason. See `brief` and the report's precision note.
    hype: "T3 — the assistant plants four errors. Catch them.",
    specBudgetSeconds: SPEC_BUDGETS_SECONDS.t3, demoBudgetSeconds: 10 * 60,
    brief:
      "Solve a hard problem with an instrumented AI assistant that has been seeded with known-wrong outputs. The construct is calibrated reliance — knowing when to use the model and when not to — reported two-tailed, because refusing correct help is as much a failure as swallowing a planted error. 115 of the 160 points are model-free measurement of behaviour. The form plants four errors, below the eight the evidence supports, so every catch rate it produces is reported as provisional with its interval.",
    components: SCORE_ALLOCATION.t3.components,
  },
  t4: {
    id: "t4", code: "T4", pluginId: "generative-studio@2", name: "Generative Direction",
    packageName: "@ailx/track-t4", points: trackPoints("t4"), scored: SCORE_ALLOCATION.t4.scored,
    // The hard quota is the DELIVERABLE quota — 3 finished images and 1
    // video (t4 `finalImageQuota` / `finalVideoQuota`). Drafts are unlimited,
    // so "six generations" both named the wrong number and described the
    // wrong thing to budget against.
    hype: "T4 — three images and one video. Make them count.",
    specBudgetSeconds: SPEC_BUDGETS_SECONDS.t4, demoBudgetSeconds: 8 * 60,
    brief:
      "Take a communicative brief to a finished image and video set under a hard generation quota. Published to a public gallery with prompts. Blind viewers are asked what the work communicates; the score is agreement with the brief's stated intent.",
    components: SCORE_ALLOCATION.t4.components,
  },
};

export const TRACK_LIST = [TRACK_META.t1, TRACK_META.t2, TRACK_META.t3, TRACK_META.t4];

/**
 * Older spellings of a component key, newest first.
 *
 * A `raw` record is a STORED wire surface. A key renamed in the scorer does
 * not rename itself in an attempt scored last month, so the report reads
 * every spelling a component has ever had and takes the first one present.
 *
 * T3's two reliance components are NOT listed here, and that is deliberate.
 * They have been renamed twice in three days (TEN-38, TEN-72) and no sitting
 * has ever been scored in production, so there is no stored record to read.
 * An alias for them would only keep a name alive that the report must never
 * print again.
 */
const COMPONENT_KEY_ALIASES: Readonly<Record<string, ReadonlyArray<string>>> = {
  // Inherited unchanged from the inline table this replaced. These four are
  // keyed by allocation keys that no longer exist (the current keys are
  // `functional`, `sensitivity`, `brief-fit`, `craft`), so they never fire.
  // Flagged here, not deleted: a rename commit is the wrong place to decide
  // whether a stored record still needs them.
  gates: ["functional"],
  dprime: ["sensitivity"],
  brief: ["brief-fit"],
  direction: ["craft"],
};

/** Every spelling of a component key, current first. */
export function componentKeys(key: string): ReadonlyArray<string> {
  return [key, ...(COMPONENT_KEY_ALIASES[key] ?? [])];
}

/**
 * One component's points out of a stored `raw` record, 0 when absent.
 *
 * "Absent" means no number under any spelling of the key. A stored `NaN` is
 * a number and is returned as one, which is what the inline lookup this
 * replaced did. Rejecting it would be a presentation fix, not a rename.
 */
export function componentValue(
  raw: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number {
  if (!raw) return 0;
  for (const k of componentKeys(key)) {
    const v = raw[k];
    if (typeof v === "number") return v;
  }
  return 0;
}
