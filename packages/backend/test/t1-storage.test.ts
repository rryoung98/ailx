/**
 * Snapshot storage — one behavioural contract, every implementation. The
 * filesystem store is dev/local, the blob store is serverless hosting, and
 * they are held to the SAME tests: whatever the backend, a snapshot is
 * servable only once its manifest lands.
 */
import { mkdtemp, readdir, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { snapshotFromZip } from "../src/t1/snapshot.js";
import {
  BlobSnapshotStore,
  FsSnapshotStore,
  MemorySnapshotStore,
  type BlobClient,
  type SnapshotStore,
} from "../src/t1/storage.js";
import { siteZip } from "./t1-fixtures.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ailx-t1-store-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * In-memory stand-in for the bucket SDK — the whole reason `BlobSnapshotStore`
 * takes a port. No network, no credentials, and `failKeys` models the write
 * that never lands (a crashed or timed-out serverless invocation).
 */
class FakeBlobClient implements BlobClient {
  readonly objects = new Map<string, Uint8Array>();
  readonly failKeys = new Set<string>();
  puts = 0;

  async put(key: string, data: Uint8Array): Promise<void> {
    if (this.failKeys.has(key)) throw new Error(`upload failed: ${key}`);
    this.puts += 1;
    // An object store publishes a completed upload or nothing; copying the
    // bytes models that the caller's buffer is not the stored object.
    this.objects.set(key, Uint8Array.from(data));
  }

  async get(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key) ?? null;
  }
}

const digestHex = (digest: string) => digest.slice("sha256:".length);

/** A real backend: the store plus the two hooks the layout tests need. */
interface Backend {
  name: string;
  make(): SnapshotStore;
  keys(): Promise<string[]>;
  dropManifest(digest: string): Promise<void>;
}

let fake: FakeBlobClient;

const backends: Backend[] = [
  {
    name: "FsSnapshotStore",
    make: () => new FsSnapshotStore(dir),
    keys: async () => {
      const out: string[] = [];
      for (const sub of ["blobs", "manifests"]) {
        for (const f of await readdir(join(dir, sub)).catch(() => [])) out.push(`${sub}/${f}`);
      }
      return out;
    },
    dropManifest: (digest) => unlink(join(dir, "manifests", `${digestHex(digest)}.json`)),
  },
  {
    name: "BlobSnapshotStore",
    make: () => {
      fake = new FakeBlobClient();
      return new BlobSnapshotStore(fake);
    },
    keys: async () => [...fake.objects.keys()],
    dropManifest: async (digest) => {
      fake.objects.delete(`manifests/${digestHex(digest)}.json`);
    },
  },
];

const behaviours: Array<[string, () => SnapshotStore]> = [
  ...backends.map((b): [string, () => SnapshotStore] => [b.name, b.make]),
  ["MemorySnapshotStore", () => new MemorySnapshotStore()],
];

for (const [name, make] of behaviours) {
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

for (const backend of backends) {
  describe(`${backend.name} layout`, () => {
    it("deduplicates identical file bytes across snapshots", async () => {
      const store = backend.make();
      await store.put(snapshotFromZip(siteZip({ "a.css": "same{}" }, "<h1>a</h1>")));
      await store.put(snapshotFromZip(siteZip({ "b.css": "same{}" }, "<h1>b</h1>")));
      const keys = await backend.keys();
      // 2 indexes + 1 shared css blob, and one manifest per snapshot.
      expect(keys.filter((k) => k.startsWith("blobs/"))).toHaveLength(3);
      expect(keys.filter((k) => k.startsWith("manifests/"))).toHaveLength(2);
    });

    it("writes only content-addressed keys — no temp or partial leftovers", async () => {
      const store = backend.make();
      await store.put(snapshotFromZip(siteZip({ "a.css": "x{}" })));
      for (const key of await backend.keys()) {
        expect(key).toMatch(/^(blobs\/[0-9a-f]{64}|manifests\/[0-9a-f]{64}\.json)$/);
      }
    });

    it("refuses to store bytes under a hash they do not have", async () => {
      const store = backend.make();
      const snap = snapshotFromZip(siteZip());
      snap.files[0]!.data = new TextEncoder().encode("tampered");
      await expect(store.put(snap)).rejects.toThrow(/does not match its recorded hash/);
      // No manifest committed — the snapshot does not exist.
      expect(await store.has(snap.digest)).toBe(false);
    });

    it("rejects an invalid digest on put", async () => {
      const store = backend.make();
      const snap = snapshotFromZip(siteZip());
      (snap as { digest: string }).digest = "sha256:../evil";
      await expect(store.put(snap)).rejects.toThrow(/invalid snapshot digest/);
      expect(await backend.keys()).toHaveLength(0);
    });

    it("does not serve a snapshot whose manifest never landed", async () => {
      // The interrupted upload: blobs are up, the commit marker is not. The
      // site must be invisible, not half-served.
      const store = backend.make();
      const snap = snapshotFromZip(siteZip({ "a.css": "x{}" }));
      await store.put(snap);
      await backend.dropManifest(snap.digest);
      expect(await store.has(snap.digest)).toBe(false);
      expect(await store.getFile(snap.digest, "index.html")).toBeNull();
      // The orphaned blobs are still there, and re-uploading commits them.
      expect((await backend.keys()).filter((k) => k.startsWith("blobs/")).length).toBeGreaterThan(0);
      await store.put(snap);
      expect(await store.has(snap.digest)).toBe(true);
    });

    it("survives a corrupt store by serving nothing", async () => {
      const store = backend.make();
      const snap = snapshotFromZip(siteZip());
      await store.put(snap);
      // Manifest committed, blob gone: null, never a partial or wrong body.
      const blobKey = (await backend.keys()).find((k) => k.startsWith("blobs/"))!;
      if (backend.name === "FsSnapshotStore") await unlink(join(dir, blobKey));
      else fake.objects.delete(blobKey);
      expect(await store.getFile(snap.digest, "index.html")).toBeNull();
    });
  });
}

describe("BlobSnapshotStore", () => {
  it("aborts before the commit marker when a blob upload fails", async () => {
    const client = new FakeBlobClient();
    const store = new BlobSnapshotStore(client);
    const snap = snapshotFromZip(siteZip({ "a.css": "x{}" }));
    client.failKeys.add(`blobs/${snap.files.find((f) => f.path === "a.css")!.sha256}`);
    await expect(store.put(snap)).rejects.toThrow(/upload failed/);
    expect(await store.has(snap.digest)).toBe(false);
    expect([...client.objects.keys()].some((k) => k.startsWith("manifests/"))).toBe(false);
  });

  it("writes the manifest last, after every blob", async () => {
    const client = new FakeBlobClient();
    const order: string[] = [];
    const spy: BlobClient = {
      put: async (key, data) => {
        order.push(key);
        await client.put(key, data);
      },
      get: (key) => client.get(key),
    };
    const snap = snapshotFromZip(siteZip({ "a.css": "x{}", "b.js": "y" }));
    await new BlobSnapshotStore(spy).put(snap);
    expect(order).toHaveLength(snap.files.length + 1);
    expect(order.slice(0, -1).every((k) => k.startsWith("blobs/"))).toBe(true);
    expect(order[order.length - 1]).toBe(`manifests/${digestHex(snap.digest)}.json`);
  });

  it("namespaces every key under a prefix, adding the missing slash", async () => {
    const client = new FakeBlobClient();
    const snap = snapshotFromZip(siteZip());
    for (const prefix of ["staging", "prod/"]) {
      const store = new BlobSnapshotStore(client, prefix);
      await store.put(snap);
      expect(await store.has(snap.digest)).toBe(true);
    }
    for (const key of client.objects.keys()) expect(key).toMatch(/^(staging|prod)\/(blobs|manifests)\//);
    // Prefixes are isolated: an unprefixed store sees neither.
    expect(await new BlobSnapshotStore(client).has(snap.digest)).toBe(false);
  });

  it("re-put of the same snapshot rewrites the same keys only", async () => {
    const client = new FakeBlobClient();
    const store = new BlobSnapshotStore(client);
    const snap = snapshotFromZip(siteZip({ "a.css": "x{}" }));
    await store.put(snap);
    const keys = [...client.objects.keys()].sort();
    await store.put(snap);
    expect([...client.objects.keys()].sort()).toEqual(keys);
  });
});
