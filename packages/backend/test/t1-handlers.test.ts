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
  type T1ApiContext,
} from "../src/t1/handlers.js";
import { MemorySnapshotStore } from "../src/t1/storage.js";
import { canonicalSitePath, siteUrlPath } from "../src/site-url.js";
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

describe("site URL convention", () => {
  const DIGEST = `sha256:${"a".repeat(64)}`;

  it("canonicalises only directory-ish paths", () => {
    expect(canonicalSitePath("")).toBe("index.html");
    expect(canonicalSitePath("/")).toBe("/index.html");
    expect(canonicalSitePath("sub/")).toBe("sub/index.html");
    expect(canonicalSitePath("index.html")).toBe("index.html");
    expect(canonicalSitePath("sub/index.html")).toBe("sub/index.html");
    expect(canonicalSitePath("assets/app.js")).toBe("assets/app.js");
  });

  it("is a fixed point — canonicalising twice cannot start a redirect loop", () => {
    for (const p of ["", "/", "sub/", "index.html", "assets/app.js"]) {
      const once = canonicalSitePath(p);
      expect(canonicalSitePath(once)).toBe(once);
    }
  });

  it("builds the canonical live URL, honouring a basePath-prefixed API root", () => {
    expect(siteUrlPath(DIGEST)).toBe(`/api/site/${DIGEST}/index.html`);
    expect(siteUrlPath(DIGEST, "/ailx/api")).toBe(`/ailx/api/site/${DIGEST}/index.html`);
    expect(siteUrlPath(DIGEST).endsWith("/")).toBe(false);
  });
});

describe("handleServeSite", () => {
  const ORIGIN = "https://sandbox.example";

  async function servedSnapshot() {
    const store = new MemorySnapshotStore();
    const snap = snapshotFromZip(siteZip({ "assets/app.js": "console.log(1)", "sub/index.html": "<p>sub</p>" }));
    await store.put(snap);
    return { store, snap };
  }

  it("serves index.html for the empty path and for trailing slashes", async () => {
    const { store, snap } = await servedSnapshot();
    for (const path of ["", "sub/"]) {
      const result = await handleServeSite(store, ORIGIN, snap.digest, path);
      expect(result.status).toBe(200);
      expect(result.headers["content-type"]).toBe("text/html; charset=utf-8");
    }
    expect(new TextDecoder().decode((await handleServeSite(store, ORIGIN, snap.digest, "sub/"))!.data!)).toBe("<p>sub</p>");
  });

  it("serves nested assets with their allowlisted content type", async () => {
    const { store, snap } = await servedSnapshot();
    const result = await handleServeSite(store, ORIGIN, snap.digest, "assets/app.js");
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
      const result = await handleServeSite(store, ORIGIN, digest, path);
      expect(result.status).toBe(404);
      expect(result.data).toBeNull();
    }
  });

  it("every 200 carries the full sandbox header set", async () => {
    const { store, snap } = await servedSnapshot();
    const { headers } = await handleServeSite(store, ORIGIN, snap.digest, "");
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
