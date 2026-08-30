/**
 * In-process Postgres (PGlite) with the REAL db/schema.sql applied — the
 * integration tests exercise the same DDL production runs, no mocks, and the
 * default `pnpm -r test` needs no external services.
 */
import { PGlite } from "@electric-sql/pglite";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
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

/**
 * One PGlite per test file, reused across its tests. Booting an in-process
 * Postgres costs ~1s and ~250MB of wasm heap that is never returned to the OS,
 * so a suite that boots one per TEST spent minutes and gigabytes on a cluster
 * it already had.
 * Reuse gives the same guarantee for far less: every call hands back a database
 * with the real `db/schema.sql` DDL and NO rows, because TRUNCATE ... RESTART
 * IDENTITY CASCADE erases every table and sequence. Vitest isolates test FILES
 * in separate module graphs, so no two files ever share this instance.
 */
let shared: (PGlite & Queryable) | undefined;
/** Derived from the live catalog, never a hand-kept list that drifts from the schema. */
let truncateAll: string | undefined;

/**
 * Identifies the installed PGlite build. Its `package.json` is not exported, so
 * the key is the resolved entry path (which carries the version under pnpm)
 * plus that file's byte size — enough that no version bump can be handed a
 * cluster initialised by a different engine. Over-invalidating is free: it
 * costs one 1s rebuild.
 */
function pgliteBuildId(): string {
  const entry = createRequire(import.meta.url).resolve("@electric-sql/pglite");
  return `${entry}:${statSync(entry).size}`;
}

/** Exported so `dbImage.test.ts` can exercise both the cold and cached paths. */
export const IMAGE_PATH = new URL(
  `../node_modules/.cache/ailx-pglite/${createHash("sha256")
    .update(SCHEMA)
    .update(pgliteBuildId())
    .digest("hex")
    .slice(0, 16)}.tar`,
  import.meta.url,
).pathname;

/**
 * A cold `new PGlite()` is not paying for our DDL — it is paying for `initdb`,
 * which builds an empty Postgres cluster from scratch: measured 1051ms, against
 * 30ms to then run the whole of `db/schema.sql`. Booting from a data directory
 * that already contains the cluster AND the schema costs 157ms, so every test
 * file after the first saves ~0.9s of pure CPU.
 *
 * The image is built once, by whichever worker gets there first, and cached on
 * disk under a key that content-addresses `db/schema.sql` and the PGlite
 * version — so a schema edit or a dependency bump can never be served a stale
 * cluster. The write is temp-file-then-rename because several forks race here,
 * and rename is atomic: a reader sees the whole image or no image at all.
 *
 * This does not weaken isolation. It strengthens it: a file used to inherit
 * whatever the previous file left behind, minus a TRUNCATE; now it starts from
 * a byte-identical freshly-initialised cluster.
 */
async function bootFromImage(): Promise<PGlite & Queryable> {
  const cached = await readFile(IMAGE_PATH).catch(() => undefined);
  if (cached) {
    return new PGlite({ loadDataDir: new Blob([cached]) }) as PGlite & Queryable;
  }
  const db = new PGlite() as PGlite & Queryable;
  await db.exec(SCHEMA);
  const dump = Buffer.from(await (await db.dumpDataDir("none")).arrayBuffer());
  const tmp = `${IMAGE_PATH}.${process.pid}.tmp`;
  mkdirSync(dirname(IMAGE_PATH), { recursive: true });
  writeFileSync(tmp, dump);
  renameSync(tmp, IMAGE_PATH);
  return db;
}

export async function freshDb(): Promise<PGlite & Queryable> {
  if (!shared) {
    shared = await bootFromImage();
    const { rows } = await shared.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    const tables = rows.map((r) => `"${String((r as { tablename: string }).tablename)}"`);
    truncateAll = `TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`;
  } else {
    await shared.exec(truncateAll!);
  }
  await ensureInstrument(shared, {
    ...TEST_INSTRUMENT,
    packageDigest: "sha256:test",
    effectiveFrom: "2026-01-01",
  });
  return shared;
}

/** Release the wasm heap as soon as the file is done (see `test/setup.ts`). */
export async function closeDb(): Promise<void> {
  await shared?.close();
  shared = undefined;
  truncateAll = undefined;
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

/** Give an attempt a published T1 snapshot, so the `site` section has a target. */
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
