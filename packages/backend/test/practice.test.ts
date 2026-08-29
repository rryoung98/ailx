/**
 * Practice, streaks and progression against the REAL schema in in-process
 * Postgres. The properties under test are the ones a client must not be able
 * to talk its way past:
 *
 *  - a streak day is EARNED server-side (whole deck, and not instantly);
 *  - a client cannot assert a streak, a grade, or an item it was not dealt;
 *  - a day is the participant's own local day, across timezone boundaries;
 *  - progression is derived from stored rows and says what it is not.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEV_USER_HEADER, DevAuthProvider } from "../src/auth.js";
import type { ApiContext } from "../src/handlers.js";
import type { Queryable } from "../src/db.js";
import {
  MAX_PRACTICE_ANSWERS,
  PRACTICE_DRILL,
  handleProgress,
  handleStartPractice,
  handleSubmitPractice,
  participantProgress,
  participantSittings,
  practiceDays,
  startPractice,
  submitPractice,
  type PracticeAnswerInput,
} from "../src/practice.js";
import { StoreError } from "../src/store.js";
import {
  PRACTICE_BANK,
  PRACTICE_BANK_VERSION,
  PRACTICE_DECK_SIZE,
  PRACTICE_MIN_ELAPSED_MS,
  practiceItem,
  type ProgressReport,
} from "@ailx/report";
import { freshDb, mirrorScoredRun, openAttempt, scoredAttempt } from "./helpers.js";
import { ensureParticipant } from "../src/store.js";

let db: Queryable;
let ctx: ApiContext;

beforeEach(async () => {
  db = await freshDb();
  ctx = { db, auth: new DevAuthProvider() };
});

const SLOW = PRACTICE_MIN_ELAPSED_MS + 1_000;

/** Correct answers for a dealt deck, one per card. */
function answersFor(itemIds: readonly string[], correct = true): PracticeAnswerInput[] {
  return itemIds.map((itemId, seq) => {
    const item = practiceItem(itemId)!;
    return {
      seq,
      itemId,
      choice: correct ? item.key : 1 - item.key,
      latencyMs: 4_000,
      clientTs: "2026-03-10T09:00:00.000Z",
    };
  });
}

/** One complete, qualifying practice session at a chosen server instant. */
async function practise(
  participantId: string,
  at: number,
  opts: { correct?: boolean; tzOffsetMinutes?: number } = {},
): Promise<void> {
  const session = await startPractice(db, participantId);
  // The row's own started_at is the server's; move it back so `at` is a
  // realistic submit time rather than an instant one.
  await db.query("UPDATE practice_sessions SET started_at = to_timestamp($2 / 1000.0) WHERE id = $1", [
    session.id,
    at - SLOW,
  ]);
  const result = await submitPractice(
    db,
    participantId,
    session.id,
    { answers: answersFor(session.itemIds, opts.correct ?? true), tzOffsetMinutes: opts.tzOffsetMinutes ?? 0 },
    at,
  );
  expect(result.qualification.counted).toBe(true);
  // completed_at is now() in PGlite; pin it to `at` so day maths is testable.
  await db.query("UPDATE practice_sessions SET completed_at = to_timestamp($2 / 1000.0) WHERE id = $1", [
    session.id,
    at,
  ]);
}

async function participant(name: string): Promise<string> {
  return (await ensureParticipant(db, `dev:${name}`)).id;
}

// ---------------------------------------------------------------------------

describe("dealing a drill", () => {
  it("records the deck, the drill and the corpus version", async () => {
    const p = await participant("dealer");
    const session = await startPractice(db, p);
    expect(session.drill).toBe(PRACTICE_DRILL);
    expect(session.bankVersion).toBe(PRACTICE_BANK_VERSION);
    expect(session.itemIds).toHaveLength(PRACTICE_DECK_SIZE);
    expect(session.completedAt).toBeNull();
  });

  it("only ever deals practice items — never a scored bank id", async () => {
    const p = await participant("separation");
    const practiceIds = new Set(PRACTICE_BANK.map((i) => i.id));
    for (let n = 0; n < 20; n++) {
      const session = await startPractice(db, p);
      for (const id of session.itemIds) {
        expect(practiceIds.has(id)).toBe(true);
        expect(id.startsWith("practice:")).toBe(true);
      }
    }
    // ...and nothing practice ever wrote touched a scored table.
    const { rows } = await db.query(
      "SELECT (SELECT count(*) FROM attempts) a, (SELECT count(*) FROM responses) r, (SELECT count(*) FROM attempt_decks) d",
    );
    expect([Number(rows[0]!.a), Number(rows[0]!.r), Number(rows[0]!.d)]).toEqual([0, 0, 0]);
  });

  it("deals a different deck per session", async () => {
    const p = await participant("variety");
    const decks = new Set<string>();
    for (let n = 0; n < 12; n++) decks.add((await startPractice(db, p)).itemIds.join());
    expect(decks.size).toBeGreaterThan(1);
  });
});

describe("grading is the server's, never the client's", () => {
  it("stores its own verdict and ignores anything the client says about it", async () => {
    const p = await participant("grader");
    const session = await startPractice(db, p);
    const answers = answersFor(session.itemIds, false).map((a) => ({
      ...a,
      // Hostile extras: a client-asserted grade and a client-asserted streak.
      correct: true,
      streak: 999,
    })) as PracticeAnswerInput[];
    const result = await submitPractice(db, p, session.id, { answers }, Date.now());
    expect(result.correct).toBe(0);
    expect(result.verdicts.every((v) => v.correct === false)).toBe(true);
    const { rows } = await db.query("SELECT correct FROM practice_answers WHERE session_id = $1", [session.id]);
    expect(rows.every((r) => r.correct === false)).toBe(true);
  });

  it("grades a fully correct deck as such", async () => {
    const p = await participant("perfect");
    const session = await startPractice(db, p);
    const result = await submitPractice(
      db, p, session.id,
      { answers: answersFor(session.itemIds) },
      Date.parse(session.startedAt) + SLOW,
    );
    expect(result.correct).toBe(PRACTICE_DECK_SIZE);
    expect(result.answered).toBe(PRACTICE_DECK_SIZE);
  });
});

describe("a streak day must be earned", () => {
  const submit = async (
    p: string,
    build: (ids: string[]) => PracticeAnswerInput[],
    elapsedMs: number,
  ) => {
    const session = await startPractice(db, p);
    return submitPractice(
      db, p, session.id,
      { answers: build(session.itemIds) },
      Date.parse(session.startedAt) + elapsedMs,
    );
  };

  it("refuses an abandoned session and leaves it uncompleted", async () => {
    const p = await participant("abandoner");
    const r = await submit(p, (ids) => answersFor(ids).slice(0, 2), SLOW);
    expect(r.qualification).toEqual({ counted: false, reason: "incomplete" });
    expect(r.session.completedAt).toBeNull();
    expect(await practiceDays(db, p)).toEqual([]);
  });

  it("refuses an empty submit", async () => {
    const p = await participant("empty");
    const r = await submit(p, () => [], SLOW);
    expect(r.qualification.reason).toBe("incomplete");
    expect(await practiceDays(db, p)).toEqual([]);
  });

  it("refuses an instant machine submit however honest its timestamps look", async () => {
    const p = await participant("speedrunner");
    const r = await submit(
      p,
      (ids) => answersFor(ids).map((a) => ({ ...a, latencyMs: 30_000, clientTs: "2026-03-10T09:00:00.000Z" })),
      50,
    );
    expect(r.qualification).toEqual({ counted: false, reason: "too_fast" });
    expect(await practiceDays(db, p)).toEqual([]);
  });

  it("counts a complete, unhurried session exactly once", async () => {
    const p = await participant("honest");
    const r = await submit(p, answersFor, SLOW);
    expect(r.qualification.counted).toBe(true);
    expect(r.session.completedAt).not.toBeNull();
    const days = await practiceDays(db, p);
    expect(days).toHaveLength(1);
    expect(days[0].sessions).toBe(1);
    expect(days[0].answered).toBe(PRACTICE_DECK_SIZE);
  });

  it("refuses to complete the same session twice", async () => {
    const p = await participant("replayer");
    const session = await startPractice(db, p);
    const at = Date.parse(session.startedAt) + SLOW;
    await submitPractice(db, p, session.id, { answers: answersFor(session.itemIds) }, at);
    await expect(
      submitPractice(db, p, session.id, { answers: answersFor(session.itemIds) }, at),
    ).rejects.toMatchObject({ code: "finalized" });
    expect((await practiceDays(db, p))[0].sessions).toBe(1);
  });

  it("two sessions on one local day are one streak day", async () => {
    const p = await participant("keen");
    const t = Date.parse("2026-03-10T09:00:00Z");
    await practise(p, t);
    await practise(p, t + 3 * 3_600_000);
    const days = await practiceDays(db, p);
    expect(days).toHaveLength(1);
    expect(days[0].sessions).toBe(2);
    expect(days[0].answered).toBe(PRACTICE_DECK_SIZE * 2);
  });
});

describe("a session belongs to exactly one person", () => {
  it("reads another participant's session as not found (no existence leak)", async () => {
    const mine = await participant("owner");
    const theirs = await participant("intruder");
    const session = await startPractice(db, mine);
    await expect(
      submitPractice(db, theirs, session.id, { answers: answersFor(session.itemIds) }, Date.now()),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("treats a non-uuid session id as not found rather than a cast error", async () => {
    const p = await participant("garbage");
    await expect(
      submitPractice(db, p, "'; DROP TABLE practice_answers; --", { answers: [] }, Date.now()),
    ).rejects.toBeInstanceOf(StoreError);
  });
});

describe("a client cannot answer its way through the corpus", () => {
  it("refuses an item this session was not dealt", async () => {
    const p = await participant("prober");
    const session = await startPractice(db, p);
    const undealt = PRACTICE_BANK.find((i) => !session.itemIds.includes(i.id))!;
    await expect(
      submitPractice(
        db, p, session.id,
        { answers: [{ seq: 0, itemId: undealt.id, choice: 0, clientTs: Date.now() }] },
        Date.now(),
      ),
    ).rejects.toMatchObject({ code: "bad_request" });
  });

  it("refuses an unknown item id, a duplicate seq, an out-of-range seq and a flood", async () => {
    const p = await participant("fuzzer");
    const session = await startPractice(db, p);
    const good = answersFor(session.itemIds);
    const cases: PracticeAnswerInput[][] = [
      [{ seq: 0, itemId: "not-an-item", choice: 0, clientTs: 1 }],
      [good[0], { ...good[1], seq: 0 }],
      [{ ...good[0], seq: -1 }],
      [{ ...good[0], seq: MAX_PRACTICE_ANSWERS }],
      [{ ...good[0], seq: 1.5 }],
      [{ ...good[0], choice: "0" as unknown as number }],
      [...good, ...good],
    ];
    for (const answers of cases) {
      await expect(
        submitPractice(db, p, session.id, { answers }, Date.now()),
      ).rejects.toMatchObject({ code: "bad_request" });
    }
  });

  it("records nothing at all when a submit is refused mid-flight, and the honest retry still works", async () => {
    const p = await participant("atomic");
    const session = await startPractice(db, p);
    const good = answersFor(session.itemIds);
    await expect(
      submitPractice(
        db, p, session.id,
        { answers: [good[0], { seq: 1, itemId: "not-an-item", choice: 0, clientTs: 1 }] },
        Date.now(),
      ),
    ).rejects.toMatchObject({ code: "bad_request" });
    const { rows } = await db.query("SELECT count(*) n FROM practice_answers WHERE session_id = $1", [session.id]);
    expect(Number(rows[0]!.n)).toBe(0);
    expect(await practiceDays(db, p)).toEqual([]);
    // Every seq is still free, so the retry is not poisoned by the refusal.
    const retry = await submitPractice(
      db, p, session.id, { answers: good }, Date.parse(session.startedAt) + SLOW,
    );
    expect(retry.qualification.counted).toBe(true);
  });
});

describe("days are the participant's own, across timezone boundaries", () => {
  it("puts a late-evening Seoul session on the Seoul day, not the UTC one", async () => {
    const p = await participant("seoul");
    await practise(p, Date.parse("2026-03-10T22:30:00Z"), { tzOffsetMinutes: 540 });
    expect((await practiceDays(db, p))[0].day).toBe("2026-03-11");
  });

  it("puts the same instant on the previous day for a Los Angeles participant", async () => {
    const p = await participant("la");
    await practise(p, Date.parse("2026-03-11T01:30:00Z"), { tzOffsetMinutes: -480 });
    expect((await practiceDays(db, p))[0].day).toBe("2026-03-10");
  });

  it("clamps an absurd offset instead of letting it invent a day", async () => {
    const p = await participant("liar");
    await practise(p, Date.parse("2026-03-10T12:00:00Z"), { tzOffsetMinutes: 10_000_000 });
    const { rows } = await db.query("SELECT tz_offset_min FROM practice_sessions WHERE participant_id = $1", [p]);
    expect(Number(rows[0]!.tz_offset_min)).toBe(14 * 60);
  });

  it("keeps a streak alive for a traveller who crosses a boundary", async () => {
    const p = await participant("traveller");
    await practise(p, Date.parse("2026-03-09T23:00:00Z"), { tzOffsetMinutes: 540 }); // 03-10 KST
    await practise(p, Date.parse("2026-03-10T20:00:00Z"), { tzOffsetMinutes: -480 }); // 03-10 PST
    await practise(p, Date.parse("2026-03-11T18:00:00Z"), { tzOffsetMinutes: -480 }); // 03-11 PST
    const progress = await participantProgress(db, p, Date.parse("2026-03-11T20:00:00Z"));
    expect(progress.practice.map((d) => d.day)).toEqual(["2026-03-10", "2026-03-11"]);
    expect(progress.streak.current).toBe(2);
  });
});

describe("progression is derived, honest, and per person", () => {
  it("reports a streak recomputed from stored rows", async () => {
    const p = await participant("streaker");
    const base = Date.parse("2026-03-08T12:00:00Z");
    for (let d = 0; d < 3; d++) await practise(p, base + d * 86_400_000);
    const progress = await participantProgress(db, p, base + 2 * 86_400_000 + 3_600_000);
    expect(progress.streak.current).toBe(3);
    expect(progress.streak.best).toBe(3);
    expect(progress.streak.practisedToday).toBe(true);
    expect(progress.basis).toMatch(/No percentile, no composite/);
  });

  it("never shows one participant another's practice or sittings", async () => {
    const mine = await participant("me");
    const theirs = await participant("them");
    await practise(mine, Date.parse("2026-03-10T12:00:00Z"));
    await practise(theirs, Date.parse("2026-03-10T12:00:00Z"));
    await practise(theirs, Date.parse("2026-03-11T12:00:00Z"));
    const { attemptId } = await scoredAttempt(db);
    expect(attemptId).toBeTruthy();
    const progress = await participantProgress(db, mine, Date.parse("2026-03-10T13:00:00Z"));
    expect(progress.streak.totalDays).toBe(1);
    expect(progress.sittings).toEqual([]);
  });

  it("returns this participant's own sittings, oldest first, only when complete", async () => {
    const p = await participant("sitter");
    const first = await openAttempt(db);
    // Re-key both attempts onto one participant so they are one person's history.
    await db.query("UPDATE attempts SET participant_id = $1", [p]);
    await mirrorScoredRun(db, first.attempt.id, p, [40, 40, 40, 40]);
    const second = await openAttempt(db);
    await db.query("UPDATE attempts SET participant_id = $1 WHERE id = $2", [p, second.attempt.id]);
    await db.query("UPDATE attempts SET started_at = started_at + interval '30 days' WHERE id = $1", [
      second.attempt.id,
    ]);
    await mirrorScoredRun(db, second.attempt.id, p, [60, 60, 60, 60]);
    const sittings = await participantSittings(db, p);
    expect(sittings).toHaveLength(2);
    expect(sittings[0].scores.t1).toBe(40);
    expect(sittings[1].scores.t1).toBe(60);
    const progress = await participantProgress(db, p, Date.parse("2026-06-01T00:00:00Z"));
    expect(progress.improvements.every((i) => i.delta === 20)).toBe(true);
  });

  it("says 'not enough yet' rather than inventing a figure", async () => {
    const p = await participant("newcomer");
    const progress = await participantProgress(db, p, Date.now());
    expect(progress.notEnoughYet).toEqual({ practice: true, sittings: true });
    expect(progress.practiceAccuracy).toBeNull();
    expect(progress.improvements).toEqual([]);
    expect(progress.streak.current).toBe(0);
  });
});

describe("handlers", () => {
  const as = (user: string) => ({ [DEV_USER_HEADER]: user });

  it("refuse an unauthenticated caller on every practice surface", async () => {
    for (const result of [
      await handleStartPractice(ctx, {}),
      await handleSubmitPractice(ctx, {}, "x", {}),
      await handleProgress(ctx, {}),
    ]) {
      expect(result.status).toBe(401);
    }
  });

  it("deal, submit and report progress in one round trip", async () => {
    const started = await handleStartPractice(ctx, as("player"));
    expect(started.status).toBe(201);
    const session = (started.body as { session: { id: string; itemIds: string[]; startedAt: string } }).session;
    const submitted = await handleSubmitPractice(
      ctx,
      as("player"),
      session.id,
      { answers: answersFor(session.itemIds), tzOffsetMinutes: 60 },
      Date.parse(session.startedAt) + SLOW,
    );
    expect(submitted.status).toBe(200);
    const body = submitted.body as { result: { correct: number }; progress: ProgressReport };
    expect(body.result.correct).toBe(PRACTICE_DECK_SIZE);
    expect(body.progress.streak.current).toBe(1);
  });

  it("map a refused submit onto a status rather than a crash", async () => {
    const started = await handleStartPractice(ctx, as("clumsy"));
    const session = (started.body as { session: { id: string } }).session;
    expect((await handleSubmitPractice(ctx, as("clumsy"), session.id, { answers: [{ seq: 0 }] })).status).toBe(400);
    expect((await handleSubmitPractice(ctx, as("clumsy"), "nope", {})).status).toBe(404);
    expect((await handleSubmitPractice(ctx, as("other"), session.id, {})).status).toBe(404);
  });

  it("report an empty progression for a caller who has done nothing", async () => {
    const result = await handleProgress(ctx, as("lurker"));
    expect(result.status).toBe(200);
    expect((result.body as { progress: ProgressReport }).progress.streak.best).toBe(0);
  });
});
