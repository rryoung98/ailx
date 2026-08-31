/**
 * Framework-agnostic API handlers: plain (context, input) → {status, body}.
 * Next.js route handlers (server mode) are thin adapters over these; tests
 * hit them directly against in-process Postgres. Every handler authenticates
 * via the AuthProvider seam and maps StoreError codes onto HTTP statuses.
 */

import type { TrackId } from "@ailx/session";
import { UNAUTHORIZED_RESULT, type ApiResult } from "@ailx/contract";
import type { Instrument, RedactedItem } from "@ailx/instrument";
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
  getItemChoices,
  type InstrumentRef,
  type TranscriptVerb,
} from "./store.js";

/**
 * Re-exported so a server call site keeps ONE import. Both are defined in
 * @ailx/contract: the envelope and the frozen 401 body are what an adapter
 * that authenticates BEFORE the handler runs (apps/web `apiRoute` must know
 * the caller before it buffers a body) has to reproduce byte for byte.
 */
export { UNAUTHORIZED_RESULT, type ApiResult };

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
   * The mounted instrument (@ailx/instrument). The backend stays
   * content-agnostic: it holds this INTERFACE, never a bank. It replaces the
   * old `sampleDecks?` callback, which forwarded its arguments and hid
   * nothing — deck sampling, redaction, grading and the audit digests are one
   * responsibility with one owner (docs/ARCHITECTURE.md §3).
   *
   * Optional because the log-mirror routes do not need content at all.
   */
  instrument?: Instrument;
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

/**
 * Auth + participant projection + StoreError mapping — shared with ./t1/.
 *
 * Generic in the SUCCESS type only: every rejection this wrapper can produce
 * is an ApiResult (401, or a mapped StoreError), so a handler that answers
 * with something else — the T1 export answers with ZIP bytes — still gets its
 * failures in the one shape every adapter already knows how to serialize.
 * `T` defaults to ApiResult, so the JSON handlers below are unchanged.
 */
export async function withParticipant<T = ApiResult>(
  ctx: ApiContext,
  headers: HeaderMap,
  fn: (participantId: string) => Promise<T | ApiResult>,
): Promise<T | ApiResult> {
  const identity = await ctx.auth.verify(headers);
  if (identity === null) return UNAUTHORIZED_RESULT;
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
  const instrument = ctx.instrument;
  const sampler =
    b.decks === true && instrument
      ? (attemptId: string) => instrument.sampleDecks(attemptId, locale)
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

/**
 * GET /api/attempts/:id/items — the redacted deck.
 *
 * THE PHASE IS DERIVED, NEVER BELIEVED. It comes from this attempt's own
 * `finalized_at` as the database holds it; there is no query parameter, no
 * header and no body field a candidate could set to unlock the answers early.
 * The client names a wish; the server states a fact.
 *
 * During the sitting the response body has no `key` and no `rationale` — not
 * blanked, absent — because {@link RedactedItem} is a discriminated union and
 * the redaction builds the sitting object from presented fields only.
 */
export async function handleGetItems(
  ctx: ApiContext,
  headers: HeaderMap,
  attemptId: string,
): Promise<ApiResult> {
  return withParticipant(ctx, headers, async (participantId) => {
    const instrument = ctx.instrument;
    if (!instrument) return errorResult("not_found", "no instrument is mounted");
    const attempt = await getAttempt(ctx.db, attemptId, participantId);
    if (attempt === null) return errorResult("not_found", "attempt not found");
    const phase = attempt.finalizedAt === null ? "sitting" : "review";

    const deck = (await getDecks(ctx.db, attemptId, participantId)).find((d) => d.trackId === "t2");
    // An attempt created without `decks: true` was never dealt one. That is
    // an empty deck, not an error, and certainly not "here is the whole bank".
    if (deck === undefined) {
      return { status: 200, body: { phase, deckDigest: null, items: [] as RedactedItem[] } };
    }

    // Own choices only, and only once the sitting is over.
    let answers: Map<string, number> | undefined;
    if (phase === "review") {
      answers = new Map();
      for (const [itemId, payload] of await getItemChoices(ctx.db, attemptId, participantId)) {
        const choice = (payload as { choice?: unknown } | null)?.choice;
        if (typeof choice === "number") answers.set(itemId, choice);
      }
    }
    const items = instrument.itemView(deck, phase, "en", answers);
    return {
      status: 200,
      body: { phase, deckDigest: deck.bankSha256, released: instrument.released, items },
    };
  });
}

/**
 * POST /api/attempts/:id/score — body: { trackId: "t2", artifact }
 *
 * WHY THE SERVER ISSUES THE SCORE: `score()` consumes a config that embeds
 * every answer key, so a browser that could compute its own T2 score would
 * have to hold the keys (docs/ARCHITECTURE.md §4). The client sends the
 * artifact it already appended to the log; the server answers with numbers
 * and the two audit facts — no key, no rationale, no item text.
 *
 * The deck is the one the DATABASE recorded for this attempt. A client-named
 * deck would let a candidate pick an easier config than the one they sat.
 */
export async function handleScoreTrack(
  ctx: ApiContext,
  headers: HeaderMap,
  attemptId: string,
  body: unknown,
): Promise<ApiResult> {
  const b = asRecord(body);
  return withParticipant(ctx, headers, async (participantId) => {
    const instrument = ctx.instrument;
    if (!instrument) return errorResult("not_found", "no instrument is mounted");
    const attempt = await getAttempt(ctx.db, attemptId, participantId);
    if (attempt === null) return errorResult("not_found", "attempt not found");

    const trackId = b.trackId as TrackId;
    const deck = (await getDecks(ctx.db, attemptId, participantId)).find(
      (d) => d.trackId === trackId,
    );
    // An attempt created without `decks: true` was never dealt one, so there
    // is no deck this score could be OF. Scoring it against a default deck
    // would issue a number about items the candidate never saw.
    if (deck === undefined) {
      return errorResult("bad_request", `attempt was dealt no ${String(b.trackId)} deck`);
    }
    try {
      const scored = instrument.scoreTrack(trackId, deck, b.artifact, "en");
      return { status: 200, body: { ...scored, released: instrument.released } };
    } catch (err) {
      // An unsupported track or an artifact the plugin refuses: the caller's
      // input is wrong, not the server's state.
      return errorResult("bad_request", err instanceof Error ? err.message : "cannot score");
    }
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
