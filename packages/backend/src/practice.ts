/**
 * Practice sessions, streaks and the personal progression read.
 *
 * Three rules this module exists to enforce, none of which a browser can be
 * trusted with (FRONTEND.md §4.7):
 *
 *  1. THE DECK IS DEALT HERE. A client asks for a drill and is told which
 *     practice items it was dealt; it cannot choose them, and an answer to an
 *     item that was not dealt is refused. The deck is a pure function of the
 *     session id (@ailx/report `samplePracticeDeck`), so it re-derives.
 *  2. THE GRADE IS COMPUTED HERE. `correct` is always `gradePractice(itemId,
 *     choice)`; the client's own verdict is never read and never stored.
 *  3. THE STREAK IS DERIVED HERE. Nothing stores a streak counter. Days come
 *     from server-stamped `completed_at` values, and a session is stamped
 *     only if it qualified — whole deck answered, and elapsed time measured
 *     between the server's own `started_at` and the server's clock at submit.
 *     An instantly-abandoned or scripted session buys nothing.
 *
 * Practice touches no scored surface: no `attempts` row, no `responses` row,
 * no `score()`. It is training, and spec §13's governing rule keeps training
 * out of measurement.
 */
import { project } from "@ailx/session";
import {
  PRACTICE_BANK_VERSION,
  PRACTICE_DECK_SIZE,
  TRACK_META,
  clampTzOffset,
  gradePractice,
  localDay,
  practiceItem,
  progressReport,
  qualifiesForStreak,
  samplePracticeDeck,
  type PracticeDayCounts,
  type PracticeQualification,
  type ProgressReport,
  type SittingPoint,
} from "@ailx/report";
import { withTransaction, type Queryable } from "./db.js";
import { StoreError } from "./store.js";

/** A non-uuid id can never match a `uuid` column — probe it as a miss, not a cast error. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
import type { ApiContext, ApiResult } from "./handlers.js";
import { withParticipant } from "./handlers.js";
import { logsByAttempt, shapeOf } from "./aggregates.js";

/** The only drill that exists today. Recorded so a second one can be added. */
export const PRACTICE_DRILL = "artefact-families";

/** Hard cap on submitted answers — one per dealt card, and nothing beyond. */
export const MAX_PRACTICE_ANSWERS = PRACTICE_DECK_SIZE;

export interface PracticeSession {
  id: string;
  drill: string;
  bankVersion: string;
  itemIds: string[];
  startedAt: string;
  completedAt: string | null;
}

function sessionFromRow(row: Record<string, unknown>): PracticeSession {
  const ids = row.item_ids;
  return {
    id: row.id as string,
    drill: row.drill as string,
    bankVersion: row.bank_version as string,
    itemIds: (typeof ids === "string" ? JSON.parse(ids) : ids) as string[],
    startedAt: new Date(row.started_at as string | Date).toISOString(),
    completedAt:
      row.completed_at == null ? null : new Date(row.completed_at as string | Date).toISOString(),
  };
}

/**
 * Deal a drill. The id is generated first so the deck can be seeded by it and
 * inserted in the SAME statement — the row is never written and then edited,
 * which keeps `item_ids` a fact about the deal rather than a later claim.
 */
export async function startPractice(
  db: Queryable,
  participantId: string,
): Promise<PracticeSession> {
  const generated = await db.query("SELECT gen_random_uuid() AS id");
  const id = generated.rows[0]!.id as string;
  const itemIds = samplePracticeDeck(id);
  const { rows } = await db.query(
    `INSERT INTO practice_sessions (id, participant_id, drill, bank_version, item_ids)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id, drill, bank_version, item_ids, started_at, completed_at`,
    [id, participantId, PRACTICE_DRILL, PRACTICE_BANK_VERSION, JSON.stringify(itemIds)],
  );
  return sessionFromRow(rows[0]!);
}

export interface PracticeAnswerInput {
  seq: number;
  itemId: string;
  choice: number;
  latencyMs?: number | null;
  clientTs: string | number;
}

export interface PracticeResult {
  session: PracticeSession;
  answered: number;
  correct: number;
  /** Per-answer verdicts in submitted order — the immediate feedback. */
  verdicts: Array<{ itemId: string; choice: number; correct: boolean }>;
  /** Whether the session earned its streak day, and why not when it did not. */
  qualification: PracticeQualification;
}

function asInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new StoreError("bad_request", `${field} must be an integer`);
  }
  return value;
}

function toTimestamp(value: string | number, field: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new StoreError("bad_request", `${field} is not a valid timestamp`);
  }
  return d;
}

/**
 * Submit a whole drill: append the answers (append-only), then decide — from
 * the server's own clock and the server's own grading — whether the session
 * counts towards the streak.
 *
 * Every rejection is a StoreError, never a silent drop:
 *  - a session that is not the caller's reads as `not_found` (no existence leak);
 *  - a session already completed is `finalized` (a streak day is claimed once);
 *  - an answer to an item this session was NOT dealt is `bad_request`, which
 *    is the check that stops a client answering its way through the corpus.
 */
export async function submitPractice(
  db: Queryable,
  participantId: string,
  sessionId: string,
  input: { answers: readonly PracticeAnswerInput[]; tzOffsetMinutes?: unknown },
  now: number,
): Promise<PracticeResult> {
  if (!Array.isArray(input.answers)) throw new StoreError("bad_request", "answers must be an array");
  if (input.answers.length > MAX_PRACTICE_ANSWERS) {
    throw new StoreError("bad_request", `at most ${MAX_PRACTICE_ANSWERS} answers per session`);
  }
  // One transaction: a submit is atomic, so a refused answer leaves NO rows
  // behind and the honest retry that follows it still has every seq free.
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query(
      `SELECT id, drill, bank_version, item_ids, started_at, completed_at
         FROM practice_sessions WHERE id = $1 AND participant_id = $2 FOR UPDATE`,
      [UUID_RE.test(sessionId) ? sessionId : NIL_UUID, participantId],
    );
    if (rows.length === 0) throw new StoreError("not_found", "practice session not found");
    const session = sessionFromRow(rows[0]!);
    if (session.completedAt !== null) {
      throw new StoreError("finalized", "practice session is already complete");
    }

    // Validate and grade EVERY answer before writing any of them.
    const dealt = new Set(session.itemIds);
    const seen = new Set<number>();
    const verdicts: PracticeResult["verdicts"] = [];
    const values: unknown[] = [];
    const tuples: string[] = [];
    let correct = 0;
    for (const answer of input.answers) {
      const seq = asInt(answer.seq, "seq");
      if (seq < 0 || seq >= MAX_PRACTICE_ANSWERS) {
        throw new StoreError("bad_request", `seq must be 0..${MAX_PRACTICE_ANSWERS - 1}`);
      }
      if (seen.has(seq)) throw new StoreError("bad_request", `duplicate seq ${seq}`);
      seen.add(seq);
      if (typeof answer.itemId !== "string" || !dealt.has(answer.itemId)) {
        throw new StoreError("bad_request", "answer names an item this session was not dealt");
      }
      const choice = asInt(answer.choice, "choice");
      const isCorrect = gradePractice(answer.itemId, choice);
      if (isCorrect) correct++;
      verdicts.push({ itemId: answer.itemId, choice, correct: isCorrect });
      const at = values.length;
      tuples.push(`($1, $${at + 2}, $${at + 3}, $${at + 4}, $${at + 5}, $${at + 6}, $${at + 7})`);
      values.push(
        seq,
        answer.itemId,
        choice,
        isCorrect,
        typeof answer.latencyMs === "number" && Number.isFinite(answer.latencyMs)
          ? Math.max(0, Math.trunc(answer.latencyMs))
          : null,
        toTimestamp(answer.clientTs ?? now, "clientTs"),
      );
    }
    if (tuples.length > 0) {
      await tx.query(
        `INSERT INTO practice_answers (session_id, seq, item_id, choice, correct, latency_ms, client_ts)
         VALUES ${tuples.join(", ")}`,
        [session.id, ...values],
      );
    }

    const answered = verdicts.length;
    // SERVER-measured elapsed: started_at is our stamp, `now` is our clock.
    const elapsedMs = now - Date.parse(session.startedAt);
    const qualification = qualifiesForStreak({ answered, elapsedMs });
    let completed = session;
    if (qualification.counted) {
      const tzOffset = clampTzOffset(input.tzOffsetMinutes);
      const stamped = await tx.query(
        `UPDATE practice_sessions
            SET completed_at = now(), answered = $2, correct = $3, tz_offset_min = $4
          WHERE id = $1 AND completed_at IS NULL
          RETURNING id, drill, bank_version, item_ids, started_at, completed_at`,
        [session.id, answered, correct, tzOffset],
      );
      if (stamped.rows.length > 0) completed = sessionFromRow(stamped.rows[0]!);
    }
    return { session: completed, answered, correct, verdicts, qualification };
  });
}

/**
 * The participant's practice days, in THEIR local calendar, counted in SQL.
 *
 * The day is `completed_at` (a server stamp) shifted by the offset recorded
 * with that same session, so a person who practises in Seoul and then in
 * London gets each session on the day it was for them — and no client
 * timestamp is anywhere in the derivation.
 */
export async function practiceDays(
  db: Queryable,
  participantId: string,
): Promise<PracticeDayCounts[]> {
  const { rows } = await db.query(
    `SELECT to_char(s.completed_at + make_interval(mins => s.tz_offset_min), 'YYYY-MM-DD') AS day,
            count(*)                       AS sessions,
            coalesce(sum(s.answered), 0)   AS answered,
            coalesce(sum(s.correct), 0)    AS correct
       FROM practice_sessions s
      WHERE s.participant_id = $1 AND s.completed_at IS NOT NULL
      GROUP BY 1
      ORDER BY 1`,
    [participantId],
  );
  return rows.map((r) => ({
    day: String(r.day),
    sessions: Number(r.sessions),
    answered: Number(r.answered),
    correct: Number(r.correct),
  }));
}

/** The offset this participant last practised in — the lens "today" is read through. */
async function latestTzOffset(db: Queryable, participantId: string): Promise<number> {
  const { rows } = await db.query(
    `SELECT tz_offset_min FROM practice_sessions
      WHERE participant_id = $1 AND completed_at IS NOT NULL
      ORDER BY completed_at DESC LIMIT 1`,
    [participantId],
  );
  return clampTzOffset(rows[0]?.tz_offset_min ?? 0);
}

/**
 * This participant's own sittings, as four-number shapes, oldest first.
 *
 * Same projection the world aggregate and the share payload use — the run's
 * OWN scorer output mirrored from its event log. Advisory, and labelled as
 * such on the page; there is no judged score to show.
 */
export async function participantSittings(
  db: Queryable,
  participantId: string,
): Promise<SittingPoint[]> {
  const { rows } = await db.query(
    `SELECT r.attempt_id, r.payload, a.started_at
       FROM responses r JOIN attempts a ON a.id = r.attempt_id
      WHERE a.participant_id = $1 AND r.payload->>'type' = ANY($2)
      ORDER BY r.attempt_id, r.seq`,
    [participantId, ["attempt_started", "track_scored"]],
  );
  const startedOn = new Map<string, string>();
  for (const row of rows) {
    startedOn.set(String(row.attempt_id), new Date(row.started_at as string | Date).toISOString().slice(0, 10));
  }
  const points: SittingPoint[] = [];
  for (const [attemptId, log] of logsByAttempt(rows)) {
    const shape = shapeOf(project(log));
    if (shape !== null) {
      points.push({ attemptId, startedOn: startedOn.get(attemptId) ?? "", scores: shape });
    }
  }
  return points.sort((a, b) => a.startedOn.localeCompare(b.startedOn));
}

/** The whole personal progression view, ready to render. */
export async function participantProgress(
  db: Queryable,
  participantId: string,
  now: number,
): Promise<ProgressReport> {
  const [days, sittings, tzOffset] = await Promise.all([
    practiceDays(db, participantId),
    participantSittings(db, participantId),
    latestTzOffset(db, participantId),
  ]);
  return progressReport({
    days,
    sittings,
    today: localDay(now, tzOffset),
    trackName: (track) => TRACK_META[track].name,
  });
}

// --- handlers ---------------------------------------------------------------

/** POST /api/practice — deal a drill. */
export async function handleStartPractice(ctx: ApiContext, headers: Record<string, string>): Promise<ApiResult> {
  return withParticipant(ctx, headers, async (participantId) => ({
    status: 201,
    body: { session: await startPractice(ctx.db, participantId) },
  }));
}

/** POST /api/practice/:id — submit the whole drill and learn whether it counted. */
export async function handleSubmitPractice(
  ctx: ApiContext,
  headers: Record<string, string>,
  sessionId: string,
  body: unknown,
  now: number = Date.now(),
): Promise<ApiResult> {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  return withParticipant(ctx, headers, async (participantId) => {
    const result = await submitPractice(
      ctx.db,
      participantId,
      sessionId,
      {
        answers: (Array.isArray(b.answers) ? b.answers : []) as PracticeAnswerInput[],
        tzOffsetMinutes: b.tzOffsetMinutes,
      },
      now,
    );
    return {
      status: 200,
      body: {
        result,
        progress: await participantProgress(ctx.db, participantId, now),
      },
    };
  });
}

/** GET the caller's own progression. Authenticated: it is one person's data. */
export async function handleProgress(
  ctx: ApiContext,
  headers: Record<string, string>,
  now: number = Date.now(),
): Promise<ApiResult> {
  return withParticipant(ctx, headers, async (participantId) => ({
    status: 200,
    body: { progress: await participantProgress(ctx.db, participantId, now) },
  }));
}
