/**
 * T1 upload + serve handlers against in-process Postgres (real schema) and
 * the in-memory snapshot store — auth, ownership, one-submission semantics,
 * append-only recording, and the sandbox headers on every served byte.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { DevAuthProvider, DEV_USER_HEADER } from "../src/auth.js";
import { finalizeAttempt } from "../src/store.js";
import {
  T1_SITE_RESPONSE_KIND,
  handleServeSite,
  handleUploadSite,
  sandboxHeaders,
  type SiteServeContext,
  type T1ApiContext,
} from "../src/t1/handlers.js";
import { MemorySnapshotStore } from "../src/t1/storage.js";
import { siteUrlPath } from "@ailx/contract";
import { snapshotFromZip } from "../src/t1/snapshot.js";
import { freshDb, openAttempt } from "./helpers.js";
import { buildZip, siteZip } from "./t1-fixtures.js";

let db: Awaited<ReturnType<typeof freshDb>>;

beforeAll(async () => {
  db = await freshDb();
});

function ctx(): T1ApiContext & { snapshots: MemorySnapshotStore } {
  return { db, auth: new DevAuthProvider(), snapshots: new MemorySnapshotStore() };
}

/** Serve context: the same DB the uploads recorded into, plus a store. */
const serveCtx = (snapshots: MemorySnapshotStore): SiteServeContext => ({ db, snapshots });

/** Fresh attempt + dev headers that authenticate as its owner. */
async function ownedAttempt(): Promise<{ headers: Record<string, string>; attemptId: string }> {
  const { attempt } = await openAttempt(db);
  // openAttempt seeds auth_ref dev:user-<n>; recover the n from the attempt's
  // participant row so headers authenticate as the owner.
  const { rows } = await db.query("SELECT auth_ref FROM participants WHERE id = $1", [attempt.participantId]);
  const user = (rows[0]!.auth_ref as string).slice("dev:".length);
  return { headers: { [DEV_USER_HEADER]: user }, attemptId: attempt.id };
}

const upload = (c: T1ApiContext, headers: Record<string, string>, attemptId: string, zip: Uint8Array, seq = 0) =>
  handleUploadSite(c, headers, attemptId, { zip, seq, clientTs: "2026-08-29T00:00:00Z" });

describe("handleUploadSite", () => {
  it("requires authentication", async () => {
    const c = ctx();
    const { attemptId } = await ownedAttempt();
    const result = await upload(c, {}, attemptId, siteZip());
    expect(result.status).toBe(401);
  });

  it("404s on someone else's attempt without validating the zip", async () => {
    const c = ctx();
    const { attemptId } = await ownedAttempt();
    const result = await upload(c, { [DEV_USER_HEADER]: "intruder" }, attemptId, siteZip());
    expect(result.status).toBe(404);
  });

  it("stores the snapshot and records an append-only responses row", async () => {
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    const zip = siteZip({ "style.css": "b{}" });
    const expected = snapshotFromZip(zip);

    const result = await upload(c, headers, attemptId, zip);
    expect(result.status).toBe(201);
    const submission = result.body.submission as Record<string, unknown>;
    expect(submission.digest).toBe(expected.digest);
    expect(submission.created).toBe(true);
    expect(submission.path).toBe(`/api/site/${expected.digest}/index.html`);
    // Canonical: a real file name, so no framework trailing-slash rewrite can
    // bounce it (the staging redirect loop) and relative assets still resolve.
    expect(submission.path).toBe(siteUrlPath(expected.digest));

    // Bytes are retrievable under the digest — the scored artifact exists.
    expect(await c.snapshots.has(expected.digest)).toBe(true);

    // The DB row links attempt → digest, so scoring recomputes from stored inputs.
    const { rows } = await db.query(
      "SELECT payload FROM responses WHERE attempt_id = $1 AND payload->>'kind' = $2",
      [attemptId, T1_SITE_RESPONSE_KIND],
    );
    expect(rows).toHaveLength(1);
    const payload = rows[0]!.payload as Record<string, unknown>;
    expect(payload.digest).toBe(expected.digest);
    expect(payload.fileCount).toBe(2);
  });

  it("re-uploading the same bytes at the same seq is an idempotent replay", async () => {
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    const zip = siteZip();
    expect((await upload(c, headers, attemptId, zip)).status).toBe(201);
    const replay = await upload(c, headers, attemptId, zip);
    expect(replay.status).toBe(200);
    expect((replay.body.submission as Record<string, unknown>).created).toBe(false);
  });

  it("rejects a second, different submission with 409 already_submitted", async () => {
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    expect((await upload(c, headers, attemptId, siteZip({}, "<h1>v1</h1>"))).status).toBe(201);
    const second = await upload(c, headers, attemptId, siteZip({}, "<h1>v2</h1>"), 1);
    expect(second.status).toBe(409);
    expect((second.body.error as Record<string, unknown>).code).toBe("already_submitted");
    // Nothing extra recorded.
    const { rows } = await db.query(
      "SELECT count(*) AS n FROM responses WHERE attempt_id = $1 AND payload->>'kind' = $2",
      [attemptId, T1_SITE_RESPONSE_KIND],
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it("rejects uploads to a finalized attempt", async () => {
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    const { rows } = await db.query("SELECT participant_id FROM attempts WHERE id = $1", [attemptId]);
    await finalizeAttempt(db, attemptId, rows[0]!.participant_id as string);
    const result = await upload(c, headers, attemptId, siteZip());
    expect(result.status).toBe(409);
    expect((result.body.error as Record<string, unknown>).code).toBe("finalized");
  });

  it("maps validation failures onto 400 and oversize onto 413", async () => {
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    expect((await upload(c, headers, attemptId, new TextEncoder().encode("junk"))).status).toBe(400);
    expect((await upload(c, headers, attemptId, new Uint8Array(0))).status).toBe(400);
    const bomb = buildZip([{ path: "index.html", data: "x", uncompSizeOverride: 11 * 1024 * 1024 }]);
    const oversize = await upload(c, headers, attemptId, bomb);
    expect(oversize.status).toBe(413);
    expect((oversize.body.error as Record<string, unknown>).code).toBe("file_too_large");
    // Failed validations must not create rows or snapshots.
    const { rows } = await db.query(
      "SELECT count(*) AS n FROM responses WHERE attempt_id = $1",
      [attemptId],
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it("conflicting seq with a different payload surfaces the store's 409", async () => {
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    // Occupy seq 0 with a non-site response.
    const { rows } = await db.query("SELECT participant_id FROM attempts WHERE id = $1", [attemptId]);
    const { appendResponse } = await import("../src/store.js");
    await appendResponse(db, attemptId, rows[0]!.participant_id as string, {
      seq: 0,
      payload: { kind: "other" },
      clientTs: Date.now(),
    });
    const result = await upload(c, headers, attemptId, siteZip(), 0);
    expect(result.status).toBe(409);
    expect((result.body.error as Record<string, unknown>).code).toBe("seq_conflict");
  });
});

/**
 * P1-1: an upload the append REJECTS must leave nothing hosted at our origin.
 * Before the fix the bytes were stored first, so a finalized/conflicting/lost
 * upload still published arbitrary content under an unauthenticated,
 * immutable-cached URL with no row tying it to anybody.
 */
describe("a rejected upload publishes nothing servable", () => {
  const ORIGIN = "https://sandbox.example";

  /** Nothing stored, nothing served, no row. */
  async function expectUnpublished(
    c: T1ApiContext & { snapshots: MemorySnapshotStore },
    zip: Uint8Array,
  ) {
    const digest = snapshotFromZip(zip).digest;
    expect(await c.snapshots.has(digest)).toBe(false);
    expect((await handleServeSite(serveCtx(c.snapshots), ORIGIN, digest, "index.html")).status).toBe(404);
    const { rows } = await db.query(
      "SELECT count(*) AS n FROM responses WHERE payload->>'digest' = $1",
      [digest],
    );
    expect(Number(rows[0]!.n)).toBe(0);
  }

  it("finalized attempt: the phishing-upload path stores no bytes", async () => {
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    const { rows } = await db.query("SELECT participant_id FROM attempts WHERE id = $1", [attemptId]);
    await finalizeAttempt(db, attemptId, rows[0]!.participant_id as string);
    const phish = siteZip({}, "<h1>sign in with your bank</h1>");
    expect((await upload(c, headers, attemptId, phish)).status).toBe(409);
    await expectUnpublished(c, phish);
  });

  it("already_submitted: the rejected second submission stores no bytes", async () => {
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    expect((await upload(c, headers, attemptId, siteZip({}, "<h1>real</h1>"))).status).toBe(201);
    const other = siteZip({}, "<h1>not mine</h1>");
    expect((await upload(c, headers, attemptId, other, 1)).status).toBe(409);
    await expectUnpublished(c, other);
  });

  it("seq_conflict: the rejected upload stores no bytes", async () => {
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    const { rows } = await db.query("SELECT participant_id FROM attempts WHERE id = $1", [attemptId]);
    const { appendResponse } = await import("../src/store.js");
    await appendResponse(db, attemptId, rows[0]!.participant_id as string, {
      seq: 7,
      payload: { kind: "other" },
      clientTs: Date.now(),
    });
    const zip = siteZip({}, "<h1>seq loser</h1>");
    expect((await upload(c, headers, attemptId, zip, 7)).status).toBe(409);
    await expectUnpublished(c, zip);
  });

  it("bytes with no response row are unreachable (orphan reachability rule)", async () => {
    const store = new MemorySnapshotStore();
    const orphan = snapshotFromZip(siteZip({}, "<h1>orphan</h1>"));
    await store.put(orphan); // e.g. left by the old store-first upload path
    expect(await store.has(orphan.digest)).toBe(true);
    const result = await handleServeSite(serveCtx(store), ORIGIN, orphan.digest, "");
    expect(result.status).toBe(404);
    expect(result.data).toBeNull();
  });

  it("a recorded digest whose bytes are missing 404s, and a re-upload repairs it", async () => {
    // The residue of record-first: a crash between the commit and the put.
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    const zip = siteZip({}, "<h1>repair me</h1>");
    expect((await upload(c, headers, attemptId, zip)).status).toBe(201);
    const digest = snapshotFromZip(zip).digest;
    const lost = new MemorySnapshotStore(); // the put that never landed
    expect((await handleServeSite(serveCtx(lost), ORIGIN, digest, "")).status).toBe(404);

    const repaired = { ...c, snapshots: lost };
    const replay = await upload(repaired, headers, attemptId, zip, 3);
    expect(replay.status).toBe(200);
    expect(await lost.has(digest)).toBe(true);
    expect((await handleServeSite(serveCtx(lost), ORIGIN, digest, "")).status).toBe(200);
  });
});

/**
 * P1-5: one site submission per attempt is enforced by the DATABASE. The
 * handler's pre-check is a courtesy; these tests make the CONSTRAINT do the
 * work (a different seq, or a pre-check blinded exactly the way a concurrent
 * upload blinds it).
 */
describe("one-submission-per-attempt is a DB constraint", () => {
  /** Blind the FIRST pre-check SELECT — precisely what a concurrent upload does. */
  function racingDb(): T1ApiContext["db"] {
    let blinded = false;
    return {
      async query(text: string, params?: unknown[]) {
        if (!blinded && text.includes("ORDER BY seq LIMIT 1")) {
          blinded = true;
          return { rows: [] };
        }
        return db.query(text, params);
      },
    };
  }

  const siteRows = async (attemptId: string) => {
    const { rows } = await db.query(
      "SELECT payload->>'digest' AS digest FROM responses WHERE attempt_id = $1 AND payload->>'kind' = $2 ORDER BY seq",
      [attemptId, T1_SITE_RESPONSE_KIND],
    );
    return rows.map((r) => r.digest as string);
  };

  it("refuses a second site row at the SQL level, whatever the seq", async () => {
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    expect((await upload(c, headers, attemptId, siteZip())).status).toBe(201);
    // No handler, no pre-check: the raw insert a non-browser client would make.
    await expect(
      db.query(
        `INSERT INTO responses (attempt_id, seq, payload, client_ts)
         VALUES ($1, 99, $2::jsonb, now())`,
        [attemptId, JSON.stringify({ kind: T1_SITE_RESPONSE_KIND, digest: `sha256:${"c".repeat(64)}` })],
      ),
    ).rejects.toThrow(/responses_one_t1_site_per_attempt/);
    expect(await siteRows(attemptId)).toHaveLength(1);
  });

  it("same bytes at a DIFFERENT seq replay through the constraint (200, one row)", async () => {
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    const zip = siteZip();
    expect((await upload(c, headers, attemptId, zip)).status).toBe(201);
    const replay = await upload(c, headers, attemptId, zip, 42);
    expect(replay.status).toBe(200);
    expect((replay.body.submission as Record<string, unknown>).created).toBe(false);
    expect(await siteRows(attemptId)).toHaveLength(1);
  });

  it("a concurrent different-bytes upload loses to the constraint, not to luck", async () => {
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    const winner = siteZip({}, "<h1>winner</h1>");
    expect((await upload(c, headers, attemptId, winner)).status).toBe(201);

    const loserZip = siteZip({}, "<h1>loser</h1>");
    const raced = await upload({ ...c, db: racingDb() }, headers, attemptId, loserZip, 5);
    expect(raced.status).toBe(409);
    expect((raced.body.error as Record<string, unknown>).code).toBe("already_submitted");
    // The loser is not recorded and — the P1-1 half — not hosted either.
    expect(await siteRows(attemptId)).toEqual([snapshotFromZip(winner).digest]);
    expect(await c.snapshots.has(snapshotFromZip(loserZip).digest)).toBe(false);
  });

  it("a concurrent SAME-bytes upload is still an idempotent replay", async () => {
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    const zip = siteZip({}, "<h1>same</h1>");
    expect((await upload(c, headers, attemptId, zip)).status).toBe(201);
    const raced = await upload({ ...c, db: racingDb() }, headers, attemptId, zip, 6);
    expect(raced.status).toBe(200);
    expect((raced.body.submission as Record<string, unknown>).created).toBe(false);
    expect(await siteRows(attemptId)).toHaveLength(1);
  });
});

describe("handleServeSite", () => {
  const ORIGIN = "https://sandbox.example";

  /**
   * A REAL upload: bytes in the store AND the `responses` row that makes them
   * servable. Serving is now reachability-gated, so a bare store.put() is not
   * a served snapshot.
   */
  async function servedSnapshot() {
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    const zip = siteZip({ "assets/app.js": "console.log(1)", "sub/index.html": "<p>sub</p>" });
    expect((await upload(c, headers, attemptId, zip)).status).toBe(201);
    return { store: c.snapshots, snap: snapshotFromZip(zip) };
  }

  it("serves index.html for the empty path and for trailing slashes", async () => {
    const { store, snap } = await servedSnapshot();
    for (const path of ["", "sub/"]) {
      const result = await handleServeSite(serveCtx(store), ORIGIN, snap.digest, path);
      expect(result.status).toBe(200);
      expect(result.headers["content-type"]).toBe("text/html; charset=utf-8");
    }
    expect(new TextDecoder().decode((await handleServeSite(serveCtx(store), ORIGIN, snap.digest, "sub/"))!.data!)).toBe("<p>sub</p>");
  });

  it("serves nested assets with their allowlisted content type", async () => {
    const { store, snap } = await servedSnapshot();
    const result = await handleServeSite(serveCtx(store), ORIGIN, snap.digest, "assets/app.js");
    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toBe("text/javascript; charset=utf-8");
  });

  it("404s unknown paths, unknown digests, malformed digests, and traversal", async () => {
    const { store, snap } = await servedSnapshot();
    for (const [digest, path] of [
      [snap.digest, "missing.html"],
      [snap.digest, "../index.html"],
      [snap.digest, "assets/app.js/"],
      [`sha256:${"f".repeat(64)}`, ""],
      ["sha256:short", ""],
      ["../../etc", ""],
    ] as const) {
      const result = await handleServeSite(serveCtx(store), ORIGIN, digest, path);
      expect(result.status).toBe(404);
      expect(result.data).toBeNull();
    }
  });

  it("every 200 carries the full sandbox header set", async () => {
    const { store, snap } = await servedSnapshot();
    const { headers } = await handleServeSite(serveCtx(store), ORIGIN, snap.digest, "");
    const csp = headers["content-security-policy"]!;
    // The load-bearing directives from spec §12.
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).not.toContain("allow-same-origin"); // the classic footgun
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("webrtc 'block'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`script-src 'self' ${ORIGIN}`); // 'self' ≠ opaque origin
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("worker-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["x-robots-tag"]).toBe("noindex");
    expect(headers["cache-control"]).toContain("immutable");
  });

  it("sandboxHeaders never allows a foreign origin into fetch directives", () => {
    const headers = sandboxHeaders("https://a.example", "text/html; charset=utf-8");
    expect(headers["content-security-policy"]).not.toContain("*");
    expect(headers["content-type"]).toBe("text/html; charset=utf-8");
  });
});
