/**
 * Persistence operations over db/schema.sql — spec §11/§14 invariants:
 *
 *  - `responses` and `transcripts` are APPEND-ONLY. Nothing here UPDATEs or
 *    DELETEs them. Idempotency rides on the DB uniqueness constraints
 *    (attempt_id, seq) / (attempt_id, track_id, seq): a retried insert with
 *    an identical body is acknowledged as a replay; a different body under
 *    an already-used seq is a conflict, never an overwrite.
 *  - Writes to a finalized attempt are rejected (the attempt row is locked
 *    FOR UPDATE for the duration of the append, so finalize/append races
 *    serialize instead of interleaving).
 *  - Ownership is checked on every attempt-scoped operation: an attempt that
 *    exists but belongs to another participant reads as `not_found` — no
 *    existence leak.
 */

import { TRACK_IDS, type TrackId } from "@ailx/session";
import { withTransaction, type Queryable, type QueryResultRow } from "./db.js";

export type StoreErrorCode =
  | "bad_request"
  | "not_found"
  | "finalized"
  | "seq_conflict";

export class StoreError extends Error {
  constructor(
    public readonly code: StoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StoreError";
  }
}

export const TRANSCRIPT_VERBS = ["prompted", "revised", "regenerated", "submitted"] as const;
export type TranscriptVerb = (typeof TRANSCRIPT_VERBS)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Non-UUID ids can never match a `uuid` column — treat as not found instead of a cast error. */
function assertUuid(id: string, what: string): void {
  if (!UUID_RE.test(id)) throw new StoreError("not_found", `${what} not found`);
}

function assertSeq(seq: number): void {
  if (!Number.isInteger(seq) || seq < 0 || seq > 2 ** 31 - 1) {
    throw new StoreError("bad_request", `seq must be a non-negative 32-bit integer, got ${String(seq)}`);
  }
}

/** Accepts an ISO-8601 string or epoch milliseconds; rejects garbage. */
function toTimestamp(clientTs: string | number, field: string): Date {
  const d = new Date(clientTs);
  if (Number.isNaN(d.getTime())) {
    throw new StoreError("bad_request", `${field} is not a valid timestamp: ${String(clientTs)}`);
  }
  return d;
}

export interface Participant {
  id: string;
  authRef: string;
  locale: string;
}

/**
 * Idempotent participant projection keyed by the AuthProvider reference.
 * A concurrent first-insert race resolves via ON CONFLICT DO NOTHING + read.
 */
export async function ensureParticipant(
  db: Queryable,
  authRef: string,
  locale = "en",
): Promise<Participant> {
  if (!authRef) throw new StoreError("bad_request", "authRef must be non-empty");
  await db.query(
    "INSERT INTO participants (auth_ref, locale) VALUES ($1, $2) ON CONFLICT (auth_ref) DO NOTHING",
    [authRef, locale],
  );
  const { rows } = await db.query(
    "SELECT id, auth_ref, locale FROM participants WHERE auth_ref = $1",
    [authRef],
  );
  const row = rows[0]!;
  return { id: row.id as string, authRef: row.auth_ref as string, locale: row.locale as string };
}

export interface InstrumentRef {
  instrumentId: string;
  instrumentVer: string;
}

/** Idempotent instrument seed (dev/test convenience; production rows come from the content pipeline). */
export async function ensureInstrument(
  db: Queryable,
  ref: InstrumentRef & { packageDigest: string; effectiveFrom: string },
): Promise<void> {
  await db.query(
    `INSERT INTO instruments (id, version, package_digest, effective_from)
     VALUES ($1, $2, $3, $4) ON CONFLICT (id, version) DO NOTHING`,
    [ref.instrumentId, ref.instrumentVer, ref.packageDigest, ref.effectiveFrom],
  );
}

export interface Attempt extends InstrumentRef {
  id: string;
  participantId: string;
  startedAt: string;
  finalizedAt: string | null;
}

function attemptFromRow(row: QueryResultRow): Attempt {
  return {
    id: row.id as string,
    participantId: row.participant_id as string,
    instrumentId: row.instrument_id as string,
    instrumentVer: row.instrument_ver as string,
    startedAt: new Date(row.started_at as string | Date).toISOString(),
    finalizedAt: row.finalized_at == null ? null : new Date(row.finalized_at as string | Date).toISOString(),
  };
}

/**
 * Exposure record for one track's presented deck: the item ids an attempt
 * was SHOWN, in order. Persisted at attempt creation (attempt_decks,
 * insert-once) so per-item stats/IRT cover presented-but-unanswered items.
 */
export interface DeckRecord {
  trackId: TrackId;
  /** Content-addressed sha256 of the bank the ids index into. */
  bankSha256: string;
  /** Presented order; non-empty, no duplicates. */
  itemIds: readonly string[];
}

const SHA256_RE = /^[0-9a-f]{64}$/;

function assertDeckRecord(deck: DeckRecord): void {
  if (!TRACK_IDS.includes(deck.trackId)) {
    throw new StoreError("bad_request", `deck has unknown trackId: ${String(deck.trackId)}`);
  }
  if (typeof deck.bankSha256 !== "string" || !SHA256_RE.test(deck.bankSha256)) {
    throw new StoreError("bad_request", `deck bankSha256 must be a sha256 hex digest`);
  }
  if (!Array.isArray(deck.itemIds) || deck.itemIds.length === 0) {
    throw new StoreError("bad_request", "deck itemIds must be a non-empty array");
  }
  if (deck.itemIds.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new StoreError("bad_request", "deck itemIds must all be non-empty strings");
  }
  if (new Set(deck.itemIds).size !== deck.itemIds.length) {
    throw new StoreError("bad_request", "deck itemIds must not contain duplicates");
  }
}

/**
 * `sampleDecks` (optional) derives the per-attempt exposure decks from the
 * NEW attempt id — it MUST be a pure, deterministic function of that id, so
 * a caller can re-derive the identical records after the fact. Deck rows
 * are inserted in the SAME transaction: an attempt either has its recorded
 * decks or does not exist.
 */
export async function createAttempt(
  db: Queryable,
  participantId: string,
  ref: InstrumentRef,
  sampleDecks?: (attemptId: string) => readonly DeckRecord[],
): Promise<Attempt> {
  assertUuid(participantId, "participant");
  return withTransaction(db, async (tx) => {
    const inst = await tx.query(
      "SELECT 1 FROM instruments WHERE id = $1 AND version = $2",
      [ref.instrumentId, ref.instrumentVer],
    );
    if (inst.rows.length === 0) {
      throw new StoreError(
        "bad_request",
        `unknown instrument ${ref.instrumentId}@${ref.instrumentVer}`,
      );
    }
    const { rows } = await tx.query(
      `INSERT INTO attempts (participant_id, instrument_id, instrument_ver)
       VALUES ($1, $2, $3)
       RETURNING id, participant_id, instrument_id, instrument_ver, started_at, finalized_at`,
      [participantId, ref.instrumentId, ref.instrumentVer],
    );
    const attempt = attemptFromRow(rows[0]!);
    for (const deck of sampleDecks?.(attempt.id) ?? []) {
      assertDeckRecord(deck);
      await tx.query(
        `INSERT INTO attempt_decks (attempt_id, track_id, bank_sha256, item_ids)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [attempt.id, deck.trackId, deck.bankSha256, JSON.stringify(deck.itemIds)],
      );
    }
    return attempt;
  });
}

/** Owned read of the recorded exposure decks (empty for legacy attempts). */
export async function getDecks(
  db: Queryable,
  attemptId: string,
  participantId: string,
): Promise<DeckRecord[]> {
  if (!UUID_RE.test(attemptId) || !UUID_RE.test(participantId)) return [];
  const { rows } = await db.query(
    `SELECT d.track_id, d.bank_sha256, d.item_ids
     FROM attempt_decks d JOIN attempts a ON a.id = d.attempt_id
     WHERE d.attempt_id = $1 AND a.participant_id = $2
     ORDER BY d.track_id`,
    [attemptId, participantId],
  );
  return rows.map((r) => ({
    trackId: r.track_id as TrackId,
    bankSha256: r.bank_sha256 as string,
    itemIds: (typeof r.item_ids === "string" ? JSON.parse(r.item_ids) : r.item_ids) as string[],
  }));
}

export interface AttemptSummary extends Attempt {
  responseCount: number;
  transcriptCount: number;
}

/** Owned read: returns null when the attempt is missing OR owned by someone else. */
export async function getAttempt(
  db: Queryable,
  attemptId: string,
  participantId: string,
): Promise<AttemptSummary | null> {
  if (!UUID_RE.test(attemptId) || !UUID_RE.test(participantId)) return null;
  const { rows } = await db.query(
    `SELECT a.id, a.participant_id, a.instrument_id, a.instrument_ver, a.started_at, a.finalized_at,
            (SELECT count(*) FROM responses r WHERE r.attempt_id = a.id) AS response_count,
            (SELECT count(*) FROM transcripts t WHERE t.attempt_id = a.id) AS transcript_count
     FROM attempts a WHERE a.id = $1 AND a.participant_id = $2`,
    [attemptId, participantId],
  );
  if (rows.length === 0) return null;
  const row = rows[0]!;
  return {
    ...attemptFromRow(row),
    responseCount: Number(row.response_count),
    transcriptCount: Number(row.transcript_count),
  };
}

/** Locks the attempt row; throws not_found / finalized as appropriate. */
async function lockOpenAttempt(
  tx: Queryable,
  attemptId: string,
  participantId: string,
): Promise<void> {
  assertUuid(attemptId, "attempt");
  assertUuid(participantId, "participant");
  const { rows } = await tx.query(
    "SELECT finalized_at FROM attempts WHERE id = $1 AND participant_id = $2 FOR UPDATE",
    [attemptId, participantId],
  );
  if (rows.length === 0) throw new StoreError("not_found", "attempt not found");
  if (rows[0]!.finalized_at != null) {
    throw new StoreError("finalized", "attempt is finalized — the log is closed");
  }
}

export interface AppendResult {
  id: string;
  /** false = idempotent replay of an identical, already-stored row. */
  created: boolean;
}

export interface ResponseInput {
  seq: number;
  payload: unknown;
  clientTs: string | number;
  itemId?: string | null;
  latencyMs?: number | null;
}

export async function appendResponse(
  db: Queryable,
  attemptId: string,
  participantId: string,
  input: ResponseInput,
): Promise<AppendResult> {
  assertSeq(input.seq);
  if (input.payload === undefined || input.payload === null || typeof input.payload !== "object") {
    throw new StoreError("bad_request", "payload must be a JSON object or array");
  }
  const clientTs = toTimestamp(input.clientTs, "clientTs");
  const payloadJson = JSON.stringify(input.payload);
  return withTransaction(db, async (tx) => {
    await lockOpenAttempt(tx, attemptId, participantId);
    const inserted = await tx.query(
      `INSERT INTO responses (attempt_id, item_id, seq, payload, client_ts, latency_ms)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       ON CONFLICT (attempt_id, seq) DO NOTHING
       RETURNING id`,
      [attemptId, input.itemId ?? null, input.seq, payloadJson, clientTs.toISOString(), input.latencyMs ?? null],
    );
    if (inserted.rows.length > 0) {
      return { id: String(inserted.rows[0]!.id), created: true };
    }
    const { rows } = await tx.query(
      `SELECT id,
              (payload = $3::jsonb AND item_id IS NOT DISTINCT FROM $4) AS same
       FROM responses WHERE attempt_id = $1 AND seq = $2`,
      [attemptId, input.seq, payloadJson, input.itemId ?? null],
    );
    const existing = rows[0]!;
    if (existing.same !== true) {
      throw new StoreError(
        "seq_conflict",
        `seq ${input.seq} already holds a different response — responses are append-only`,
      );
    }
    return { id: String(existing.id), created: false };
  });
}

export interface TranscriptInput {
  trackId: TrackId;
  seq: number;
  verb: TranscriptVerb;
  body: unknown;
  clientTs: string | number;
  revisionOf?: string | number | null;
}

export async function appendTranscript(
  db: Queryable,
  attemptId: string,
  participantId: string,
  input: TranscriptInput,
): Promise<AppendResult> {
  assertSeq(input.seq);
  if (!TRACK_IDS.includes(input.trackId)) {
    throw new StoreError("bad_request", `unknown trackId: ${String(input.trackId)}`);
  }
  if (!TRANSCRIPT_VERBS.includes(input.verb)) {
    throw new StoreError("bad_request", `unknown verb: ${String(input.verb)}`);
  }
  if (input.body === undefined || input.body === null || typeof input.body !== "object") {
    throw new StoreError("bad_request", "body must be a JSON object or array");
  }
  const clientTs = toTimestamp(input.clientTs, "clientTs");
  const bodyJson = JSON.stringify(input.body);
  const revisionOf = input.revisionOf == null ? null : String(input.revisionOf);
  if (revisionOf !== null && !/^\d+$/.test(revisionOf)) {
    throw new StoreError("bad_request", `revisionOf must be a transcript id, got ${revisionOf}`);
  }
  return withTransaction(db, async (tx) => {
    await lockOpenAttempt(tx, attemptId, participantId);
    if (revisionOf !== null) {
      // FK alone would accept a transcript id from ANOTHER attempt.
      const parent = await tx.query(
        "SELECT 1 FROM transcripts WHERE id = $1 AND attempt_id = $2",
        [revisionOf, attemptId],
      );
      if (parent.rows.length === 0) {
        throw new StoreError("bad_request", `revisionOf ${revisionOf} is not a transcript of this attempt`);
      }
    }
    const inserted = await tx.query(
      `INSERT INTO transcripts (attempt_id, track_id, seq, verb, body, revision_of, client_ts)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       ON CONFLICT (attempt_id, track_id, seq) DO NOTHING
       RETURNING id`,
      [attemptId, input.trackId, input.seq, input.verb, bodyJson, revisionOf, clientTs.toISOString()],
    );
    if (inserted.rows.length > 0) {
      return { id: String(inserted.rows[0]!.id), created: true };
    }
    const { rows } = await tx.query(
      `SELECT id,
              (body = $4::jsonb AND verb = $5 AND revision_of IS NOT DISTINCT FROM $6::bigint) AS same
       FROM transcripts WHERE attempt_id = $1 AND track_id = $2 AND seq = $3`,
      [attemptId, input.trackId, input.seq, bodyJson, input.verb, revisionOf],
    );
    const existing = rows[0]!;
    if (existing.same !== true) {
      throw new StoreError(
        "seq_conflict",
        `transcript seq ${input.seq} for ${input.trackId} already holds a different entry — transcripts are append-only`,
      );
    }
    return { id: String(existing.id), created: false };
  });
}

export interface FinalizeResult {
  finalizedAt: string;
  /** true = idempotent replay; the original finalization timestamp is returned. */
  alreadyFinalized: boolean;
}

/**
 * One-way close of the attempt log. Never re-stamps: a second call returns
 * the ORIGINAL finalized_at (idempotent replay), so the audit timestamp is
 * written exactly once.
 */
export async function finalizeAttempt(
  db: Queryable,
  attemptId: string,
  participantId: string,
): Promise<FinalizeResult> {
  assertUuid(attemptId, "attempt");
  assertUuid(participantId, "participant");
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query(
      "SELECT finalized_at FROM attempts WHERE id = $1 AND participant_id = $2 FOR UPDATE",
      [attemptId, participantId],
    );
    if (rows.length === 0) throw new StoreError("not_found", "attempt not found");
    const existing = rows[0]!.finalized_at;
    if (existing != null) {
      return { finalizedAt: new Date(existing as string | Date).toISOString(), alreadyFinalized: true };
    }
    const updated = await tx.query(
      "UPDATE attempts SET finalized_at = now() WHERE id = $1 RETURNING finalized_at",
      [attemptId],
    );
    return {
      finalizedAt: new Date(updated.rows[0]!.finalized_at as string | Date).toISOString(),
      alreadyFinalized: false,
    };
  });
}
