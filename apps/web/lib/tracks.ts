import { SPEC_BUDGETS_SECONDS, type TrackId } from "@ailx/session";

export interface TrackComponentMeta {
  key: string;
  label: string;
  points: number;
}

export interface TrackMeta {
  id: TrackId;
  code: "T1" | "T2" | "T3" | "T4";
  pluginId: string;
  name: string;
  packageName: string;   // '@ailx/track-t1' — built by parallel workers
  points: 100;
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
    packageName: "@ailx/track-t1", points: 100,
    hype: "T1 — you direct, it renders. Ship a site you'd put your name on.",
    specBudgetSeconds: SPEC_BUDGETS_SECONDS.t1, demoBudgetSeconds: 10 * 60,
    brief:
      "Build a personal site that communicates who you are and what you work on, to a stated audience. AI assistance is unrestricted and expected — the prompt log is a required submission artefact, not a confession.",
    components: [
      { key: "gates", label: "Functional & accessibility gates", points: 30 },
      { key: "comparative", label: "Comparative visual merit", points: 40 },
      { key: "ambition", label: "Technical ambition", points: 20 },
      { key: "rationale", label: "Design rationale", points: 10 },
    ],
  },
  t2: {
    id: "t2", code: "T2", pluginId: "swipe-deck@2", name: "Authenticity Discrimination",
    packageName: "@ailx/track-t2", points: 100,
    hype: "T2 — can you spot the fakes?",
    specBudgetSeconds: SPEC_BUDGETS_SECONDS.t2, demoBudgetSeconds: 8 * 60,
    brief:
      "120 rapid binary judgements on synthetic media and hostile messages, at fixed exposure, with confidence capture. Sensitivity (d′) is the score, not raw accuracy — percent correct confounds sensitivity with response criterion.",
    components: [
      { key: "dprime", label: "Sensitivity (d′)", points: 60 },
      { key: "calibration", label: "Calibration (Brier)", points: 25 },
      { key: "provenance", label: "Provenance reasoning", points: 15 },
    ],
  },
  t3: {
    id: "t3", code: "T3", pluginId: "instrumented-assistant@2", name: "AI-Assisted Reasoning",
    packageName: "@ailx/track-t3", points: 100,
    hype: "T3 — the assistant lies twice. Catch both.",
    specBudgetSeconds: SPEC_BUDGETS_SECONDS.t3, demoBudgetSeconds: 10 * 60,
    brief:
      "Solve a hard problem with an instrumented AI assistant that has been seeded with known-wrong outputs. Produce an original written analysis. Thirty-five of the hundred points are model-free measurement of behaviour.",
    components: [
      { key: "rsr", label: "Planted-error detection (RSR)", points: 25 },
      { key: "analysis", label: "Analysis quality", points: 45 },
      { key: "process", label: "Process quality", points: 20 },
      { key: "rair", label: "Appropriate reliance (RAIR)", points: 10 },
    ],
  },
  t4: {
    id: "t4", code: "T4", pluginId: "generative-studio@2", name: "Generative Direction",
    packageName: "@ailx/track-t4", points: 100,
    hype: "T4 — six generations, no more. Make them count.",
    specBudgetSeconds: SPEC_BUDGETS_SECONDS.t4, demoBudgetSeconds: 8 * 60,
    brief:
      "Take a communicative brief to a finished image and video set under a hard generation quota. Published to a public gallery with prompts. Blind viewers are asked what the work communicates; the score is agreement with the brief's stated intent.",
    components: [
      { key: "brief", label: "Brief compliance & communicative accuracy", points: 30 },
      { key: "comparative", label: "Comparative merit", points: 40 },
      { key: "direction", label: "Direction & craft evidence", points: 20 },
      { key: "provenance", label: "Provenance & disclosure hygiene", points: 10 },
    ],
  },
};

export const TRACK_LIST = [TRACK_META.t1, TRACK_META.t2, TRACK_META.t3, TRACK_META.t4];
