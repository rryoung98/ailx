import { beforeAll, describe, expect, it } from "vitest";
import { DEV_USER_HEADER, DevAuthProvider } from "../src/auth.js";
import {
  handleAppendResponse,
  handleAppendTranscript,
  handleCreateAttempt,
  handleFinalizeAttempt,
  handleGetAttempt,
  type ApiContext,
} from "../src/handlers.js";
import type { Queryable } from "../src/db.js";
import { freshDb } from "./helpers.js";

let ctx: ApiContext;
beforeAll(async () => {
  const db: Queryable = await freshDb();
  ctx = { db, auth: new DevAuthProvider() };
});

let n = 0;
const as = (user: string) => ({ [DEV_USER_HEADER]: user });
const fresh = () => as(`handler-user-${n++}`);

const RESPONSE_BODY = {
  seq: 0,
  payload: { type: "attempt_started", ts: 1 },
  clientTs: "2026-01-05T00:00:00.000Z",
};

async function createdAttemptId(headers: Record<string, string>): Promise<string> {
  const res = await handleCreateAttempt(ctx, headers, {});
  expect(res.status).toBe(201);
  return (res.body.attempt as { id: string }).id;
}

describe("authentication", () => {
  it("every endpoint returns 401 without credentials", async () => {
    const anon = {};
    const id = "00000000-0000-4000-8000-000000000000";
    for (const res of [
      await handleCreateAttempt(ctx, anon, {}),
      await handleGetAttempt(ctx, anon, id),
      await handleAppendResponse(ctx, anon, id, RESPONSE_BODY),
      await handleAppendTranscript(ctx, anon, id, {}),
      await handleFinalizeAttempt(ctx, anon, id),
    ]) {
      expect(res.status).toBe(401);
      expect((res.body.error as { code: string }).code).toBe("unauthorized");
    }
  });
});

describe("attempt lifecycle over the API surface", () => {
  it("creates against the default instrument and reads it back", async () => {
    const user = fresh();
    const id = await createdAttemptId(user);
    const read = await handleGetAttempt(ctx, user, id);
    expect(read.status).toBe(200);
    expect(read.body.attempt).toMatchObject({
      id,
      instrumentId: "ailx",
      instrumentVer: "2026.1",
      finalizedAt: null,
      responseCount: 0,
    });
  });

  it("400s on an unknown instrument", async () => {
    const res = await handleCreateAttempt(ctx, fresh(), { instrumentId: "ailx", instrumentVer: "1999.0" });
    expect(res.status).toBe(400);
  });

  it("404s reading another participant\u2019s attempt or a malformed id", async () => {
    const id = await createdAttemptId(fresh());
    expect((await handleGetAttempt(ctx, fresh(), id)).status).toBe(404);
    expect((await handleGetAttempt(ctx, fresh(), "att-nope")).status).toBe(404);
  });

  it("appends: 201 create, 200 identical replay, 409 divergent seq", async () => {
    const user = fresh();
    const id = await createdAttemptId(user);
    expect((await handleAppendResponse(ctx, user, id, RESPONSE_BODY)).status).toBe(201);
    const replay = await handleAppendResponse(ctx, user, id, { ...RESPONSE_BODY });
    expect(replay.status).toBe(200);
    expect((replay.body.response as { created: boolean }).created).toBe(false);
    const conflict = await handleAppendResponse(ctx, user, id, { ...RESPONSE_BODY, payload: { evil: 1 } });
    expect(conflict.status).toBe(409);
    expect((conflict.body.error as { code: string }).code).toBe("seq_conflict");
  });

  it("400s a malformed response body", async () => {
    const user = fresh();
    const id = await createdAttemptId(user);
    expect((await handleAppendResponse(ctx, user, id, { seq: -1, payload: {}, clientTs: 0 })).status).toBe(400);
    expect((await handleAppendResponse(ctx, user, id, "garbage")).status).toBe(400);
  });

  it("transcripts: 201 create, 200 replay, 409 divergence", async () => {
    const user = fresh();
    const id = await createdAttemptId(user);
    const t = { trackId: "t3", seq: 0, verb: "prompted", body: { q: "hi" }, clientTs: 0 };
    expect((await handleAppendTranscript(ctx, user, id, t)).status).toBe(201);
    expect((await handleAppendTranscript(ctx, user, id, t)).status).toBe(200);
    expect((await handleAppendTranscript(ctx, user, id, { ...t, body: { q: "bye" } })).status).toBe(409);
  });

  it("finalize closes the log: replay is 200, later writes are 409 finalized", async () => {
    const user = fresh();
    const id = await createdAttemptId(user);
    expect((await handleAppendResponse(ctx, user, id, RESPONSE_BODY)).status).toBe(201);
    const fin = await handleFinalizeAttempt(ctx, user, id);
    expect(fin.status).toBe(200);
    expect((fin.body.attempt as { alreadyFinalized: boolean }).alreadyFinalized).toBe(false);
    const again = await handleFinalizeAttempt(ctx, user, id);
    expect((again.body.attempt as { alreadyFinalized: boolean }).alreadyFinalized).toBe(true);
    const write = await handleAppendResponse(ctx, user, id, { ...RESPONSE_BODY, seq: 1 });
    expect(write.status).toBe(409);
    expect((write.body.error as { code: string }).code).toBe("finalized");
    const transcript = await handleAppendTranscript(ctx, user, id, {
      trackId: "t3", seq: 9, verb: "prompted", body: { q: "late" }, clientTs: 0,
    });
    expect(transcript.status).toBe(409);
  });

  it("writes against unknown attempts are 404", async () => {
    const user = fresh();
    const ghost = "00000000-0000-4000-8000-00000000dead";
    expect((await handleAppendResponse(ctx, user, ghost, RESPONSE_BODY)).status).toBe(404);
    expect((await handleFinalizeAttempt(ctx, user, ghost)).status).toBe(404);
  });

  it("full session mirror: log entries land as ordered rows, then the log closes", async () => {
    const user = fresh();
    const id = await createdAttemptId(user);
    const entries = [
      { type: "attempt_started", ts: 100 },
      { type: "track_started", trackId: "t1", ts: 200 },
      { type: "track_completed", trackId: "t1", ts: 300 },
      { type: "attempt_completed", ts: 400 },
    ];
    for (const [seq, payload] of entries.entries()) {
      const res = await handleAppendResponse(ctx, user, id, { seq, payload, clientTs: payload.ts });
      expect(res.status).toBe(201);
    }
    expect((await handleFinalizeAttempt(ctx, user, id)).status).toBe(200);
    const read = await handleGetAttempt(ctx, user, id);
    expect(read.body.attempt).toMatchObject({ responseCount: 4 });
    expect((read.body.attempt as { finalizedAt: string | null }).finalizedAt).not.toBeNull();
  });
});

describe("per-attempt deck sampling over the API surface", () => {
  const SHA = "e".repeat(64);
  const sampler = (attemptId: string, locale: string) => [
    { trackId: "t2" as const, bankSha256: SHA, itemIds: [`${locale}:${attemptId}:a`, `${locale}:${attemptId}:b`] },
  ];
  const deckCtx = () => ({ ...ctx, sampleDecks: sampler });

  it("decks:true records + returns the sampled ids, keyed to the new attempt id", async () => {
    const user = fresh();
    const res = await handleCreateAttempt(deckCtx(), user, { decks: true, locale: "ja" });
    expect(res.status).toBe(201);
    const id = (res.body.attempt as { id: string }).id;
    expect(res.body.decks).toEqual(sampler(id, "ja"));
    // GET returns the recorded decks — the audit copy matches.
    const read = await handleGetAttempt(ctx, user, id);
    expect(read.status).toBe(200);
    expect(read.body.decks).toEqual(sampler(id, "ja"));
  });

  it("an invalid locale falls back to en", async () => {
    const res = await handleCreateAttempt(deckCtx(), fresh(), { decks: true, locale: "../evil" });
    const id = (res.body.attempt as { id: string }).id;
    expect(res.body.decks).toEqual(sampler(id, "en"));
  });

  it("without decks:true (lazy mirror create) no exposure rows are recorded", async () => {
    const user = fresh();
    const res = await handleCreateAttempt(deckCtx(), user, {});
    expect(res.status).toBe(201);
    expect(res.body.decks).toBeUndefined();
    const read = await handleGetAttempt(ctx, user, (res.body.attempt as { id: string }).id);
    expect(read.body.decks).toBeUndefined();
  });

  it("decks:true without a configured sampler records nothing (static-content host)", async () => {
    const res = await handleCreateAttempt(ctx, fresh(), { decks: true });
    expect(res.status).toBe(201);
    expect(res.body.decks).toBeUndefined();
  });

  it("a sampler emitting an invalid record 400s and creates no attempt", async () => {
    const user = fresh();
    const badCtx = { ...ctx, sampleDecks: () => [{ trackId: "t2" as const, bankSha256: "nope", itemIds: ["a"] }] };
    const res = await handleCreateAttempt(badCtx, user, { decks: true });
    expect(res.status).toBe(400);
  });
});
