/**
 * Collecting the public "how is the world doing" aggregate from the store.
 *
 * The SHAPING (thresholds, histograms, what may be published at all) is pure
 * and lives in `@ailx/report`; this module only counts. Two data truths drive
 * how it counts:
 *
 *  1. `responses` mirrors the whole client session log — one row per LOG
 *     entry, so `responses.item_id` and `responses.latency_ms` are NULL and
 *     are NOT a per-item source. Track shape is therefore read by PROJECTING
 *     the stored payloads through @ailx/session `project()`, exactly like the
 *     share payload is built.
 *  2. `attempt_decks` is the authoritative record of which items an attempt
 *     was SHOWN. Its item ids are aggregated INSIDE SQL and never leave it:
 *     the published summary is "how many distinct items, how often", never
 *     which ones (docs/SHARING.md — item-bank leakage).
 *
 * Track scores here are the run's OWN scorer output as mirrored from the
 * event log. That is advisory (FRONTEND.md §4.7) and is labeled as such on
 * the page; it is not a judged score, and no judged score exists yet.
 */

import { project, TRACK_IDS, type SequencedEntry, type TrackRawScores } from "@ailx/session";
import { worldAggregates, type ExposureSummary, type TrendPoint, type WorldAggregates } from "@ailx/report";
import type { Queryable } from "./db.js";
import type { ApiContext, ApiResult } from "./handlers.js";

/** Log entry types a track shape needs; everything else is noise here. */
const SHAPE_ENTRY_TYPES = ["attempt_started", "track_scored"];

/**
 * Every run that has all four track scores, as a four-number shape.
 *
 * One query, grouped in memory by attempt and projected per attempt: the
 * projection is the only sanctioned reader of a mirrored log, and filtering
 * on the payload's own `type` (not on the NULL columns) keeps the scan
 * proportional to the scored entries rather than to the whole event log.
 */
export async function trackShapes(db: Queryable): Promise<TrackRawScores[]> {
  const { rows } = await db.query(
    `SELECT attempt_id, payload FROM responses
      WHERE payload->>'type' = ANY($1)
      ORDER BY attempt_id, seq`,
    [SHAPE_ENTRY_TYPES],
  );
  const byAttempt = new Map<string, SequencedEntry[]>();
  for (const row of rows) {
    const p = (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload) as
      | Partial<SequencedEntry>
      | null;
    if (!p || typeof p.type !== "string" || typeof p.seq !== "number") continue;
    const key = String(row.attempt_id);
    const log = byAttempt.get(key) ?? [];
    log.push(p as SequencedEntry);
    byAttempt.set(key, log);
  }
  const shapes: TrackRawScores[] = [];
  for (const log of byAttempt.values()) {
    const state = project(log);
    const shape = {} as TrackRawScores;
    let complete = true;
    for (const t of TRACK_IDS) {
      const score = state.tracks[t].score;
      if (!score) {
        complete = false;
        break;
      }
      shape[t] = score.scaled;
    }
    if (complete) shapes.push(shape);
  }
  return shapes;
}

/**
 * Item exposure, aggregated in the database so no item id is ever materialized
 * in application memory, let alone in a response body.
 */
export async function itemExposure(db: Queryable): Promise<ExposureSummary> {
  const { rows } = await db.query(
    `WITH per_item AS (
       SELECT item, count(*) AS n
         FROM attempt_decks d, jsonb_array_elements_text(d.item_ids) AS item
        GROUP BY item
     )
     SELECT (SELECT count(*) FROM attempt_decks)     AS decks,
            count(*)                                  AS distinct_items,
            coalesce(sum(n), 0)                       AS total,
            coalesce(max(n), 0)                       AS busiest
       FROM per_item`,
  );
  const r = rows[0] ?? {};
  const distinctItems = Number(r.distinct_items ?? 0);
  const totalExposures = Number(r.total ?? 0);
  return {
    decksRecorded: Number(r.decks ?? 0),
    distinctItems,
    totalExposures,
    meanExposuresPerItem: distinctItems === 0 ? 0 : Math.round((totalExposures / distinctItems) * 10) / 10,
    maxExposuresPerItem: Number(r.busiest ?? 0),
  };
}

/** Attempts per ISO week — the "is this growing" line, and nothing per person. */
export async function attemptTrend(db: Queryable): Promise<TrendPoint[]> {
  const { rows } = await db.query(
    `SELECT to_char(date_trunc('week', started_at), 'YYYY-MM-DD') AS period,
            count(*)                 AS started,
            count(finalized_at)      AS finalized
       FROM attempts
      GROUP BY 1
      ORDER BY 1`,
  );
  return rows.map((r) => ({
    period: String(r.period),
    started: Number(r.started),
    finalized: Number(r.finalized),
  }));
}

/** The whole public aggregate, ready to serialize. */
export async function collectWorldAggregates(db: Queryable): Promise<WorldAggregates> {
  const counted = await db.query(
    `SELECT (SELECT count(*) FROM participants)                          AS participants,
            (SELECT count(*) FROM attempts)                              AS started,
            (SELECT count(*) FROM attempts WHERE finalized_at IS NOT NULL) AS finalized`,
  );
  const c = counted.rows[0] ?? {};
  const [shapes, exposure, trend] = await Promise.all([
    trackShapes(db),
    itemExposure(db),
    attemptTrend(db),
  ]);
  return worldAggregates({
    counts: {
      participants: Number(c.participants ?? 0),
      attemptsStarted: Number(c.started ?? 0),
      attemptsFinalized: Number(c.finalized ?? 0),
    },
    shapes,
    exposure,
    trend,
  });
}

/** GET the public aggregate. Unauthenticated: it is a public statistic. */
export async function handleWorldAggregates(ctx: ApiContext): Promise<ApiResult> {
  return { status: 200, body: { aggregates: await collectWorldAggregates(ctx.db) } };
}
