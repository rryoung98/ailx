/**
 * Snapshot storage — the FsSnapshotStore is the dev/test implementation of
 * the cloud adapter shape; both implementations must behave identically.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { snapshotFromZip } from "../src/t1/snapshot.js";
import { FsSnapshotStore, MemorySnapshotStore, type SnapshotStore } from "../src/t1/storage.js";
import { siteZip } from "./t1-fixtures.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ailx-t1-store-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const impls: Array<[string, () => SnapshotStore]> = [
  ["FsSnapshotStore", () => new FsSnapshotStore(dir)],
  ["MemorySnapshotStore", () => new MemorySnapshotStore()],
];

for (const [name, make] of impls) {
  describe(name, () => {
    it("round-trips a snapshot and is idempotent", async () => {
      const store = make();
      const snap = snapshotFromZip(siteZip({ "assets/a.css": "b{}" }));
      expect(await store.has(snap.digest)).toBe(false);
      await store.put(snap);
      await store.put(snap); // idempotent
      expect(await store.has(snap.digest)).toBe(true);

      const index = await store.getFile(snap.digest, "index.html");
      expect(index?.contentType).toBe("text/html; charset=utf-8");
      expect(new TextDecoder().decode(index?.data)).toBe("<h1>hi</h1>");
      const css = await store.getFile(snap.digest, "assets/a.css");
      expect(css?.contentType).toBe("text/css; charset=utf-8");
    });

    it("returns null for unknown digests, paths, and malformed digests", async () => {
      const store = make();
      const snap = snapshotFromZip(siteZip());
      await store.put(snap);
      expect(await store.getFile(snap.digest, "nope.html")).toBeNull();
      expect(await store.getFile(`sha256:${"0".repeat(64)}`, "index.html")).toBeNull();
      for (const evil of ["../../etc/passwd", "sha256:../../x", "sha256:ABC", ""]) {
        expect(await store.getFile(evil, "index.html")).toBeNull();
        expect(await store.has(evil)).toBe(false);
      }
    });

    it("stores distinct snapshots independently", async () => {
      const store = make();
      const a = snapshotFromZip(siteZip({}, "<h1>a</h1>"));
      const b = snapshotFromZip(siteZip({}, "<h1>b</h1>"));
      await store.put(a);
      await store.put(b);
      expect(new TextDecoder().decode((await store.getFile(a.digest, "index.html"))!.data)).toBe("<h1>a</h1>");
      expect(new TextDecoder().decode((await store.getFile(b.digest, "index.html"))!.data)).toBe("<h1>b</h1>");
    });
  });
}

describe("FsSnapshotStore layout", () => {
  it("deduplicates identical file bytes across snapshots", async () => {
    const store = new FsSnapshotStore(dir);
    await store.put(snapshotFromZip(siteZip({ "a.css": "same{}" }, "<h1>a</h1>")));
    await store.put(snapshotFromZip(siteZip({ "b.css": "same{}" }, "<h1>b</h1>")));
    const blobs = await readdir(join(dir, "blobs"));
    // 2 indexes + 1 shared css blob.
    expect(blobs).toHaveLength(3);
    expect((await readdir(join(dir, "manifests"))).sort()).toHaveLength(2);
  });

  it("leaves no temp files behind", async () => {
    const store = new FsSnapshotStore(dir);
    await store.put(snapshotFromZip(siteZip()));
    for (const sub of ["blobs", "manifests"]) {
      for (const f of await readdir(join(dir, sub))) expect(f).not.toContain(".tmp-");
    }
  });

  it("refuses to store bytes under a hash they do not have", async () => {
    const store = new FsSnapshotStore(dir);
    const snap = snapshotFromZip(siteZip());
    snap.files[0]!.data = new TextEncoder().encode("tampered");
    await expect(store.put(snap)).rejects.toThrow(/does not match its recorded hash/);
    // No manifest committed — the snapshot does not exist.
    expect(await store.has(snap.digest)).toBe(false);
  });

  it("rejects an invalid digest on put", async () => {
    const store = new FsSnapshotStore(dir);
    const snap = snapshotFromZip(siteZip());
    (snap as { digest: string }).digest = "sha256:../evil";
    await expect(store.put(snap)).rejects.toThrow(/invalid snapshot digest/);
  });
});
