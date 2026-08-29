/**
 * Snapshot storage seam. Three implementations, ONE behaviour: the
 * content-addressed layout, the hash check and the commit rule live in
 * `ObjectSnapshotStore` below, and a backend only says how to read and write
 * one immutable object.
 *
 * Layout (content-addressed, immutable):
 *   blobs/<file-sha256>          raw file bytes, deduplicated across snapshots
 *   manifests/<digest-hex>.json  canonical manifest, written LAST — a snapshot
 *                                exists iff its manifest exists, so a crashed
 *                                upload can never serve a partial site.
 *
 * No cloud SDK is imported here. `BlobSnapshotStore` takes a two-method
 * `BlobClient` port, so the SDK (and its credentials) stay in the app's single
 * wiring point and the tests need no network.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { canonicalJson } from "@ailx/core";
import {
  SNAPSHOT_DIGEST_RE,
  type SiteSnapshot,
  type SnapshotManifestEntry,
} from "./snapshot.js";

export interface StoredSiteFile {
  data: Uint8Array;
  contentType: string;
  sha256: string;
}

export interface SnapshotStore {
  /** Idempotent: putting the same snapshot twice is a no-op. */
  put(snapshot: SiteSnapshot): Promise<void>;
  /** Exact stored-path lookup; null when the snapshot or path is unknown. */
  getFile(digest: string, path: string): Promise<StoredSiteFile | null>;
  has(digest: string): Promise<boolean>;
}

/** Reject anything that is not `sha256:<64 hex>` before it nears a storage key. */
function digestHex(digest: string): string | null {
  return SNAPSHOT_DIGEST_RE.test(digest) ? digest.slice("sha256:".length) : null;
}

const BLOB_RE = /^[0-9a-f]{64}$/;

/**
 * Everything both real backends share. Subclasses implement two primitives
 * over immutable, never-rewritten-in-place objects:
 *
 *  - `putObject` must publish the WHOLE object or nothing — a reader may never
 *    see half of one (a filesystem needs temp file + rename; an object store
 *    gets this from the API, which only exposes a completed upload).
 *  - `getObject` returns null for a missing key rather than throwing.
 *
 * Given that, `put` writes every blob first and the manifest last, so an
 * interrupted upload leaves unreferenced blobs (harmless, and deduplicated
 * away by the next identical upload) and NO servable snapshot.
 */
abstract class ObjectSnapshotStore implements SnapshotStore {
  protected abstract putObject(key: string, data: Uint8Array): Promise<void>;
  protected abstract getObject(key: string): Promise<Uint8Array | null>;

  protected blobKey(sha: string): string {
    return `blobs/${sha}`;
  }

  protected manifestKey(hex: string): string {
    return `manifests/${hex}.json`;
  }

  async put(snapshot: SiteSnapshot): Promise<void> {
    const hex = digestHex(snapshot.digest);
    if (hex === null) throw new Error(`invalid snapshot digest: ${snapshot.digest}`);
    for (const file of snapshot.files) {
      // Defence in depth: never store bytes under a hash they do not have.
      const actual = createHash("sha256").update(file.data).digest("hex");
      if (actual !== file.sha256) {
        throw new Error(`snapshot file ${file.path} does not match its recorded hash`);
      }
      await this.putObject(this.blobKey(file.sha256), file.data);
    }
    // Manifest last: its presence is the commit marker for the whole snapshot.
    await this.putObject(this.manifestKey(hex), new TextEncoder().encode(canonicalJson(snapshot.manifest)));
  }

  private async readManifest(digest: string): Promise<SnapshotManifestEntry[] | null> {
    const hex = digestHex(digest);
    if (hex === null) return null;
    const raw = await this.getObject(this.manifestKey(hex));
    if (raw === null) return null;
    return JSON.parse(new TextDecoder().decode(raw)) as SnapshotManifestEntry[];
  }

  async getFile(digest: string, path: string): Promise<StoredSiteFile | null> {
    const manifest = await this.readManifest(digest);
    const entry = manifest?.find((f) => f.path === path);
    // Only manifest-listed hashes ever reach the storage key — a hostile
    // "path" can select nothing outside the snapshot.
    if (entry === undefined || !BLOB_RE.test(entry.sha256)) return null;
    const data = await this.getObject(this.blobKey(entry.sha256));
    // A committed manifest implies its blobs; a missing one is a corrupt
    // store, and serving nothing beats serving a broken site.
    if (data === null) return null;
    return { data, contentType: entry.contentType, sha256: entry.sha256 };
  }

  async has(digest: string): Promise<boolean> {
    return (await this.readManifest(digest)) !== null;
  }
}

/** Local-filesystem implementation — dev and tests. */
export class FsSnapshotStore extends ObjectSnapshotStore {
  constructor(private readonly rootDir: string) {
    super();
  }

  /** Write via a unique temp name + rename, so readers never see partial bytes. */
  protected async putObject(key: string, data: Uint8Array): Promise<void> {
    const finalPath = join(this.rootDir, key);
    await mkdir(dirname(finalPath), { recursive: true });
    const tmp = `${finalPath}.tmp-${randomBytes(8).toString("hex")}`;
    await writeFile(tmp, data);
    await rename(tmp, finalPath);
  }

  protected async getObject(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(join(this.rootDir, key)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
}

/**
 * The object-store port: exactly what a snapshot store needs from a bucket.
 * `put` overwrites freely — every key is content-addressed, so re-writing one
 * can only ever write the same bytes.
 */
export interface BlobClient {
  put(key: string, data: Uint8Array): Promise<void>;
  /** Object bytes, or null when the key does not exist. */
  get(key: string): Promise<Uint8Array | null>;
}

/**
 * Bucket implementation — serverless hosting, where the filesystem is
 * per-invocation and a snapshot written by one request must be readable by
 * the next. There is no rename in an object store, and none is needed: a
 * `put` is atomic per object, so "manifest last" is still the commit marker.
 */
export class BlobSnapshotStore extends ObjectSnapshotStore {
  private readonly prefix: string;

  /** `prefix` namespaces one bucket across deployments (e.g. "staging/"). */
  constructor(
    private readonly client: BlobClient,
    prefix = "",
  ) {
    super();
    this.prefix = prefix === "" || prefix.endsWith("/") ? prefix : `${prefix}/`;
  }

  protected putObject(key: string, data: Uint8Array): Promise<void> {
    return this.client.put(this.prefix + key, data);
  }

  protected getObject(key: string): Promise<Uint8Array | null> {
    return this.client.get(this.prefix + key);
  }
}

/** In-memory implementation — handler tests, no filesystem. */
export class MemorySnapshotStore implements SnapshotStore {
  private readonly snapshots = new Map<string, Map<string, StoredSiteFile>>();

  async put(snapshot: SiteSnapshot): Promise<void> {
    const files = new Map<string, StoredSiteFile>();
    for (const f of snapshot.files) {
      files.set(f.path, { data: f.data, contentType: f.contentType, sha256: f.sha256 });
    }
    this.snapshots.set(snapshot.digest, files);
  }

  async getFile(digest: string, path: string): Promise<StoredSiteFile | null> {
    return this.snapshots.get(digest)?.get(path) ?? null;
  }

  async has(digest: string): Promise<boolean> {
    return this.snapshots.has(digest);
  }
}
