/**
 * T1 export — the download floor. Ownership (not the capability digest) is
 * what authorizes it, the archive round-trips to the SAME content address it
 * was scored under, and nothing about the scored artifact is mutated.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { DEV_USER_HEADER, DevAuthProvider } from "../src/auth.js";
import { handleExportSite, isSiteExportZip, loadSnapshotFiles, siteExportFilename } from "../src/t1/export.js";
import { handleUploadSite, type T1ApiContext } from "../src/t1/handlers.js";
import { snapshotFromZip } from "../src/t1/snapshot.js";
import { MemorySnapshotStore, type SnapshotStore } from "../src/t1/storage.js";
import { readZip } from "../src/t1/zip.js";
import { T1_LIMITS } from "../src/t1/snapshot.js";
import { freshDb, openAttempt } from "./helpers.js";
import { siteZip } from "./t1-fixtures.js";

let db: Awaited<ReturnType<typeof freshDb>>;

beforeAll(async () => {
  db = await freshDb();
});

function ctx(snapshots: SnapshotStore = new MemorySnapshotStore()): T1ApiContext {
  return { db, auth: new DevAuthProvider(), snapshots };
}

async function ownedAttempt(): Promise<{ headers: Record<string, string>; attemptId: string }> {
  const { attempt } = await openAttempt(db);
  const { rows } = await db.query("SELECT auth_ref FROM participants WHERE id = $1", [attempt.participantId]);
  const user = (rows[0]!.auth_ref as string).slice("dev:".length);
  return { headers: { [DEV_USER_HEADER]: user }, attemptId: attempt.id };
}

/** Upload `zip` against a fresh owned attempt and return everything about it. */
async function submitted(zip: Uint8Array, snapshots: SnapshotStore = new MemorySnapshotStore()) {
  const c = ctx(snapshots);
  const { headers, attemptId } = await ownedAttempt();
  const result = await handleUploadSite(c, headers, attemptId, { zip, seq: 0, clientTs: "2026-08-29T00:00:00Z" });
  expect(result.status).toBe(201);
  return { c, headers, attemptId, snapshots };
}

describe("siteExportFilename", () => {
  it("names the download after the content address", () => {
    expect(siteExportFilename(`sha256:${"ab".repeat(32)}`)).toBe("ailx-site-abababababab.zip");
  });

  it("carries no attempt or participant identifier", () => {
    const name = siteExportFilename(`sha256:${"9".repeat(64)}`);
    expect(name).toBe("ailx-site-999999999999.zip");
    expect(name).not.toContain("sha256:");
  });
});

describe("handleExportSite", () => {
  it("requires authentication", async () => {
    const { c, attemptId } = await submitted(siteZip());
    const result = await handleExportSite(c, {}, attemptId);
    expect(isSiteExportZip(result)).toBe(false);
    expect((result as { status: number }).status).toBe(401);
  });

  it("404s for a stranger — a digest is not authorization to export", async () => {
    const { c, attemptId } = await submitted(siteZip());
    const result = await handleExportSite(c, { [DEV_USER_HEADER]: "intruder" }, attemptId);
    expect(isSiteExportZip(result)).toBe(false);
    expect((result as { status: number }).status).toBe(404);
  });

  it("404s when the attempt has no site submission", async () => {
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    const result = await handleExportSite(c, headers, attemptId);
    expect((result as { status: number; body: { error: { code: string } } }).status).toBe(404);
  });

  it("returns a ZIP that re-derives the SCORED content address", async () => {
    const zip = siteZip({ "style.css": "b{}", "img/logo.svg": "<svg/>" });
    const expected = snapshotFromZip(zip);
    const { c, headers, attemptId } = await submitted(zip);

    const result = await handleExportSite(c, headers, attemptId);
    expect(isSiteExportZip(result)).toBe(true);
    if (!isSiteExportZip(result)) return;
    expect(result.digest).toBe(expected.digest);
    expect(result.fileCount).toBe(3);
    expect(result.totalBytes).toBe(expected.totalBytes);
    expect(result.filename).toBe(siteExportFilename(expected.digest));
    // The whole point: the download IS the scored artifact.
    expect(snapshotFromZip(result.zip).digest).toBe(expected.digest);
  });

  it("adds nothing to the archive — no README, no metadata file", async () => {
    const { c, headers, attemptId } = await submitted(siteZip({ "app.js": "1" }));
    const result = await handleExportSite(c, headers, attemptId);
    if (!isSiteExportZip(result)) throw new Error("expected a zip");
    expect(readZip(result.zip, T1_LIMITS).map((e) => e.path).sort()).toEqual(["app.js", "index.html"]);
  });

  it("preserves binary bytes exactly", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 255, 13, 10]);
    const { c, headers, attemptId } = await submitted(siteZip({ "logo.png": png }));
    const result = await handleExportSite(c, headers, attemptId);
    if (!isSiteExportZip(result)) throw new Error("expected a zip");
    const entry = readZip(result.zip, T1_LIMITS).find((e) => e.path === "logo.png");
    expect(entry?.data).toEqual(png);
  });

  it("is deterministic — two exports are byte-identical", async () => {
    const { c, headers, attemptId } = await submitted(siteZip({ "a.css": "a{}" }));
    const first = await handleExportSite(c, headers, attemptId);
    const second = await handleExportSite(c, headers, attemptId);
    if (!isSiteExportZip(first) || !isSiteExportZip(second)) throw new Error("expected zips");
    expect(first.zip).toEqual(second.zip);
  });

  it("mutates nothing — the responses row and the stored bytes are untouched", async () => {
    const zip = siteZip();
    const digest = snapshotFromZip(zip).digest;
    const { c, headers, attemptId, snapshots } = await submitted(zip);
    const before = await db.query("SELECT id, payload, server_ts FROM responses WHERE attempt_id = $1", [attemptId]);

    await handleExportSite(c, headers, attemptId);

    const after = await db.query("SELECT id, payload, server_ts FROM responses WHERE attempt_id = $1", [attemptId]);
    expect(after.rows).toEqual(before.rows);
    expect(await snapshots.has(digest)).toBe(true);
    expect((await snapshots.getManifest(digest))?.length).toBe(1);
  });

  it("503s when the recorded digest's bytes are not stored", async () => {
    // The documented crash residue: the row was appended, the put never ran.
    const zip = siteZip();
    const c = ctx();
    const { headers, attemptId } = await ownedAttempt();
    await handleUploadSite(c, headers, attemptId, { zip, seq: 0, clientTs: "2026-08-29T00:00:00Z" });
    const empty = ctx(new MemorySnapshotStore());
    const result = await handleExportSite({ ...empty, db }, headers, attemptId);
    expect((result as { status: number; body: { error: { code: string } } }).status).toBe(503);
    expect((result as { body: { error: { code: string } } }).body.error.code).toBe("snapshot_unavailable");
  });

  it("503s rather than exporting bytes that do not match their recorded hash", async () => {
    const zip = siteZip();
    const store = new MemorySnapshotStore();
    const { c, headers, attemptId } = await submitted(zip, store);
    // A corrupt store: right manifest, wrong bytes.
    const tampered: SnapshotStore = {
      put: (s) => store.put(s),
      getManifest: (d) => store.getManifest(d),
      has: (d) => store.has(d),
      async getFile(d, p) {
        const file = await store.getFile(d, p);
        return file === null ? null : { ...file, data: new TextEncoder().encode("<h1>not yours</h1>") };
      },
    };
    const result = await handleExportSite({ ...c, snapshots: tampered }, headers, attemptId);
    expect((result as { status: number }).status).toBe(503);
  });
});

describe("loadSnapshotFiles", () => {
  it("is null for an unknown digest", async () => {
    expect(await loadSnapshotFiles(new MemorySnapshotStore(), `sha256:${"0".repeat(64)}`)).toBeNull();
  });

  it("returns manifest order, which is path order", async () => {
    const store = new MemorySnapshotStore();
    const snapshot = snapshotFromZip(siteZip({ "z.css": "z{}", "a.css": "a{}" }));
    await store.put(snapshot);
    const files = await loadSnapshotFiles(store, snapshot.digest);
    expect(files?.map((f) => f.path)).toEqual(["a.css", "index.html", "z.css"]);
  });
});
