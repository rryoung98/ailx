/**
 * In-process Postgres (PGlite) with the REAL db/schema.sql applied — the
 * integration tests exercise the same DDL production runs, no mocks, and the
 * default `pnpm -r test` needs no external services.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import type { Queryable } from "../src/db.js";
import { ensureInstrument, ensureParticipant, createAttempt, type Attempt } from "../src/store.js";

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
