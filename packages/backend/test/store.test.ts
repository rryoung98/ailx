import { beforeAll, describe, expect, it } from "vitest";
import {
  StoreError,
  appendResponse,
  appendTranscript,
  createAttempt,
  ensureInstrument,
  ensureParticipant,
  finalizeAttempt,
  getAttempt,
  getDecks,
} from "../src/store.js";
import type { Queryable } from "../src/db.js";
import { TEST_INSTRUMENT, count, freshDb, openAttempt } from "./helpers.js";

let db: Queryable;
beforeAll(async () => {
  db = await freshDb();
});

const ENTRY = { seq: 0, payload: { type: "attempt_started", ts: 1 }, clientTs: "2026-01-05T00:00:00.000Z" };

async function expectStoreError(p: Promise<unknown>, code: string): Promise<void> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(StoreError);
  expect((err as StoreError).code).toBe(code);
}

describe("ensureParticipant", () => {
  it("creates then returns the same row idempotently", async () => {
    const a = await ensureParticipant(db, "dev:alice");
    const b = await ensureParticipant(db, "dev:alice");
    expect(b.id).toBe(a.id);
    expect(b.authRef).toBe("dev:alice");
  });

  it("keeps the first-write locale on replay", async () => {
    const a = await ensureParticipant(db, "dev:locale-keeper", "ja");
    const b = await ensureParticipant(db, "dev:locale-keeper", "ko");
    expect(a.locale).toBe("ja");
    expect(b.locale).toBe("ja");
  });

  it("distinct auth_refs get distinct participants", async () => {
    const a = await ensureParticipant(db, "dev:p1");
    const b = await ensureParticipant(db, "dev:p2");
    expect(a.id).not.toBe(b.id);
  });

  it("rejects an empty authRef", async () => {
    await expectStoreError(ensureParticipant(db, ""), "bad_request");
  });
});

describe("createAttempt / getAttempt", () => {
  it("creates an open attempt against a known instrument", async () => {
    const { attempt, participantId } = await openAttempt(db);
    expect(attempt.finalizedAt).toBeNull();
    expect(attempt.instrumentId).toBe("ailx");
    const read = await getAttempt(db, attempt.id, participantId);
    expect(read).toMatchObject({ id: attempt.id, responseCount: 0, transcriptCount: 0 });
  });

  it("rejects an unknown instrument version", async () => {
    const p = await ensureParticipant(db, "dev:no-instrument");
    await expectStoreError(
      createAttempt(db, p.id, { instrumentId: "ailx", instrumentVer: "1999.0" }),
      "bad_request",
    );
  });

  it("rejects a malformed participant id without touching the db", async () => {
    await expectStoreError(createAttempt(db, "not-a-uuid", TEST_INSTRUMENT), "not_found");
  });

  it("hides attempts owned by another participant", async () => {
    const { attempt } = await openAttempt(db);
    const other = await ensureParticipant(db, "dev:snoop");
    expect(await getAttempt(db, attempt.id, other.id)).toBeNull();
  });

  it("returns null for a malformed attempt id instead of a cast error", async () => {
    const p = await ensureParticipant(db, "dev:malformed-get");
    expect(await getAttempt(db, "att-12345", p.id)).toBeNull();
  });

  it("ensureInstrument is idempotent and never mutates the stored digest", async () => {
    await ensureInstrument(db, { ...TEST_INSTRUMENT, packageDigest: "sha256:EVIL", effectiveFrom: "2027-01-01" });
    const { rows } = await db.query("SELECT package_digest FROM instruments WHERE id = $1 AND version = $2", [
      TEST_INSTRUMENT.instrumentId,
      TEST_INSTRUMENT.instrumentVer,
    ]);
    expect(rows[0]!.package_digest).toBe("sha256:test");
  });
});

describe("appendResponse — append-only + idempotency", () => {
  it("inserts a new row and reports created", async () => {
    const { attempt, participantId } = await openAttempt(db);
    const r = await appendResponse(db, attempt.id, participantId, ENTRY);
    expect(r.created).toBe(true);
    expect(await count(db, "responses", attempt.id)).toBe(1);
  });

  it("acknowledges an identical retry as a replay of the SAME row", async () => {
    const { attempt, participantId } = await openAttempt(db);
    const first = await appendResponse(db, attempt.id, participantId, ENTRY);
    const retry = await appendResponse(db, attempt.id, participantId, { ...ENTRY });
    expect(retry).toEqual({ id: first.id, created: false });
    expect(await count(db, "responses", attempt.id)).toBe(1);
  });

  it("replay matching ignores jsonb key order", async () => {
    const { attempt, participantId } = await openAttempt(db);
    await appendResponse(db, attempt.id, participantId, { ...ENTRY, payload: { a: 1, b: 2 } });
    const retry = await appendResponse(db, attempt.id, participantId, { ...ENTRY, payload: { b: 2, a: 1 } });
    expect(retry.created).toBe(false);
  });

  it("rejects a different payload under an already-used seq — never overwrites", async () => {
    const { attempt, participantId } = await openAttempt(db);
    await appendResponse(db, attempt.id, participantId, ENTRY);
    await expectStoreError(
      appendResponse(db, attempt.id, participantId, { ...ENTRY, payload: { tampered: true } }),
      "seq_conflict",
    );
    const { rows } = await db.query("SELECT payload FROM responses WHERE attempt_id = $1 AND seq = 0", [attempt.id]);
    expect(rows[0]!.payload).toEqual(ENTRY.payload); // original row untouched
  });

  it("a different itemId under the same seq is a conflict too", async () => {
    const { attempt, participantId } = await openAttempt(db);
    await appendResponse(db, attempt.id, participantId, { ...ENTRY, itemId: "item-a" });
    await expectStoreError(
      appendResponse(db, attempt.id, participantId, { ...ENTRY, itemId: "item-b" }),
      "seq_conflict",
    );
  });

  it("allows gaps and out-of-order arrival (retries may land late)", async () => {
    const { attempt, participantId } = await openAttempt(db);
    await appendResponse(db, attempt.id, participantId, { ...ENTRY, seq: 5 });
    await appendResponse(db, attempt.id, participantId, { ...ENTRY, seq: 3 });
    expect(await count(db, "responses", attempt.id)).toBe(2);
  });

  it("same seq on a DIFFERENT attempt is independent", async () => {
    const a = await openAttempt(db);
    const b = await openAttempt(db);
    await appendResponse(db, a.attempt.id, a.participantId, ENTRY);
    const r = await appendResponse(db, b.attempt.id, b.participantId, ENTRY);
    expect(r.created).toBe(true);
  });

  it("rejects writes to an unknown attempt", async () => {
    const p = await ensureParticipant(db, "dev:orphan-writer");
    await expectStoreError(
      appendResponse(db, "00000000-0000-4000-8000-000000000000", p.id, ENTRY),
      "not_found",
    );
  });

  it("rejects writes to someone else\u2019s attempt as not_found (no existence leak)", async () => {
    const { attempt } = await openAttempt(db);
    const other = await ensureParticipant(db, "dev:cross-writer");
    await expectStoreError(appendResponse(db, attempt.id, other.id, ENTRY), "not_found");
  });

  it("rejects writes to a finalized attempt", async () => {
    const { attempt, participantId } = await openAttempt(db);
    await finalizeAttempt(db, attempt.id, participantId);
    await expectStoreError(appendResponse(db, attempt.id, participantId, ENTRY), "finalized");
  });

  it.each([
    ["negative", -1],
    ["fractional", 1.5],
    ["overflow", 2 ** 31],
    ["NaN", Number.NaN],
  ])("rejects a %s seq", async (_label, seq) => {
    const { attempt, participantId } = await openAttempt(db);
    await expectStoreError(appendResponse(db, attempt.id, participantId, { ...ENTRY, seq }), "bad_request");
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["string", "nope"],
    ["number", 7],
  ])("rejects a %s payload", async (_label, payload) => {
    const { attempt, participantId } = await openAttempt(db);
    await expectStoreError(
      appendResponse(db, attempt.id, participantId, { ...ENTRY, payload }),
      "bad_request",
    );
  });

  it("rejects an unparseable clientTs and accepts epoch milliseconds", async () => {
    const { attempt, participantId } = await openAttempt(db);
    await expectStoreError(
      appendResponse(db, attempt.id, participantId, { ...ENTRY, clientTs: "not-a-date" }),
      "bad_request",
    );
    const ok = await appendResponse(db, attempt.id, participantId, { ...ENTRY, clientTs: 1767571200000 });
    expect(ok.created).toBe(true);
  });

  it("stores itemId and latencyMs when provided", async () => {
    const { attempt, participantId } = await openAttempt(db);
    await appendResponse(db, attempt.id, participantId, { ...ENTRY, itemId: "sha256:item", latencyMs: 420 });
    const { rows } = await db.query(
      "SELECT item_id, latency_ms FROM responses WHERE attempt_id = $1 AND seq = 0",
      [attempt.id],
    );
    expect(rows[0]).toMatchObject({ item_id: "sha256:item", latency_ms: 420 });
  });
});

describe("appendTranscript — append-only + idempotency", () => {
  const T = {
    trackId: "t3",
    seq: 0,
    verb: "prompted",
    body: { text: "hello" },
    clientTs: "2026-01-05T00:00:00.000Z",
  } as const;

  it("inserts, then treats an identical retry as a replay", async () => {
    const { attempt, participantId } = await openAttempt(db);
    const first = await appendTranscript(db, attempt.id, participantId, { ...T });
    const retry = await appendTranscript(db, attempt.id, participantId, { ...T });
    expect(first.created).toBe(true);
    expect(retry).toEqual({ id: first.id, created: false });
    expect(await count(db, "transcripts", attempt.id)).toBe(1);
  });

  it("rejects a different body under an already-used (track, seq)", async () => {
    const { attempt, participantId } = await openAttempt(db);
    await appendTranscript(db, attempt.id, participantId, { ...T });
    await expectStoreError(
      appendTranscript(db, attempt.id, participantId, { ...T, body: { text: "rewritten" } }),
      "seq_conflict",
    );
  });

  it("a different verb under the same (track, seq) is a conflict", async () => {
    const { attempt, participantId } = await openAttempt(db);
    await appendTranscript(db, attempt.id, participantId, { ...T });
    await expectStoreError(
      appendTranscript(db, attempt.id, participantId, { ...T, verb: "revised" }),
      "seq_conflict",
    );
  });

  it("the same seq on a different track is independent", async () => {
    const { attempt, participantId } = await openAttempt(db);
    await appendTranscript(db, attempt.id, participantId, { ...T });
    const r = await appendTranscript(db, attempt.id, participantId, { ...T, trackId: "t1" });
    expect(r.created).toBe(true);
  });

  it("chains revisions within the same attempt", async () => {
    const { attempt, participantId } = await openAttempt(db);
    const first = await appendTranscript(db, attempt.id, participantId, { ...T });
    const second = await appendTranscript(db, attempt.id, participantId, {
      ...T,
      seq: 1,
      verb: "revised",
      revisionOf: first.id,
    });
    expect(second.created).toBe(true);
  });

  it("rejects revisionOf pointing at another attempt\u2019s transcript", async () => {
    const a = await openAttempt(db);
    const foreign = await appendTranscript(db, a.attempt.id, a.participantId, { ...T });
    const b = await openAttempt(db);
    await expectStoreError(
      appendTranscript(db, b.attempt.id, b.participantId, { ...T, revisionOf: foreign.id }),
      "bad_request",
    );
  });

  it("rejects a non-numeric revisionOf", async () => {
    const { attempt, participantId } = await openAttempt(db);
    await expectStoreError(
      appendTranscript(db, attempt.id, participantId, { ...T, revisionOf: "abc" }),
      "bad_request",
    );
  });

  it.each([
    ["verb", { verb: "deleted" }],
    ["trackId", { trackId: "t9" }],
    ["body", { body: null }],
  ])("rejects an invalid %s", async (_label, patch) => {
    const { attempt, participantId } = await openAttempt(db);
    await expectStoreError(
      appendTranscript(db, attempt.id, participantId, { ...T, ...(patch as object) }),
      "bad_request",
    );
  });

  it("rejects writes to a finalized attempt", async () => {
    const { attempt, participantId } = await openAttempt(db);
    await finalizeAttempt(db, attempt.id, participantId);
    await expectStoreError(appendTranscript(db, attempt.id, participantId, { ...T }), "finalized");
  });
});

describe("finalizeAttempt", () => {
  it("closes the attempt exactly once — replay returns the ORIGINAL timestamp", async () => {
    const { attempt, participantId } = await openAttempt(db);
    const first = await finalizeAttempt(db, attempt.id, participantId);
    expect(first.alreadyFinalized).toBe(false);
    const replay = await finalizeAttempt(db, attempt.id, participantId);
    expect(replay).toEqual({ finalizedAt: first.finalizedAt, alreadyFinalized: true });
  });

  it("is scoped to the owner", async () => {
    const { attempt } = await openAttempt(db);
    const other = await ensureParticipant(db, "dev:finalizer");
    await expectStoreError(finalizeAttempt(db, attempt.id, other.id), "not_found");
  });

  it("rejects an unknown attempt", async () => {
    const p = await ensureParticipant(db, "dev:finalize-missing");
    await expectStoreError(
      finalizeAttempt(db, "00000000-0000-4000-8000-000000000001", p.id),
      "not_found",
    );
  });
});

describe("attempt decks (exposure log)", () => {
  const SHA = "f".repeat(64);
  const deckFor = (attemptId: string) => [
    { trackId: "t2" as const, bankSha256: SHA, itemIds: [`${attemptId}:i1`, `${attemptId}:i2`] },
  ];

  it("records sampled decks atomically at creation and reads them back", async () => {
    const p = await ensureParticipant(db, "dev:deck-owner");
    const attempt = await createAttempt(db, p.id, TEST_INSTRUMENT, deckFor);
    const decks = await getDecks(db, attempt.id, p.id);
    expect(decks).toEqual([
      { trackId: "t2", bankSha256: SHA, itemIds: [`${attempt.id}:i1`, `${attempt.id}:i2`] },
    ]);
  });

  it("no sampler → no deck rows (legacy/mirror creates)", async () => {
    const { attempt, participantId } = await openAttempt(db);
    expect(await getDecks(db, attempt.id, participantId)).toEqual([]);
  });

  it("deck rows are ownership-scoped like every attempt read", async () => {
    const p = await ensureParticipant(db, "dev:deck-owner-2");
    const stranger = await ensureParticipant(db, "dev:deck-stranger");
    const attempt = await createAttempt(db, p.id, TEST_INSTRUMENT, deckFor);
    expect(await getDecks(db, attempt.id, stranger.id)).toEqual([]);
    expect(await getDecks(db, "not-a-uuid", p.id)).toEqual([]);
  });

  it("an invalid deck record rolls back the whole attempt", async () => {
    const p = await ensureParticipant(db, "dev:deck-rollback");
    const bad = [
      [{ trackId: "t9", bankSha256: SHA, itemIds: ["a"] }],          // unknown track
      [{ trackId: "t2", bankSha256: "beef", itemIds: ["a"] }],       // not a sha256
      [{ trackId: "t2", bankSha256: SHA, itemIds: [] }],             // empty
      [{ trackId: "t2", bankSha256: SHA, itemIds: ["a", "a"] }],     // duplicates
      [{ trackId: "t2", bankSha256: SHA, itemIds: ["a", ""] }],      // empty id
    ];
    for (const decks of bad) {
      await expectStoreError(
        createAttempt(db, p.id, TEST_INSTRUMENT, () => decks as never),
        "bad_request",
      );
    }
    const { rows } = await (db as Queryable).query(
      "SELECT count(*) AS n FROM attempts WHERE participant_id = $1",
      [p.id],
    );
    expect(Number(rows[0]!.n)).toBe(0); // nothing half-created
  });

  it("two decks for the same track are rejected by the DB uniqueness", async () => {
    const p = await ensureParticipant(db, "dev:deck-unique");
    await expect(
      createAttempt(db, p.id, TEST_INSTRUMENT, () => [
        { trackId: "t2", bankSha256: SHA, itemIds: ["a"] },
        { trackId: "t2", bankSha256: SHA, itemIds: ["b"] },
      ]),
    ).rejects.toThrow();
  });
});
