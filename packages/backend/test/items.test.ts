/**
 * GET /api/attempts/:id/items — the redacted-delivery contract.
 *
 * The one rule worth a whole test file: the PHASE IS DERIVED FROM
 * `attempts.finalized_at`, on the server, and there is no request field that
 * can move it. Everything else here exists to prove that the rule has no
 * bypass — not another participant's attempt, not an undealt deck, not a
 * hand-written client that asks nicely.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { openDemoInstrument, type RedactedItem } from "@ailx/instrument";
import { DEV_USER_HEADER, DevAuthProvider } from "../src/auth.js";
import {
  handleAppendResponse,
  handleCreateAttempt,
  handleFinalizeAttempt,
  handleGetItems,
  type ApiContext,
} from "../src/handlers.js";
import type { Queryable } from "../src/db.js";
import { freshDb } from "./helpers.js";

let ctx: ApiContext;
let contentless: ApiContext;
beforeAll(async () => {
  const db: Queryable = await freshDb();
  // The DEMO tier: its keys are published on purpose, so a leak in THIS
  // fixture proves nothing. The redaction is structural, so the tier the test
  // runs on does not change what it proves — and the operational bank stays
  // out of a test snapshot that could end up in a CI artefact.
  ctx = { db, auth: new DevAuthProvider(), instrument: openDemoInstrument() };
  contentless = { db, auth: new DevAuthProvider() };
});

let n = 0;
const as = (user: string) => ({ [DEV_USER_HEADER]: user });
const fresh = () => as(`items-user-${n++}`);

async function dealtAttempt(headers: Record<string, string>): Promise<string> {
  const res = await handleCreateAttempt(ctx, headers, { decks: true, locale: "en" });
  expect(res.status).toBe(201);
  expect((res.body.decks as unknown[]).length).toBe(1);
  return (res.body.attempt as { id: string }).id;
}

const itemsOf = (body: Record<string, unknown>) => body.items as RedactedItem[];

describe("phase derivation", () => {
  it("an OPEN attempt is served the sitting phase, with no key and no rationale", async () => {
    const user = fresh();
    const id = await dealtAttempt(user);
    const res = await handleGetItems(ctx, user, id);
    expect(res.status).toBe(200);
    expect(res.body.phase).toBe("sitting");
    expect(itemsOf(res.body).length).toBeGreaterThan(0);
    const wire = JSON.stringify(res.body);
    expect(wire).not.toContain('"key"');
    expect(wire).not.toContain('"rationale"');
    // The provenance BLOCK is a legitimate item type; the provenance RECORD
    // (how an item was generated, and by which model) is key material.
    expect(wire).not.toContain('"provenance":');
    for (const item of itemsOf(res.body)) expect(item.phase).toBe("sitting");
  });

  it("finalizing — and ONLY finalizing — unlocks the answers", async () => {
    const user = fresh();
    const id = await dealtAttempt(user);
    expect((await handleGetItems(ctx, user, id)).body.phase).toBe("sitting");
    expect((await handleFinalizeAttempt(ctx, user, id)).status).toBe(200);
    const res = await handleGetItems(ctx, user, id);
    expect(res.body.phase).toBe("review");
    for (const item of itemsOf(res.body)) {
      expect(item.phase).toBe("review");
      if (item.phase !== "review") throw new Error("unreachable");
      expect(typeof item.key).toBe("number");
      expect(item.rationale.length).toBeGreaterThan(0);
    }
  });

  it("the handler takes no phase argument at all — there is nothing to forge", () => {
    // (ctx, headers, attemptId). A fourth parameter is the bug this asserts against.
    expect(handleGetItems.length).toBe(3);
  });
});

describe("ownership and shape", () => {
  it("another participant's attempt is a 404, not someone else's deck", async () => {
    const id = await dealtAttempt(fresh());
    expect((await handleGetItems(ctx, fresh(), id)).status).toBe(404);
  });

  it("an unauthenticated caller gets 401 before any content is touched", async () => {
    const id = await dealtAttempt(fresh());
    expect((await handleGetItems(ctx, {}, id)).status).toBe(401);
  });

  it("a missing or non-uuid attempt is a 404", async () => {
    for (const id of ["00000000-0000-4000-8000-000000000000", "att-nope"]) {
      expect((await handleGetItems(ctx, fresh(), id)).status, id).toBe(404);
    }
  });

  it("an attempt created WITHOUT decks gets an empty list, never the whole bank", async () => {
    const user = fresh();
    const res = await handleCreateAttempt(ctx, user, {});
    const id = (res.body.attempt as { id: string }).id;
    const items = await handleGetItems(ctx, user, id);
    expect(items.status).toBe(200);
    expect(items.body.deckDigest).toBeNull();
    expect(itemsOf(items.body)).toEqual([]);
  });

  it("reports the deck's bank content address and whether the tier is released", async () => {
    const user = fresh();
    const id = await dealtAttempt(user);
    const body = (await handleGetItems(ctx, user, id)).body;
    expect(body.deckDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(body.released).toBe(true);
  });

  it("a host with no instrument mounted serves nothing rather than guessing", async () => {
    const user = fresh();
    const id = await dealtAttempt(user);
    expect((await handleGetItems(contentless, user, id)).status).toBe(404);
  });
});

describe("own answers, server-graded", () => {
  it("review returns the candidate's own choice and the SERVER's verdict", async () => {
    const user = fresh();
    const id = await dealtAttempt(user);
    const dealt = itemsOf((await handleGetItems(ctx, user, id)).body);
    // Answer every card with option 0, so both a hit and a miss are covered.
    for (const [seq, item] of dealt.entries()) {
      const res = await handleAppendResponse(ctx, user, id, {
        seq,
        itemId: item.id,
        payload: { choice: 0 },
        clientTs: "2026-01-05T00:00:00.000Z",
      });
      expect(res.status).toBe(201);
    }
    await handleFinalizeAttempt(ctx, user, id);
    const reviewed = itemsOf((await handleGetItems(ctx, user, id)).body);
    let hits = 0;
    for (const item of reviewed) {
      if (item.phase !== "review") throw new Error("unreachable");
      expect(item.yourChoice).toBe(0);
      expect(item.correct).toBe(item.key === 0);
      if (item.correct) hits++;
    }
    expect(hits).toBeGreaterThan(0);            // some card was keyed to option 0
    expect(hits).toBeLessThan(reviewed.length); // and some card was not
  });

  it("an unanswered card carries no verdict — silence is not a wrong answer", async () => {
    const user = fresh();
    const id = await dealtAttempt(user);
    await handleFinalizeAttempt(ctx, user, id);
    for (const item of itemsOf((await handleGetItems(ctx, user, id)).body)) {
      if (item.phase !== "review") throw new Error("unreachable");
      expect(item.yourChoice).toBeUndefined();
      expect(item.correct).toBeUndefined();
    }
  });
});
