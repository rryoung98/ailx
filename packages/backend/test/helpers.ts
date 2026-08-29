/**
 * In-process Postgres (PGlite) with the REAL db/schema.sql applied — the
 * integration tests exercise the same DDL production runs, no mocks, and the
 * default `pnpm -r test` needs no external services.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { TRACK_IDS } from "@ailx/session";
import type { Queryable } from "../src/db.js";
import {
  appendResponse,
  ensureInstrument,
  ensureParticipant,
  createAttempt,
  type Attempt,
} from "../src/store.js";

const SCHEMA = readFileSync(new URL("../../../db/schema.sql", import.meta.url), "utf8");

export const TEST_INSTRUMENT = { instrumentId: "ailx", instrumentVer: "2026.1" } as const;

export async function freshDb(): Promise<PGlite & Queryable> {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await ensureInstrument(db, {
    ...TEST_INSTRUMENT,
    packageDigest: "sha256:test",
    effectiveFrom: "2026-01-01",
  });
  return db;
}

let seq = 0;

/** Fresh participant + open attempt; unique per call so suites can share a db. */
export async function openAttempt(db: Queryable): Promise<{ participantId: string; attempt: Attempt }> {
  const participant = await ensureParticipant(db, `dev:user-${seq++}`);
  const attempt = await createAttempt(db, participant.id, TEST_INSTRUMENT);
  return { participantId: participant.id, attempt };
}

export async function count(db: Queryable, table: "responses" | "transcripts", attemptId: string): Promise<number> {
  const { rows } = await db.query(`SELECT count(*) AS n FROM ${table} WHERE attempt_id = $1`, [attemptId]);
  return Number(rows[0]!.n);
}

/**
 * What apps/web actually writes: the WHOLE session-log entry as
 * `responses.payload`, one row per log entry (so `item_id` and `latency_ms`
 * are NULL and every derivation must project the payloads). One definition,
 * shared by the share, gallery and aggregate suites.
 */
export async function mirrorScoredRun(
  db: Queryable,
  attemptId: string,
  participantId: string,
  scaled: readonly number[] = [88, 80, 72, 66],
): Promise<void> {
  const entries: unknown[] = [
    {
      type: "attempt_started",
      attemptId,
      seq: 0,
      ts: 1_767_225_600_000,
      config: { instrument: "ailx", version: "2026.1", locale: "en", demo: true, budgets: { t1: 1, t2: 1, t3: 1, t4: 1 } },
    },
    ...TRACK_IDS.map((t, i) => ({
      type: "track_scored",
      trackId: t,
      seq: i + 1,
      ts: 1_767_225_600_000 + i + 1,
      score: { raw: {}, scaled: scaled[i] },
      rubricVersion: `rv-${t}`,
      scoringDigest: `sd-${t}`,
      modelManifest: { screening: "demo-judge@1" },
    })),
  ];
  for (const [i, payload] of entries.entries()) {
    await appendResponse(db, attemptId, participantId, {
      seq: i,
      payload,
      clientTs: 1_767_225_600_000 + i,
    });
  }
}

/** A fresh participant with one fully scored, mirrored run. */
export async function scoredAttempt(
  db: Queryable,
  scaled?: readonly number[],
): Promise<{ participantId: string; attemptId: string }> {
  const { participantId, attempt } = await openAttempt(db);
  await mirrorScoredRun(db, attempt.id, participantId, scaled);
  return { participantId, attemptId: attempt.id };
}

/** Give an attempt a published T1 snapshot, so `includeSite` has a target. */
export async function attachSiteSnapshot(
  db: Queryable,
  attemptId: string,
  participantId: string,
  seq = 98,
  digest = `sha256:${"b".repeat(64)}`,
): Promise<string> {
  await appendResponse(db, attemptId, participantId, {
    seq,
    payload: { kind: "t1-site-snapshot", digest, fileCount: 1, totalBytes: 10 },
    clientTs: 1_767_225_800_000,
  });
  return digest;
}
