/**
 * World aggregates — "how is the world doing at keeping up with AI".
 *
 * PURE shaping of already-counted inputs (the SQL that counts them lives in
 * `@ailx/backend`), so every rule below is testable without a database.
 *
 * Three product decisions are encoded here, not in the UI:
 *
 *  1. DISTRIBUTIONS ONLY, AND ONLY WHAT IS TRUE TODAY. Participation counts,
 *     the player-type distribution, per-track shape histograms, item exposure
 *     and trends are computable from stored inputs. The summit judging
 *     pipeline (spec Phase 4) is NOT built and `scores` is empty in practice,
 *     so nothing here emits a percentile, a composite or anything that could
 *     read as an authoritative judged result.
 *  2. RE-IDENTIFICATION GUARD. A breakdown is published only when its cohort
 *     has at least `MIN_COHORT_SIZE` members; below that the breakdown is
 *     `null` and the page says so. Aggregates never carry a row, an id, an
 *     attempt, a participant or an item id — only counts.
 *  3. ITEM IDS ARE NEVER PUBLISHED. Item exposure is summarized (how many
 *     distinct items were shown, how often on average, the busiest count)
 *     because publishing per-item counts would publish the bank's inventory,
 *     which docs/SHARING.md forbids for exactly the same reason item detail
 *     never enters a share payload.
 */
import { TRACK_IDS, type TrackId, type TrackRawScores } from "@ailx/session";
import { playerType } from "./playerType.js";

/**
 * Minimum cohort for ANY breakdown.
 *
 * Ten is the common cell-suppression floor in published education and health
 * statistics (small enough to say something during a pilot, large enough that
 * a count is not a person). It is a floor on the WHOLE cohort of a breakdown,
 * and no cross-tabulation is offered — the only re-identification attack on a
 * one-dimensional count is knowing every other member of the cohort, which a
 * public page cannot help with.
 */
export const MIN_COHORT_SIZE = 10;

/** Number of buckets in a track-shape histogram: deciles of the 0-100 scale. */
export const SHAPE_BUCKETS = 10;

export interface ParticipationCounts {
  participants: number;
  attemptsStarted: number;
  attemptsFinalized: number;
}

export interface ParticipationSummary extends ParticipationCounts {
  /** finalized / started, 0-1, or null when nobody has started. */
  completionRate: number | null;
}

export interface TypeCount {
  code: string;
  name: string;
  count: number;
  /** Share of the cohort, 0-1. */
  share: number;
}

export interface TrackShape {
  track: TrackId;
  /** Ten counts: [0,10), [10,20) ... [90,100]. */
  buckets: number[];
  median: number;
  mean: number;
}

/** Item exposure WITHOUT item ids — see the module note. */
export interface ExposureSummary {
  decksRecorded: number;
  distinctItems: number;
  totalExposures: number;
  meanExposuresPerItem: number;
  maxExposuresPerItem: number;
}

export interface TrendPoint {
  /** ISO date of the period start (the backend buckets by week). */
  period: string;
  started: number;
  finalized: number;
}

export interface WorldAggregateInput {
  counts: ParticipationCounts;
  /** One four-track shape per run that has all four track scores. */
  shapes: readonly TrackRawScores[];
  exposure: ExposureSummary;
  trend: readonly TrendPoint[];
}

export interface WorldAggregates {
  minCohortSize: number;
  /** Runs with a complete four-track shape — the cohort every breakdown uses. */
  cohortSize: number;
  /** True when the cohort is too small to publish any breakdown. */
  suppressed: boolean;
  participation: ParticipationSummary;
  playerTypes: TypeCount[] | null;
  tracks: TrackShape[] | null;
  exposure: ExposureSummary | null;
  trend: TrendPoint[] | null;
}

const round = (n: number, places = 3): number => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

/** Which decile a 0-100 value falls in; 100 lands in the top bucket. */
export function shapeBucket(value: number): number {
  const clamped = Math.max(0, Math.min(100, value));
  return Math.min(SHAPE_BUCKETS - 1, Math.floor((clamped / 100) * SHAPE_BUCKETS));
}

function median(sorted: readonly number[]): number {
  const n = sorted.length;
  return (sorted[Math.floor((n - 1) / 2)]! + sorted[Math.ceil((n - 1) / 2)]!) / 2;
}

function trackShapes(shapes: readonly TrackRawScores[]): TrackShape[] {
  return TRACK_IDS.map((track) => {
    const buckets = new Array<number>(SHAPE_BUCKETS).fill(0);
    const values: number[] = [];
    for (const s of shapes) {
      const v = Math.max(0, Math.min(100, s[track]));
      buckets[shapeBucket(v)]! += 1;
      values.push(v);
    }
    values.sort((a, b) => a - b);
    return {
      track,
      buckets,
      median: round(median(values), 1),
      mean: round(values.reduce((a, b) => a + b, 0) / values.length, 1),
    };
  });
}

/**
 * Player-type distribution, most common first, ties broken by code so the
 * output is deterministic (a report figure must not depend on Map order).
 * Only types somebody actually is are listed — a zero row would advertise
 * the code space, and adds nothing.
 */
function typeCounts(shapes: readonly TrackRawScores[]): TypeCount[] {
  const byCode = new Map<string, { name: string; count: number }>();
  for (const s of shapes) {
    const pt = playerType(s);
    const seen = byCode.get(pt.code);
    if (seen) seen.count += 1;
    else byCode.set(pt.code, { name: pt.name, count: 1 });
  }
  return [...byCode.entries()]
    .map(([code, v]) => ({ code, name: v.name, count: v.count, share: round(v.count / shapes.length) }))
    .sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : 1));
}

/**
 * Assemble the public aggregate. Pure: same input, same bytes out.
 *
 * Participation counts are always published — they are one number about a
 * whole population, name nothing, and are the honest headline. Everything
 * that splits the population is gated on `MIN_COHORT_SIZE`.
 */
export function worldAggregates(input: WorldAggregateInput): WorldAggregates {
  const { counts, shapes, exposure, trend } = input;
  const cohortSize = shapes.length;
  const suppressed = cohortSize < MIN_COHORT_SIZE;
  const participation: ParticipationSummary = {
    ...counts,
    completionRate:
      counts.attemptsStarted > 0 ? round(counts.attemptsFinalized / counts.attemptsStarted) : null,
  };
  return {
    minCohortSize: MIN_COHORT_SIZE,
    cohortSize,
    suppressed,
    participation,
    playerTypes: suppressed ? null : typeCounts(shapes),
    tracks: suppressed ? null : trackShapes(shapes),
    // Exposure is a fact about the item bank, gated on the number of DECKS
    // (its own cohort), so one recorded deck can never be read back out.
    exposure: exposure.decksRecorded >= MIN_COHORT_SIZE ? exposure : null,
    // The trend splits the population by time, so it obeys the same floor,
    // measured on the population it actually splits: started attempts.
    trend: counts.attemptsStarted >= MIN_COHORT_SIZE ? [...trend] : null,
  };
}
