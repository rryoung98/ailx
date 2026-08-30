/**
 * POST /api/attempts/:id/score — the server-issued score.
 *
 * The rule this file defends: a candidate gets numbers, never key material,
 * and never a score computed over a deck they did not sit. The response body
 * is asserted FIELD BY FIELD, because "we only return the score" is exactly
 * the kind of claim that rots when a later handler spreads one more object in.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { openDemoInstrument } from "@ailx/instrument";
import { DEV_USER_HEADER, DevAuthProvider } from "../src/auth.js";
import {
  handleCreateAttempt,
  handleGetItems,
  handleScoreTrack,
  type ApiContext,
} from "../src/handlers.js";
import type { Queryable } from "../src/db.js";
import { freshDb } from "./helpers.js";

let ctx: ApiContext;
let contentless: ApiContext;
const instrument = openDemoInstrument();

beforeAll(async () => {
  // The DEMO tier: its keys are published on purpose, so a leak in this
  // fixture proves nothing — the assertions below are structural.
  const db: Queryable = await freshDb();
  ctx = { db, auth: new DevAuthProvider(), instrument };
  contentless = { db, auth: new DevAuthProvider() };
});

let n = 0;
const as = (user: string) => ({ [DEV_USER_HEADER]: user });
const fresh = () => as(`score-user-${n++}`);

interface Dealt {
  id: string;
  artifact: { responses: { itemId: string; choice: number; confidence: number; latencyMs: number }[] };
}

async function dealtAttempt(headers: Record<string, string>, decks = true): Promise<Dealt> {
  const res = await handleCreateAttempt(ctx, headers, { decks, locale: "en" });
  expect(res.status).toBe(201);
  const id = (res.body.attempt as { id: string }).id;
  const items = (await handleGetItems(ctx, headers, id)).body.items as { id: string }[];
  return {
    id,
    artifact: {
      responses: items.map((it, i) => ({
        itemId: it.id,
        choice: i % 2,
        confidence: 60,
        latencyMs: 900,
      })),
    },
  };
}

describe("handleScoreTrack", () => {
  it("issues the instrument's score over the attempt's RECORDED deck", async () => {
    const user = fresh();
    const { id, artifact } = await dealtAttempt(user);
    const res = await handleScoreTrack(ctx, user, id, { trackId: "t2", artifact });
    expect(res.status).toBe(200);

    // The deck is re-derived, not re-read: `sampleDecks` is pure, so this IS
    // the deck attempt_decks recorded. (@ailx/instrument's own tests prove
    // scoreTrack equals the pure plugin run over that deck's config.)
    const deck = instrument.sampleDecks(id, "en")[0]!;
    const expected = instrument.scoreTrack("t2", deck, artifact, "en");
    expect(res.body.score).toEqual(expected.score);
    expect(res.body.rubricVersion).toBe(instrument.rubricVersion("t2"));
    expect(res.body.scoringDigest).toBe(instrument.scoringDigest("t2"));
    expect(res.body.released).toBe(true);
  });

  it("returns EXACTLY score, rubricVersion, scoringDigest, released", async () => {
    const user = fresh();
    const { id, artifact } = await dealtAttempt(user);
    const res = await handleScoreTrack(ctx, user, id, { trackId: "t2", artifact });
    expect(Object.keys(res.body).sort()).toEqual([
      "released",
      "rubricVersion",
      "score",
      "scoringDigest",
    ]);
    expect(Object.keys(res.body.score as object).sort()).toEqual(["raw", "scaled"]);

    // The wire bytes, which is what a browser actually receives.
    const wire = JSON.stringify(res.body);
    expect(wire).not.toContain('"key"');
    expect(wire).not.toContain('"rationale"');
    expect(wire).not.toContain('"stem"');
    expect(wire).not.toContain('"material"');
    expect(wire).not.toContain('"options"');
    expect(wire).not.toContain('"items"');
    // `raw.provenance` is a SCORE COMPONENT and must stay; the provenance
    // RECORD (how an item was generated) is key material and has no path here
    // because only numbers cross the boundary.
    for (const r of artifact.responses) expect(wire).not.toContain(r.itemId);
  });

  it("scores the RECORDED deck: a client cannot substitute one by naming items", async () => {
    const user = fresh();
    const { id, artifact } = await dealtAttempt(user);
    const mine = await handleScoreTrack(ctx, user, id, { trackId: "t2", artifact });
    // Extra responses for items this attempt was never dealt change nothing:
    // the config comes from attempt_decks, not from the body.
    const padded = {
      responses: [
        ...artifact.responses,
        { itemId: "not-in-my-deck", choice: 0, confidence: 100, latencyMs: 1 },
      ],
    };
    const forged = await handleScoreTrack(ctx, user, id, { trackId: "t2", artifact: padded });
    expect(forged.body.score).toEqual(mine.body.score);
  });

  it("400s an attempt that was dealt no deck", async () => {
    const user = fresh();
    const { artifact } = await dealtAttempt(user);
    const undealt = await handleCreateAttempt(ctx, user, {});
    const id = (undealt.body.attempt as { id: string }).id;
    const res = await handleScoreTrack(ctx, user, id, { trackId: "t2", artifact });
    expect(res.status).toBe(400);
    expect((res.body.error as { message: string }).message).toMatch(/no t2 deck/);
  });

  it("400s an unsupported track id", async () => {
    const user = fresh();
    const { id, artifact } = await dealtAttempt(user);
    for (const trackId of ["t1", "t3", "t4", "nonsense", 7, undefined]) {
      const res = await handleScoreTrack(ctx, user, id, { trackId, artifact });
      expect(res.status, String(trackId)).toBe(400);
    }
  });

  it("400s a malformed artifact", async () => {
    const user = fresh();
    const { id } = await dealtAttempt(user);
    for (const artifact of [undefined, null, 42, {}, { responses: "nope" }]) {
      const res = await handleScoreTrack(ctx, user, id, { trackId: "t2", artifact });
      expect(res.status).toBe(400);
      expect((res.body.error as { code: string }).code).toBe("bad_request");
    }
    expect((await handleScoreTrack(ctx, user, id, undefined)).status).toBe(400);
  });

  it("401s an unauthenticated caller", async () => {
    const { id, artifact } = await dealtAttempt(fresh());
    const res = await handleScoreTrack(ctx, {}, id, { trackId: "t2", artifact });
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain("score");
  });

  it("404s another participant's attempt — an attempt id is not a capability", async () => {
    const { id, artifact } = await dealtAttempt(fresh());
    const res = await handleScoreTrack(ctx, fresh(), id, { trackId: "t2", artifact });
    expect(res.status).toBe(404);
  });

  it("404s an unknown attempt, and any attempt when no instrument is mounted", async () => {
    const user = fresh();
    const { id, artifact } = await dealtAttempt(user);
    const unknown = await handleScoreTrack(ctx, user, "00000000-0000-4000-8000-000000000000", {
      trackId: "t2",
      artifact,
    });
    expect(unknown.status).toBe(404);
    const none = await handleScoreTrack(contentless, user, id, { trackId: "t2", artifact });
    expect(none.status).toBe(404);
    expect((none.body.error as { message: string }).message).toMatch(/instrument/);
  });
});
