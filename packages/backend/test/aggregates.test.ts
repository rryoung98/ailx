/**
 * World aggregates against the real schema.
 *
 * These tests exist to prove two things the pure shaping cannot: that the
 * counting reads the store correctly given how the mirror actually writes
 * (whole log entries, NULL item_id, NULL latency_ms), and that the serialized
 * public payload contains no per-person row of any kind.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { MIN_COHORT_SIZE } from "@ailx/report";
import { DevAuthProvider } from "../src/auth.js";
import type { ApiContext } from "../src/handlers.js";
import type { Queryable } from "../src/db.js";
import {
  attemptTrend,
  collectWorldAggregates,
  handleWorldAggregates,
  itemExposure,
  trackShapes,
} from "../src/aggregates.js";
import { createAttempt, ensureParticipant, finalizeAttempt } from "../src/store.js";
import { freshDb, mirrorScoredRun, openAttempt, scoredAttempt, TEST_INSTRUMENT } from "./helpers.js";

let db: Queryable;
let ctx: ApiContext;

beforeEach(async () => {
  db = await freshDb();
  ctx = { db, auth: new DevAuthProvider() };
});

/** `n` finalized, fully scored runs, each with a slightly different shape. */
async function cohort(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const { participantId, attemptId } = await scoredAttempt(db, [
      10 + ((i * 9) % 90),
      90 - ((i * 7) % 80),
      40 + (i % 50),
      55 + (i % 30),
    ]);
    await finalizeAttempt(db, attemptId, participantId);
  }
}

async function deck(attemptId: string, trackId: string, itemIds: string[]): Promise<void> {
  await db.query(
    "INSERT INTO attempt_decks (attempt_id, track_id, bank_sha256, item_ids) VALUES ($1, $2, $3, $4::jsonb)",
    [attemptId, trackId, "sha256:bank", JSON.stringify(itemIds)],
  );
}

describe("track shapes", () => {
  it("projects the mirrored log rather than reading the NULL item columns", async () => {
    const { attemptId } = await scoredAttempt(db, [88, 80, 72, 66]);
    const { rows } = await db.query(
      "SELECT count(*) AS n FROM responses WHERE attempt_id = $1 AND (item_id IS NOT NULL OR latency_ms IS NOT NULL)",
      [attemptId],
    );
    expect(Number(rows[0]!.n)).toBe(0); // the mirror really does write NULLs
    expect(await trackShapes(db)).toEqual([{ t1: 88, t2: 80, t3: 72, t4: 66 }]);
  });

  it("skips a run that is not scored on all four tracks", async () => {
    const { participantId, attempt } = await openAttempt(db);
    await mirrorScoredRun(db, attempt.id, participantId);
    const { participantId: p2, attempt: a2 } = await openAttempt(db);
    await db.query(
      "INSERT INTO responses (attempt_id, seq, payload, client_ts) VALUES ($1, 0, $2::jsonb, now())",
      [a2.id, JSON.stringify({ type: "attempt_started", attemptId: a2.id, seq: 0, ts: 1 })],
    );
    expect(p2).toBeTruthy();
    expect(await trackShapes(db)).toHaveLength(1);
  });

  it("keeps runs apart — one attempt's scores never leak into another's shape", async () => {
    await scoredAttempt(db, [10, 10, 10, 10]);
    await scoredAttempt(db, [90, 90, 90, 90]);
    const shapes = await trackShapes(db);
    expect(shapes).toHaveLength(2);
    expect(shapes.map((s) => s.t1).sort((a, b) => a - b)).toEqual([10, 90]);
  });

  it("ignores a garbage response row instead of throwing", async () => {
    const { attempt } = await openAttempt(db);
    await db.query(
      "INSERT INTO responses (attempt_id, seq, payload, client_ts) VALUES ($1, 0, $2::jsonb, now())",
      [attempt.id, JSON.stringify({ type: "track_scored", noSeq: true })],
    );
    await expect(trackShapes(db)).resolves.toEqual([]);
  });
});

describe("item exposure", () => {
  it("counts decks and items from attempt_decks, the authoritative source", async () => {
    const { attempt } = await openAttempt(db);
    const { attempt: b } = await openAttempt(db);
    await deck(attempt.id, "t2", ["i1", "i2", "i3"]);
    await deck(b.id, "t2", ["i1", "i2"]);
    expect(await itemExposure(db)).toEqual({
      decksRecorded: 2,
      distinctItems: 3,
      totalExposures: 5,
      meanExposuresPerItem: 1.7,
      maxExposuresPerItem: 2,
    });
  });

  it("is all zeros, not a crash, when nothing has been shown yet", async () => {
    expect(await itemExposure(db)).toEqual({
      decksRecorded: 0,
      distinctItems: 0,
      totalExposures: 0,
      meanExposuresPerItem: 0,
      maxExposuresPerItem: 0,
    });
  });
});

describe("the trend", () => {
  it("buckets attempts by week and counts finalized ones", async () => {
    await cohort(3);
    const trend = await attemptTrend(db);
    expect(trend).toHaveLength(1);
    expect(trend[0]!.started).toBe(3);
    expect(trend[0]!.finalized).toBe(3);
    expect(trend[0]!.period).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("counts an unfinished attempt as started but not finalized", async () => {
    const participant = await ensureParticipant(db, "dev:unfinished");
    await createAttempt(db, participant.id, TEST_INSTRUMENT);
    const trend = await attemptTrend(db);
    expect(trend[0]!.started).toBe(1);
    expect(trend[0]!.finalized).toBe(0);
  });
});

describe("the public aggregate", () => {
  it("suppresses every breakdown while the cohort is small", async () => {
    await cohort(MIN_COHORT_SIZE - 1);
    const out = await collectWorldAggregates(db);
    expect(out.suppressed).toBe(true);
    expect(out.playerTypes).toBeNull();
    expect(out.tracks).toBeNull();
    expect(out.participation.attemptsStarted).toBe(MIN_COHORT_SIZE - 1);
    expect(out.participation.completionRate).toBe(1);
  });

  it("publishes distributions once the cohort clears the threshold", async () => {
    await cohort(MIN_COHORT_SIZE);
    const out = await collectWorldAggregates(db);
    expect(out.suppressed).toBe(false);
    expect(out.cohortSize).toBe(MIN_COHORT_SIZE);
    expect(out.tracks!.every((t) => t.buckets.reduce((a, b) => a + b, 0) === MIN_COHORT_SIZE)).toBe(true);
    expect(out.playerTypes!.reduce((a, t) => a + t.count, 0)).toBe(MIN_COHORT_SIZE);
    expect(out.trend!.reduce((a, p) => a + p.started, 0)).toBe(MIN_COHORT_SIZE);
  });

  it("emits no per-person row — the exact serialized payload is counts only", async () => {
    await cohort(MIN_COHORT_SIZE);
    const { attempt } = await openAttempt(db);
    await deck(attempt.id, "t2", ["item-secret-1", "item-secret-2"]);
    for (let i = 0; i < MIN_COHORT_SIZE; i++) {
      const { attempt: a } = await openAttempt(db);
      await deck(a.id, "t2", ["item-secret-1"]);
    }
    const res = await handleWorldAggregates(ctx);
    expect(res.status).toBe(200);
    const serialized = JSON.stringify(res.body);

    // No identifier, no item id, no attempt, no participant, no share.
    expect(serialized).not.toContain("item-secret");
    expect(serialized).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    for (const forbidden of ["dev:", "auth_ref", "attemptId", "attempt_id", "participantId", "token", "payload", "percentile", "composite"]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
    // And the shape is exactly the documented key set.
    expect(Object.keys(res.body.aggregates as object).sort()).toEqual([
      "cohortSize",
      "exposure",
      "minCohortSize",
      "participation",
      "playerTypes",
      "suppressed",
      "tracks",
      "trend",
    ]);
    expect(Object.keys((res.body.aggregates as { exposure: object }).exposure).sort()).toEqual([
      "decksRecorded",
      "distinctItems",
      "maxExposuresPerItem",
      "meanExposuresPerItem",
      "totalExposures",
    ]);
  });

  it("answers on an empty database without inventing a cohort", async () => {
    const out = await collectWorldAggregates(db);
    expect(out).toMatchObject({
      cohortSize: 0,
      suppressed: true,
      playerTypes: null,
      tracks: null,
      exposure: null,
      trend: null,
      participation: { participants: 0, attemptsStarted: 0, attemptsFinalized: 0, completionRate: null },
    });
  });
});
