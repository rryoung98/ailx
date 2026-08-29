/**
 * Client-direct T1 upload — the handshake that moves the BYTES off the
 * request path (docs/DEPLOY.md §5.1) without moving the AUTHORITY:
 * ownership, validation, the one-submission index, record-before-store
 * and the reachability gate must all still hold when a browser wrote
 * the ZIP into the bucket itself.
 *
 * Runs against in-process Postgres (real schema) and the in-memory
 * staging double, which refuses exactly what a scoped upload
 * credential refuses — so "a client cannot do X" is tested as a
 * client, not as a comment.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { DEV_USER_HEADER, DevAuthProvider } from "../src/auth.js";
import { appendResponse, finalizeAttempt } from "../src/store.js";
import {
  SITE_ZIP_CONTENT_TYPE,
  STAGED_UPLOAD_PREFIX,
  handleCreateSiteUpload,
  handleFinalizeSiteUpload,
  newUploadId,
  stagedUploadKey,
  type T1DirectContext,
} from "../src/t1/direct.js";
import { handleServeSite, T1_SITE_RESPONSE_KIND } from "../src/t1/handlers.js";
import { MemorySnapshotStore, MemoryUploadStaging, prefixedKey } from "../src/t1/storage.js";
import { T1_LIMITS, snapshotFromZip } from "../src/t1/snapshot.js";
import { freshDb, openAttempt } from "./helpers.js";
import { buildZip, siteZip } from "./t1-fixtures.js";

let db: Awaited<ReturnType<typeof freshDb>>;

beforeAll(async () => {
  db = await freshDb();
});

const ORIGIN = "https://sandbox.example";

function ctx(staging: MemoryUploadStaging | null = new MemoryUploadStaging()): T1DirectContext & {
  snapshots: MemorySnapshotStore;
  staging: MemoryUploadStaging | null;
} {
  return { db, auth: new DevAuthProvider(), snapshots: new MemorySnapshotStore(), staging };
}

/** Fresh attempt + headers that authenticate as its owner. */
async function ownedAttempt(): Promise<{ headers: Record<string, string>; attemptId: string }> {
  const { attempt } = await openAttempt(db);
  const { rows } = await db.query("SELECT auth_ref FROM participants WHERE id = $1", [attempt.participantId]);
  const user = (rows[0]!.auth_ref as string).slice("dev:".length);
  return { headers: { [DEV_USER_HEADER]: user }, attemptId: attempt.id };
}

interface Ticket {
  uploadId: string;
  pathname: string;
  token: string;
  maxBytes: number;
}

async function ticketFor(
  c: ReturnType<typeof ctx>,
  headers: Record<string, string>,
  attemptId: string,
): Promise<Ticket> {
  const res = await handleCreateSiteUpload(c, headers, attemptId);
  expect(res.status).toBe(201);
  return (res.body as { upload: Ticket }).upload;
}

const finalize = (
  c: ReturnType<typeof ctx>,
  headers: Record<string, string>,
  attemptId: string,
  uploadId: unknown,
  seq = 0,
) => handleFinalizeSiteUpload(c, headers, attemptId, { uploadId, seq, clientTs: "2026-08-29T00:00:00Z" });

/** The whole client-side dance: ticket, PUT, finalize. */
async function directUpload(
  c: ReturnType<typeof ctx>,
  headers: Record<string, string>,
  attemptId: string,
  zip: Uint8Array,
  seq = 0,
) {
  const ticket = await ticketFor(c, headers, attemptId);
  expect(c.staging!.upload(ticket.token, ticket.pathname, zip)).toBe("ok");
  return finalize(c, headers, attemptId, ticket.uploadId, seq);
}

// ---------------------------------------------------------------
// Key derivation — the security boundary of the whole handshake.
// ---------------------------------------------------------------

describe("stagedUploadKey", () => {
  const attemptId = "3f1b0c8e-2b4a-4d6e-8f10-9a7c5e2d1b04";

  it("scopes a key to the attempt, under the never-served staging prefix", () => {
    const uploadId = newUploadId();
    expect(uploadId).toMatch(/^[0-9a-f]{32}$/);
    expect(stagedUploadKey(attemptId, uploadId)).toBe(
      `${STAGED_UPLOAD_PREFIX}/${attemptId}/${uploadId}.zip`,
    );
    // Never inside the content-addressed namespaces the serve path reads.
    expect(stagedUploadKey(attemptId, uploadId)!.startsWith("blobs/")).toBe(false);
    expect(stagedUploadKey(attemptId, uploadId)!.startsWith("manifests/")).toBe(false);
  });

  it("mints a different key every time", () => {
    expect(newUploadId()).not.toBe(newUploadId());
  });

  it("refuses any id that could aim the write somewhere else", () => {
    for (const bad of [
      "../../manifests/x",
      "a/b",
      "",
      "ZZZZ",
      "0123456789abcdef0123456789abcde", // 31 hex
      "0123456789abcdef0123456789abcdef0", // 33 hex
      "0123456789ABCDEF0123456789abcdef", // upper case
    ]) {
      expect(stagedUploadKey(attemptId, bad)).toBeNull();
    }
    for (const bad of ["", "../x", "not-a-uuid", `${attemptId}/x`]) {
      expect(stagedUploadKey(bad, newUploadId())).toBeNull();
    }
  });
});

// ---------------------------------------------------------------
// Ticket issuance — who may ask, and what the grant permits.
// ---------------------------------------------------------------

describe("handleCreateSiteUpload", () => {
  it("requires authentication", async () => {
    const { attemptId } = await ownedAttempt();
    expect((await handleCreateSiteUpload(ctx(), {}, attemptId)).status).toBe(401);
  });

  it("404s on someone else's attempt — no ticket, no existence leak", async () => {
    const { attemptId } = await ownedAttempt();
    const res = await handleCreateSiteUpload(ctx(), { [DEV_USER_HEADER]: "intruder" }, attemptId);
    expect(res.status).toBe(404);
  });

  it("scopes the grant to one key, the ZIP content type and the §12 cap", async () => {
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    const ticket = await ticketFor(c, headers, attemptId);
    expect(ticket.pathname).toBe(stagedUploadKey(attemptId, ticket.uploadId));
    expect(ticket.maxBytes).toBe(T1_LIMITS.maxTotalBytes);
    expect((await handleCreateSiteUpload(c, headers, attemptId)).body).toMatchObject({
      upload: { contentType: SITE_ZIP_CONTENT_TYPE },
    });

    // The grant buys ONE key: not another path, not another type.
    const zip = siteZip();
    expect(c.staging!.upload(ticket.token, "manifests/anything.json", zip)).toBe("forbidden");
    expect(c.staging!.upload(ticket.token, `blobs/${"a".repeat(64)}`, zip)).toBe("forbidden");
    expect(c.staging!.upload(ticket.token, ticket.pathname, zip, "text/html")).toBe("forbidden");
    expect(c.staging!.upload("guessed-token", ticket.pathname, zip)).toBe("forbidden");
    expect(c.staging!.upload(ticket.token, ticket.pathname, new Uint8Array(T1_LIMITS.maxTotalBytes + 1))).toBe(
      "too_large",
    );
  });

  /**
   * The bucket may namespace keys (AILX_SNAPSHOT_BLOB_PREFIX), and a
   * grant is scoped to the string the STORE uses. So the ticket
   * carries the store's pathname, not the bare key — a client that
   * wrote to the bare key would be refused by the store.
   */
  it("hands back the key as the store names it, prefix and all", async () => {
    const c = ctx(new MemoryUploadStaging("staging/t1"));
    const { headers, attemptId } = await ownedAttempt();
    const ticket = await ticketFor(c, headers, attemptId);
    expect(ticket.pathname).toBe(`staging/t1/${stagedUploadKey(attemptId, ticket.uploadId)}`);
    // The client writes to exactly that name, and the round trip holds.
    expect(c.staging!.upload(ticket.token, ticket.pathname, siteZip())).toBe("ok");
    expect((await finalize(c, headers, attemptId, ticket.uploadId)).status).toBe(201);
    expect(c.staging!.stagedKeys).toEqual([]);
  });

  it("501s where there is no client-direct target (fs store), so the client POSTs instead", async () => {
    const { headers, attemptId } = await ownedAttempt();
    const res = await handleCreateSiteUpload(ctx(null), headers, attemptId);
    expect(res.status).toBe(501);
    expect((res.body.error as Record<string, unknown>).code).toBe("direct_upload_unavailable");
  });
});

// ---------------------------------------------------------------
// Finalize — the same submission, by another road.
// ---------------------------------------------------------------

describe("handleFinalizeSiteUpload", () => {
  it("records and serves a site the browser uploaded directly", async () => {
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    const zip = siteZip({ "assets/style.css": "b{margin:0}" });
    const expected = snapshotFromZip(zip);

    const res = await directUpload(c, headers, attemptId, zip);
    expect(res.status).toBe(201);
    expect(res.body.submission).toMatchObject({
      digest: expected.digest,
      created: true,
      fileCount: 2,
      path: `/api/site/${expected.digest}/index.html`,
    });

    // Content-addressed and recomputable: the digest is the one the
    // pure pipeline derives from those exact bytes.
    expect(await c.snapshots.has(expected.digest)).toBe(true);
    const { rows } = await db.query(
      "SELECT payload FROM responses WHERE attempt_id = $1 AND payload->>'kind' = $2",
      [attemptId, T1_SITE_RESPONSE_KIND],
    );
    expect(rows).toHaveLength(1);
    expect((rows[0]!.payload as Record<string, unknown>).digest).toBe(expected.digest);

    const served = await handleServeSite({ db, snapshots: c.snapshots }, ORIGIN, expected.digest, "index.html");
    expect(served.status).toBe(200);

    // The scratch copy is gone: staging hosts nothing.
    expect(c.staging!.stagedKeys).toEqual([]);
  });

  it("requires authentication and refuses another participant's attempt", async () => {
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    const ticket = await ticketFor(c, headers, attemptId);
    expect(c.staging!.upload(ticket.token, ticket.pathname, siteZip())).toBe("ok");

    expect((await finalize(c, {}, attemptId, ticket.uploadId)).status).toBe(401);
    const intruder = await finalize(c, { [DEV_USER_HEADER]: "intruder" }, attemptId, ticket.uploadId);
    expect(intruder.status).toBe(404);
    // Refused, so the staged bytes are still nobody's submission.
    expect(await c.snapshots.has(snapshotFromZip(siteZip()).digest)).toBe(false);
  });

  it("rejects an uploadId that is not one we minted", async () => {
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    for (const bad of ["../../manifests/x", "", 42, null, `${"a".repeat(31)}`]) {
      const res = await finalize(c, headers, attemptId, bad);
      expect(res.status).toBe(400);
      expect((res.body.error as Record<string, unknown>).code).toBe("bad_request");
    }
  });

  it("404s a ticket whose bytes never landed (or already expired)", async () => {
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    const ticket = await ticketFor(c, headers, attemptId);
    const res = await finalize(c, headers, attemptId, ticket.uploadId);
    expect(res.status).toBe(404);
    expect((res.body.error as Record<string, unknown>).code).toBe("upload_not_found");
  });

  it("501s where there is no client-direct target", async () => {
    const { headers, attemptId } = await ownedAttempt();
    expect((await finalize(ctx(null), headers, attemptId, newUploadId())).status).toBe(501);
  });

  it("re-uploading the same bytes replays; different bytes conflict", async () => {
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    const zip = siteZip({}, "<h1>v1</h1>");
    expect((await directUpload(c, headers, attemptId, zip)).status).toBe(201);

    const replay = await directUpload(c, headers, attemptId, zip, 0);
    expect(replay.status).toBe(200);
    expect((replay.body.submission as Record<string, unknown>).created).toBe(false);

    const second = siteZip({}, "<h1>v2</h1>");
    const conflict = await directUpload(c, headers, attemptId, second, 1);
    expect(conflict.status).toBe(409);
    expect((conflict.body.error as Record<string, unknown>).code).toBe("already_submitted");
    // The losing bytes are stored nowhere and served nowhere.
    const digest = snapshotFromZip(second).digest;
    expect(await c.snapshots.has(digest)).toBe(false);
    expect((await handleServeSite({ db, snapshots: c.snapshots }, ORIGIN, digest, "index.html")).status).toBe(404);
    expect(c.staging!.stagedKeys).toEqual([]);
  });

  it("keeps the seq and finalized-attempt rules", async () => {
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    const { rows } = await db.query("SELECT participant_id FROM attempts WHERE id = $1", [attemptId]);
    const participantId = rows[0]!.participant_id as string;
    await appendResponse(db, attemptId, participantId, { seq: 0, payload: { kind: "other" }, clientTs: Date.now() });

    const clash = await directUpload(c, headers, attemptId, siteZip(), 0);
    expect(clash.status).toBe(409);
    expect((clash.body.error as Record<string, unknown>).code).toBe("seq_conflict");

    await finalizeAttempt(db, attemptId, participantId);
    const phish = siteZip({}, "<h1>sign in with your bank</h1>");
    const dead = await directUpload(c, headers, attemptId, phish, 1);
    expect(dead.status).toBe(409);
    expect((dead.body.error as Record<string, unknown>).code).toBe("finalized");
    // Nothing published, nothing left staged.
    const digest = snapshotFromZip(phish).digest;
    expect(await c.snapshots.has(digest)).toBe(false);
    expect((await handleServeSite({ db, snapshots: c.snapshots }, ORIGIN, digest, "index.html")).status).toBe(404);
    expect(c.staging!.stagedKeys).toEqual([]);
  });
});

// ---------------------------------------------------------------
// The properties the direct path must not weaken.
// ---------------------------------------------------------------

describe("a client-direct upload cannot buy anything a POST could not", () => {
  const hostile: [string, Uint8Array, number, string][] = [
    ["not a ZIP at all", new TextEncoder().encode("junk"), 400, "bad_zip"],
    ["an empty archive", buildZip([]), 400, "empty_zip"],
    [
      "a zip bomb (lying declared size)",
      buildZip([{ path: "index.html", data: "x", uncompSizeOverride: 11 * 1024 * 1024 }]),
      413,
      "file_too_large",
    ],
    [
      "zip slip (traversal path)",
      buildZip([
        { path: "index.html", data: "<h1>ok</h1>" },
        { path: "../../etc/passwd.html", data: "pwned" },
      ]),
      400,
      "unsafe_path",
    ],
    [
      "an absolute path",
      buildZip([
        { path: "index.html", data: "<h1>ok</h1>" },
        { path: "/etc/shadow.html", data: "pwned" },
      ]),
      400,
      "unsafe_path",
    ],
    [
      "a symlink entry",
      buildZip([
        { path: "index.html", data: "<h1>ok</h1>" },
        { path: "link.html", data: "../../secret", symlink: true },
      ]),
      400,
      "symlink",
    ],
    [
      "a disallowed executable type",
      buildZip([
        { path: "index.html", data: "<h1>ok</h1>" },
        { path: "run.php", data: "<?php ?>" },
      ]),
      400,
      "disallowed_type",
    ],
    ["no root index.html", buildZip([{ path: "about.html", data: "<h1>x</h1>" }]), 400, "missing_index"],
    [
      "an encrypted entry",
      buildZip([{ path: "index.html", data: "<h1>x</h1>", flags: 0x1 }]),
      400,
      "unsupported_zip",
    ],
    ["a corrupt CRC", buildZip([{ path: "index.html", data: "<h1>x</h1>", crcOverride: 0 }]), 400, "bad_zip"],
  ];

  it.each(hostile)("rejects %s server-side, and stages nothing", async (_name, zip, status, code) => {
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    const res = await directUpload(c, headers, attemptId, zip, 0);
    expect(res.status).toBe(status);
    expect((res.body.error as Record<string, unknown>).code).toBe(code);
    // No row, no snapshot, and the rejected bytes are discarded.
    const { rows } = await db.query("SELECT count(*) AS n FROM responses WHERE attempt_id = $1", [attemptId]);
    expect(Number(rows[0]!.n)).toBe(0);
    expect(c.staging!.stagedKeys).toEqual([]);
  });

  it("cannot register a digest it did not upload", async () => {
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    const honest = siteZip({}, "<h1>mine</h1>");
    const coveted = snapshotFromZip(siteZip({}, "<h1>someone else's</h1>")).digest;

    // The client's ONLY input is the uploadId — a digest it hands us
    // (here as an extra field) is not part of the contract and cannot
    // become the recorded artifact.
    const ticket = await ticketFor(c, headers, attemptId);
    expect(c.staging!.upload(ticket.token, ticket.pathname, honest)).toBe("ok");
    const res = await handleFinalizeSiteUpload(c, headers, attemptId, {
      uploadId: ticket.uploadId,
      seq: 0,
      clientTs: "2026-08-29T00:00:00Z",
      ...({ digest: coveted } as Record<string, unknown>),
    });
    expect(res.status).toBe(201);
    expect((res.body.submission as Record<string, unknown>).digest).toBe(snapshotFromZip(honest).digest);
    expect(await c.snapshots.has(coveted)).toBe(false);
    expect((await handleServeSite({ db, snapshots: c.snapshots }, ORIGIN, coveted, "index.html")).status).toBe(404);
  });

  it("cannot finalize, or write into, another attempt's upload", async () => {
    const c = ctx();
    const victim = await ownedAttempt();
    const attacker = await ownedAttempt();
    const victimTicket = await ticketFor(c, victim.headers, victim.attemptId);
    const attackerTicket = await ticketFor(c, attacker.headers, attacker.attemptId);

    // The attacker's grant does not reach the victim's key...
    expect(c.staging!.upload(attackerTicket.token, victimTicket.pathname, siteZip({}, "<h1>evil</h1>"))).toBe(
      "forbidden",
    );
    // ...and neither does the attacker's uploadId, presented against
    // the victim's attempt (which is not theirs to finalize anyway).
    expect(c.staging!.upload(attackerTicket.token, attackerTicket.pathname, siteZip({}, "<h1>evil</h1>"))).toBe("ok");
    expect((await finalize(c, attacker.headers, victim.attemptId, attackerTicket.uploadId)).status).toBe(404);
    // The victim's own attempt is untouched: no rows, and their key is
    // still empty (the attacker could not put anything there).
    const { rows } = await db.query("SELECT count(*) AS n FROM responses WHERE attempt_id = $1", [victim.attemptId]);
    expect(Number(rows[0]!.n)).toBe(0);

    // Its own attempt, its own key: fine. Two attempts, two snapshots.
    expect((await finalize(c, attacker.headers, attacker.attemptId, attackerTicket.uploadId)).status).toBe(201);
  });

  it("refuses an oversize staged object without buffering it", async () => {
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    const ticket = await ticketFor(c, headers, attemptId);
    // The grant already caps this — but assume the store failed to
    // enforce it, which is exactly the case the server must survive.
    c.staging!.plant(ticket.pathname, new Uint8Array(T1_LIMITS.maxTotalBytes + 1));
    const res = await finalize(c, headers, attemptId, ticket.uploadId);
    expect(res.status).toBe(413);
    expect((res.body.error as Record<string, unknown>).code).toBe("total_too_large");
    expect(c.staging!.stagedKeys).toEqual([]);
    const { rows } = await db.query("SELECT count(*) AS n FROM responses WHERE attempt_id = $1", [attemptId]);
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it("cannot reuse a staged upload after it is consumed", async () => {
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    const ticket = await ticketFor(c, headers, attemptId);
    expect(c.staging!.upload(ticket.token, ticket.pathname, siteZip())).toBe("ok");
    expect((await finalize(c, headers, attemptId, ticket.uploadId)).status).toBe(201);
    // Second call: the scratch object is gone, so there is nothing to accept.
    expect((await finalize(c, headers, attemptId, ticket.uploadId, 1)).status).toBe(404);
  });
});

describe("prefixedKey", () => {
  it("joins a prefix and key exactly once, with or without a trailing slash", () => {
    expect(prefixedKey("", "blobs/x")).toBe("blobs/x");
    expect(prefixedKey("t1", "blobs/x")).toBe("t1/blobs/x");
    expect(prefixedKey("t1/", "blobs/x")).toBe("t1/blobs/x");
    expect(prefixedKey("staging/t1", "manifests/a.json")).toBe("staging/t1/manifests/a.json");
  });
});
