/**
 * Framework-agnostic API handlers: plain (context, input) → {status, body}.
 * Next.js route handlers (server mode) are thin adapters over these; tests
 * hit them directly against in-process Postgres. Every handler authenticates
 * via the AuthProvider seam and maps StoreError codes onto HTTP statuses.
 */

import type { TrackId } from "@ailx/session";
import type { Queryable } from "./db.js";
import type { AuthProvider, HeaderMap } from "./auth.js";
import {
  StoreError,
  appendResponse,
  appendTranscript,
  createAttempt,
  ensureParticipant,
  finalizeAttempt,
  getAttempt,
  getDecks,
  type DeckRecord,
  type InstrumentRef,
  type TranscriptVerb,
} from "./store.js";

/** Instrument an attempt is created against when the client names none. */
export const DEFAULT_INSTRUMENT: InstrumentRef = {
  instrumentId: "ailx",
  instrumentVer: "2026.1",
};

export interface ApiContext {
  /** Single DB session for the request (transactions run on it). */
  db: Queryable;
  auth: AuthProvider;
  /**
   * Content-aware deck sampler (the backend stays content-agnostic — the
   * host wires in the instrument snapshot). MUST be a pure, deterministic
   * function of (attemptId, locale) so recorded decks are re-derivable.
   */
  sampleDecks?: (attemptId: string, locale: string) => readonly DeckRecord[];
}

export interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

const STATUS_BY_CODE = {
  bad_request: 400,
  not_found: 404,
  finalized: 409,
  seq_conflict: 409,
} as const;

function errorResult(code: keyof typeof STATUS_BY_CODE | "unauthorized", message: string): ApiResult {
  const status = code === "unauthorized" ? 401 : STATUS_BY_CODE[code];
  return { status, body: { error: { code, message } } };
}

async function withParticipant(
  ctx: ApiContext,
  headers: HeaderMap,
  fn: (participantId: string) => Promise<ApiResult>,
): Promise<ApiResult> {
  const identity = await ctx.auth.verify(headers);
  if (identity === null) return errorResult("unauthorized", "authentication required");
  try {
    const participant = await ensureParticipant(ctx.db, identity.authRef);
    return await fn(participant.id);
  } catch (err) {
    if (err instanceof StoreError) return errorResult(err.code, err.message);
    throw err;
  }
}

function asRecord(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

const LOCALE_RE = /^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/;

/**
 * POST /api/attempts — body: { instrumentId?, instrumentVer?, locale?, decks? }
 *
 * `decks: true` opts in to per-attempt deck sampling: the sampled item ids
 * are recorded (attempt_decks) and returned, and the CALLER COMMITS to
 * presenting exactly that deck (i.e. to keying its item selection on the
 * returned attempt id). Creates without the flag — e.g. the lazy log
 * mirror, whose deck was already keyed to a client-local id — record no
 * exposure rows rather than recording a deck that was never shown.
 */
export async function handleCreateAttempt(
  ctx: ApiContext,
  headers: HeaderMap,
  body: unknown,
): Promise<ApiResult> {
  const b = asRecord(body);
  const ref: InstrumentRef = {
    instrumentId: typeof b.instrumentId === "string" ? b.instrumentId : DEFAULT_INSTRUMENT.instrumentId,
    instrumentVer: typeof b.instrumentVer === "string" ? b.instrumentVer : DEFAULT_INSTRUMENT.instrumentVer,
  };
  const locale = typeof b.locale === "string" && LOCALE_RE.test(b.locale) ? b.locale : "en";
  const sampler =
    b.decks === true && ctx.sampleDecks
      ? (attemptId: string) => ctx.sampleDecks!(attemptId, locale)
      : undefined;
  return withParticipant(ctx, headers, async (participantId) => {
    const attempt = await createAttempt(ctx.db, participantId, ref, sampler);
    // Pure + deterministic by contract, so this re-derivation IS the
    // just-recorded deck (and doubles as a recomputability exercise).
    const decks = sampler?.(attempt.id);
    return { status: 201, body: decks ? { attempt, decks } : { attempt } };
  });
}

/** GET /api/attempts/:id */
export async function handleGetAttempt(
  ctx: ApiContext,
  headers: HeaderMap,
  attemptId: string,
): Promise<ApiResult> {
  return withParticipant(ctx, headers, async (participantId) => {
    const attempt = await getAttempt(ctx.db, attemptId, participantId);
    if (attempt === null) return errorResult("not_found", "attempt not found");
    const decks = await getDecks(ctx.db, attemptId, participantId);
    return { status: 200, body: decks.length > 0 ? { attempt, decks } : { attempt } };
  });
}

/** POST /api/attempts/:id/responses — body: { seq, payload, clientTs, itemId?, latencyMs? } */
export async function handleAppendResponse(
  ctx: ApiContext,
  headers: HeaderMap,
  attemptId: string,
  body: unknown,
): Promise<ApiResult> {
  const b = asRecord(body);
  return withParticipant(ctx, headers, async (participantId) => {
    const result = await appendResponse(ctx.db, attemptId, participantId, {
      seq: b.seq as number,
      payload: b.payload,
      clientTs: b.clientTs as string | number,
      itemId: typeof b.itemId === "string" ? b.itemId : null,
      latencyMs: typeof b.latencyMs === "number" ? b.latencyMs : null,
    });
    return { status: result.created ? 201 : 200, body: { response: result } };
  });
}

/** POST /api/attempts/:id/transcripts — body: { trackId, seq, verb, body, clientTs, revisionOf? } */
export async function handleAppendTranscript(
  ctx: ApiContext,
  headers: HeaderMap,
  attemptId: string,
  body: unknown,
): Promise<ApiResult> {
  const b = asRecord(body);
  return withParticipant(ctx, headers, async (participantId) => {
    const result = await appendTranscript(ctx.db, attemptId, participantId, {
      trackId: b.trackId as TrackId,
      seq: b.seq as number,
      verb: b.verb as TranscriptVerb,
      body: b.body,
      clientTs: b.clientTs as string | number,
      revisionOf: b.revisionOf as string | number | null | undefined,
    });
    return { status: result.created ? 201 : 200, body: { transcript: result } };
  });
}

/** POST /api/attempts/:id/finalize */
export async function handleFinalizeAttempt(
  ctx: ApiContext,
  headers: HeaderMap,
  attemptId: string,
): Promise<ApiResult> {
  return withParticipant(ctx, headers, async (participantId) => {
    const result = await finalizeAttempt(ctx.db, attemptId, participantId);
    return { status: 200, body: { attempt: result } };
  });
}
