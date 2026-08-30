/**
 * The vocabulary of item custody.
 *
 * The one type that matters here is {@link RedactedItem}. It is a
 * DISCRIMINATED UNION, not a `Presented` with optional `key`/`rationale`,
 * because the two shapes must not be interchangeable: reading `item.key` off
 * a value that might be `phase: "sitting"` is a compile error, so forgetting
 * to redact stops being a review miss and becomes a type error. That is the
 * whole reason this file exists (docs/ARCHITECTURE.md §3).
 */
import type { TrackId } from "@ailx/session";

export type Phase = "sitting" | "review";

/** Every locale the operational instrument is published in. */
export type Locale = string;

/**
 * Exactly the fields a candidate may hold DURING a sitting.
 *
 * `signal` is deliberately present: it names which option means "AI /
 * synthetic / hostile", which is a property of the OPTION LIST, not of the
 * answer. Knowing that "AI-generated" is the signal call tells you nothing
 * about whether THIS item is AI-generated.
 */
export interface PresentedItem {
  /** Content address of the item (sha256 of its canonical JSON upstream). */
  id: string;
  /** T2Item type — "media-image" | "message-page" | "provenance" | … */
  type: string;
  stem: string;
  /** Rendered material: text, a data-uri, or a served asset path. */
  material: string;
  /** Option LABELS in presentation order. */
  options: readonly string[];
  /** Index into `options` that counts as the signal call, when binary. */
  signal?: number;
  /** 0 (easy) .. 1 (hard). */
  difficulty: number;
  /** Fixed exposure in seconds; absent means untimed. */
  exposureSeconds?: number;
}

/**
 * What the browser may see, per phase. `key` and `rationale` are ABSENT — not
 * empty, not null — until the server has observed `attempts.finalized_at`.
 */
export type RedactedItem =
  | (PresentedItem & { phase: "sitting" })
  | (PresentedItem & {
      phase: "review";
      /** Index into `options` of the correct answer. */
      key: number;
      rationale: string;
      /** The candidate's own recorded choice, when they answered. */
      yourChoice?: number;
      /**
       * The SERVER's verdict. Present whenever `yourChoice` is: the browser is
       * told whether it was right, it never decides. (FRONTEND.md §4.7.)
       */
      correct?: boolean;
    });

/**
 * A sampled deck, as persisted in `attempt_decks`. Owned here rather than in
 * `@ailx/backend` because the sampler lives here: the store records what this
 * module dealt. `@ailx/backend` re-exports it so callers keep one name.
 */
export interface DeckRecord {
  trackId: TrackId;
  /** Content-addressed sha256 of the bank the ids index into. */
  bankSha256: string;
  /** Presented order; non-empty, no duplicates. */
  itemIds: readonly string[];
}

/**
 * A server-issued score for one track. Deliberately the WHOLE return value of
 * {@link Instrument.scoreTrack}: it carries the audit facts a browser may hold
 * (docs/ARCHITECTURE.md §4) and no item text, key or rationale, so a caller
 * cannot leak key material by forwarding it verbatim.
 */
export interface TrackScoreResult {
  score: { raw: Record<string, number>; scaled: number };
  rubricVersion: string;
  scoringDigest: string;
}

/** Server-computed grade for one response. Keys never leave this package. */
export interface Verdict {
  itemId: string;
  correct: boolean;
  /** Index into the item's options of the correct answer. */
  key: number;
}

/**
 * The deep module. Six methods hide the snapshot load, bank parsing, locale
 * fallback, the material transform, deck sampling, key custody, redaction
 * policy, phase authorisation, exposure seconds and the audit digests.
 */
export interface Instrument {
  readonly instrumentId: string;
  readonly instrumentVer: string;
  /**
   * Content address of the instrument package this was opened from — the
   * value recorded in `instruments.package_digest` (spec §14). For the
   * committed snapshot it is the T2 bank sha256, which is what the deck
   * derivation is already seeded with.
   */
  readonly packageDigest: string;
  /** True for the PUBLIC released-practice tier (keys published on purpose). */
  readonly released: boolean;

  /** The pure sampler decks are already recorded with. */
  sampleDecks(attemptId: string, locale: Locale): readonly DeckRecord[];

  /**
   * What the browser may see for this deck at this phase. `answers` supplies
   * the candidate's own recorded choices; it is only read in "review".
   */
  itemView(
    deck: DeckRecord,
    phase: Phase,
    locale: Locale,
    answers?: ReadonlyMap<string, number>,
  ): readonly RedactedItem[];

  /** Grade one response. The only place an answer key is compared. */
  gradeResponse(itemId: string, payload: unknown, locale?: Locale): Verdict;

  /** The config `score()` consumes — carries keys, so it stays server-side. */
  scoringConfig(trackId: TrackId, deck: DeckRecord | undefined, locale: Locale): unknown;

  /**
   * Issue a score for this track over the attempt's own deck.
   *
   * WHY IT LIVES HERE: `score()` needs the keyed config, and the keyed config
   * must not reach a browser, so the only place that can run the pure plugin
   * over a real deck is the module that holds the keys. The result is the
   * score plus the two audit facts — never the config it was computed from.
   */
  scoreTrack(
    trackId: TrackId,
    deck: DeckRecord | undefined,
    artifact: unknown,
    locale: Locale,
  ): TrackScoreResult;

  rubricVersion(trackId: TrackId): string;
  scoringDigest(trackId: TrackId): string;
}
