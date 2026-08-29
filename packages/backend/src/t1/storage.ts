/**
 * Snapshot storage seam. The interface is the cloud adapter shape: a GCS or
 * Vercel Blob implementation is a future class with these three methods and
 * the same layout (blobs by file hash + a manifest per snapshot digest) — no
 * cloud SDK code lives here yet, deliberately.
 *
 * Layout (content-addressed, immutable):
 *   blobs/<file-sha256>          raw file bytes, deduplicated across snapshots
 *   manifests/<digest-hex>.json  canonical manifest, written LAST — a snapshot
 *                                exists iff its manifest exists, so a crashed
 *                                upload can never serve a partial site.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

/** Reject anything that is not `sha256:<64 hex>` before it nears a filesystem path. */
function digestHex(digest: string): string | null {
  return SNAPSHOT_DIGEST_RE.test(digest) ? digest.slice("sha256:".length) : null;
}

const BLOB_RE = /^[0-9a-f]{64}$/;

/** Local-filesystem implementation — dev and tests. */
export class FsSnapshotStore implements SnapshotStore {
  constructor(private readonly rootDir: string) {}

  private blobPath(sha: string): string {
    return join(this.rootDir, "blobs", sha);
  }

  private manifestPath(hex: string): string {
    return join(this.rootDir, "manifests", `${hex}.json`);
  }

  /** Write via a unique temp name + rename, so readers never see partial bytes. */
  private async writeAtomic(finalPath: string, data: Uint8Array | string): Promise<void> {
    const tmp = `${finalPath}.tmp-${randomBytes(8).toString("hex")}`;
    await writeFile(tmp, data);
    await rename(tmp, finalPath);
  }

  async put(snapshot: SiteSnapshot): Promise<void> {
    const hex = digestHex(snapshot.digest);
    if (hex === null) throw new Error(`invalid snapshot digest: ${snapshot.digest}`);
    await mkdir(join(this.rootDir, "blobs"), { recursive: true });
    await mkdir(join(this.rootDir, "manifests"), { recursive: true });
    for (const file of snapshot.files) {
      // Defence in depth: never store bytes under a hash they do not have.
      const actual = createHash("sha256").update(file.data).digest("hex");
      if (actual !== file.sha256) {
        throw new Error(`snapshot file ${file.path} does not match its recorded hash`);
      }
      await this.writeAtomic(this.blobPath(file.sha256), file.data);
    }
    // Manifest last: its presence is the commit marker for the whole snapshot.
    await this.writeAtomic(this.manifestPath(hex), canonicalJson(snapshot.manifest));
  }

  private async readManifest(digest: string): Promise<SnapshotManifestEntry[] | null> {
    const hex = digestHex(digest);
    if (hex === null) return null;
    let raw: string;
    try {
      raw = await readFile(this.manifestPath(hex), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    return JSON.parse(raw) as SnapshotManifestEntry[];
  }

  async getFile(digest: string, path: string): Promise<StoredSiteFile | null> {
    const manifest = await this.readManifest(digest);
    const entry = manifest?.find((f) => f.path === path);
    // Only manifest-listed hashes ever reach the filesystem — a hostile
    // "path" can select nothing outside the snapshot.
    if (entry === undefined || !BLOB_RE.test(entry.sha256)) return null;
    const data = await readFile(this.blobPath(entry.sha256));
    return { data: new Uint8Array(data), contentType: entry.contentType, sha256: entry.sha256 };
  }

  async has(digest: string): Promise<boolean> {
    return (await this.readManifest(digest)) !== null;
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
