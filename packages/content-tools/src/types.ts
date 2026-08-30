/** Typed model of a validated instrument package (spec §14 "Content as data"). */

export type Locale = "en" | "ja" | "ko";

export interface InstrumentManifest {
  id: string;
  version: string;
  /**
   * Optional one-paragraph statement of what this package IS, carried into
   * the snapshot so a tier cannot be mistaken for another once it is JSON.
   * The released-practice tier uses it to say its keys are public on purpose
   * and that it issues no score of record.
   */
  notice?: string;
  effective_from: string;
  locales: Locale[];
  tracks: string[];
}

export interface RubricCriterion {
  id: string;
  name: string;
  points: number;
  scored_by: string;
  judged: boolean;
  description: string;
}

export interface BandAnchor {
  band: "distinction" | "merit" | "pass" | "participation";
  min_scaled: number;
  anchor: string;
}

export interface Rubric {
  track: string;
  total_points: number;
  criteria: RubricCriterion[];
  band_anchors: BandAnchor[];
}

export interface TrackConfigFile {
  plugin: string; // e.g. "item-bank@2"
  config: Record<string, unknown>;
}

export interface JudgePrompt {
  locale: Locale;
  filename: string;
  /** Raw markdown including front matter — hashed into rubric_version. */
  content: string;
  translationProvenance: string;
}

export interface BankItem {
  id: string;
  type: string;
  locale: Locale;
  stem: string;
  material: Record<string, unknown>;
  options: Array<{ id: string; label: string }>;
  key: string;
  difficulty: "easy" | "medium" | "hard";
  /**
   * How the item was made. Required on disk; ABSENT from a `public: true`
   * snapshot, because it names generation prompts, models and — via
   * `source_item` — the operational items a translated item derives from.
   */
  provenance?: Record<string, unknown>;
  rationale: string;
}

export interface ItemBank {
  items: BankItem[];
  /** sha256 hex digest of the bank.jsonl bytes. */
  sha256: string;
}

export interface InstrumentTrack {
  trackId: string;
  plugin: string;
  config: Record<string, unknown>;
  rubric: Rubric;
  prompts: JudgePrompt[];
  /** hash(rubric.yaml + prompts) — spec: prompts are content. */
  rubricVersion: string;
  bank?: ItemBank;
}

export interface InstrumentPackage {
  manifest: InstrumentManifest;
  tracks: InstrumentTrack[];
}
