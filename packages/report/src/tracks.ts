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
  components: TrackComponentMeta[];
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
    id: "t3", code: "T3", pluginId: "instrumented-assistant@2", name: "AI-Assisted Reasoning",
    packageName: "@ailx/track-t3", points: trackPoints("t3"), scored: SCORE_ALLOCATION.t3.scored,
    // Three, not two: the shipped config plants three errors and the reveal
    // lists all three (apps/web/test/wiring.test.ts pins the count).
    hype: "T3 — the assistant plants three errors. Catch them.",
    specBudgetSeconds: SPEC_BUDGETS_SECONDS.t3, demoBudgetSeconds: 10 * 60,
    brief:
      "Solve a hard problem with an instrumented AI assistant that has been seeded with known-wrong outputs. Produce an original written analysis. Thirty-five of the hundred points are model-free measurement of behaviour.",
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
