/** Typed model of a validated instrument package (spec §14 "Content as data"). */

export type Locale = "en" | "ja" | "ko";

/**
 * A FROZEN TREND FORM (docs/TREND-FORM.md). The operational form re-versions
 * every year against a moving frontier, so a year-over-year change on it
 * cannot be told apart from a change in the generators. The anchor form is
 * held constant instead, and the headline trend is reported on it.
 *
 * A frozen form is only worth carrying while it is unburned, so the budget
 * that bounds its exposure is declared HERE, next to the form, rather than in
 * a policy note nobody loads.
 */
export interface AnchorForm {
  /**
   * Stable id of the frozen form, e.g. `ltt-2026a`. It outlives the
   * instrument version: the whole point is that 2027.1 carries the same
   * anchor id as 2026.1.
   */
  id: string;
  /**
   * The most administrations of this form allowed in one cycle, counting
   * every sitting that sees any anchor item. Exceeding it is a decision, not
   * an accident, and it ends with a replacement anchor (docs/TREND-FORM.md §3).
   */
  exposure_budget: number;
}

/**
 * A PANEL SHORT FORM (docs/SHORT-FORM.md). A probability panel will not sit
 * the 4h 20m examination, so the population statistic is measured on a
 * 45–60 minute matrix-sampled form: every respondent takes the blocks marked
 * `every_respondent` plus exactly ONE rotated block, and no respondent takes
 * the whole pool.
 *
 * The block structure is declared HERE because the time budget is the design.
 * A form that quietly grows past the minutes a panel will sit does not fail
 * loudly at fielding; it fails as break-off, which biases the mean upward
 * (docs/SAMPLING.md §8.3).
 */
export interface ShortForm {
  /** Stable id of the short form, e.g. `psf-2026a`. */
  id: string;
  /**
   * The minutes one respondent may be asked for, end to end. The longest
   * respondent path — every common block plus the longest rotated block —
   * must fit inside it.
   */
  target_minutes: number;
  blocks: ShortFormBlock[];
}

/** One block of a short form. Either common to every form, or rotated. */
export interface ShortFormBlock {
  /** Block id, unique within the form, e.g. `anchor-core`. */
  id: string;
  /** Testing minutes this block asks of one respondent. */
  minutes: number;
  /**
   * This block is in EVERY respondent's form. At least one such block is
   * required: it is the common set that links the rotated forms to each
   * other, and a matrix design without one cannot be scaled at all
   * (docs/SHORT-FORM.md §5).
   */
  every_respondent?: boolean;
}

export interface InstrumentManifest {
  id: string;
  version: string;
  /**
   * This package is a REDACTED public view of an instrument: it carries the
   * published points allocation and no marking material at all. The loader
   * REFUSES a redacted package that carries a criterion `description`, a
   * `band_anchors` block or a `prompts/` directory, so the released tier
   * cannot quietly re-acquire a mark scheme (`instruments/demo-2026.1`).
   */
  redacted?: boolean;
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
  /**
   * This package carries a frozen trend form. Absent on an ordinary
   * operational package. NEVER present with `redacted: true`: a redacted
   * package publishes its keys, and a published anchor is a burned anchor
   * that still looks comparable (docs/TREND-FORM.md §2).
   */
  anchor?: AnchorForm;
  /**
   * This package carries a panel short form. Absent on a package that is only
   * ever sat in full (docs/SHORT-FORM.md).
   */
  short_form?: ShortForm;
}

export interface RubricCriterion {
  id: string;
  name: string;
  points: number;
  scored_by: string;
  judged: boolean;
  /**
   * How a judge is told to mark this criterion. Required on disk; ABSENT from
   * a `public: true` snapshot — the POINTS allocation is published, the
   * marking scheme is not.
   */
  description?: string;
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
  /** Band prose. Required on disk; ABSENT from a `public: true` snapshot. */
  band_anchors?: BandAnchor[];
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
  /**
   * Judge prompts. EMPTY in a `public: true` snapshot: a judge prompt is the
   * marking scheme of a judged track. `rubricVersion` still hashes them,
   * because it is computed on load, before the strip — the content address
   * survives, the text does not.
   */
  prompts: JudgePrompt[];
  /** hash(rubric.yaml + prompts) — spec: prompts are content. */
  rubricVersion: string;
  bank?: ItemBank;
}

export interface InstrumentPackage {
  manifest: InstrumentManifest;
  tracks: InstrumentTrack[];
}
