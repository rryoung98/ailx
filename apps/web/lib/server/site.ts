/**
 * T1 snapshot store wiring for server mode — the SINGLE place that decides
 * where uploaded candidate sites live, so no route and no library ever reads
 * a storage env var itself.
 *
 *   AILX_SNAPSHOT_STORE=fs    (default) local filesystem under AILX_SNAPSHOT_DIR.
 *                             Correct for `next dev`, tests and any single
 *                             long-lived server; WRONG for serverless, whose
 *                             filesystem is per-invocation.
 *   AILX_SNAPSHOT_STORE=blob  Vercel Blob (private objects), for Vercel and
 *                             anything else without a durable local disk.
 *
 * Only route.api.ts files import this, so none of it exists in the static
 * export — and the @vercel/blob SDK is behind a dynamic import, so the fs
 * path never loads it.
 */
import { join } from "node:path";
import {
  BlobSnapshotStore,
  FsSnapshotStore,
  type BlobClient,
  type SnapshotStore,
} from "@ailx/backend/t1";

type Env = Readonly<Record<string, string | undefined>>;

/** The token Vercel injects when a Blob store is linked to the project. */
export const BLOB_TOKEN_ENV = "BLOB_READ_WRITE_TOKEN";

export type SnapshotStoreMode = "fs" | "blob";

/** Pure: resolve the snapshot directory from an environment map. */
export function snapshotDir(env: Env, cwd: string): string {
  return env.AILX_SNAPSHOT_DIR ?? join(cwd, ".ailx-snapshots");
}

/**
 * Pure: which backend this environment asks for. Explicit, with a filesystem
 * default — a stray blob token in a shell must not silently redirect a local
 * dev server's uploads into a shared bucket, and an unknown value is a typo
 * worth failing on rather than guessing about.
 */
export function snapshotStoreMode(env: Env): SnapshotStoreMode {
  const mode = env.AILX_SNAPSHOT_STORE;
  if (mode === undefined || mode === "" || mode === "fs") return "fs";
  if (mode === "blob") return "blob";
  throw new Error(`AILX_SNAPSHOT_STORE must be "fs" or "blob" (got "${mode}")`);
}

/**
 * Pure: the key namespace inside the bucket. One store can then hold staging
 * and production without either serving the other's sites, even though the
 * keys are content-addressed and would otherwise collide harmlessly.
 */
export function snapshotBlobPrefix(env: Env): string {
  return env.AILX_SNAPSHOT_BLOB_PREFIX ?? "t1";
}

/**
 * The @vercel/blob adapter for @ailx/backend's BlobClient port.
 *
 * `access: "private"` is not optional: a public object is readable by anyone
 * who can guess its URL, which would route around the reachability gate in
 * handleServeSite (a snapshot is servable only while a responses row records
 * its digest). Every read goes through the token.
 */
function vercelBlobClient(token: string): BlobClient {
  // Imported per call (ESM caches the module), so selecting the filesystem
  // store never loads the SDK and constructing this client touches nothing.
  return {
    async put(key, data) {
      const { put } = await import("@vercel/blob");
      await put(key, Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
        access: "private",
        token,
        addRandomSuffix: false, // Content-addressed keys ARE the identity.
        allowOverwrite: true, // Same key ⇒ same bytes, so this is a no-op write.
        contentType: "application/octet-stream", // The manifest carries the real type.
      });
    },
    async get(key) {
      const { get } = await import("@vercel/blob");
      const res = await get(key, { access: "private", token });
      if (res === null || res.stream === null) return null;
      return new Uint8Array(await new Response(res.stream).arrayBuffer());
    },
  };
}

/** Pure-ish factory: environment in, store out. Exported for tests. */
export function makeSnapshotStore(env: Env, cwd: string): SnapshotStore {
  if (snapshotStoreMode(env) === "fs") return new FsSnapshotStore(snapshotDir(env, cwd));
  const token = env[BLOB_TOKEN_ENV];
  if (!token) {
    throw new Error(
      `AILX_SNAPSHOT_STORE=blob requires ${BLOB_TOKEN_ENV} (link a Vercel Blob store to the project)`,
    );
  }
  return new BlobSnapshotStore(vercelBlobClient(token), snapshotBlobPrefix(env));
}

let store: SnapshotStore | undefined;

export function getSnapshotStore(): SnapshotStore {
  // A store holds no connection or handle, so caching it is safe even where
  // the process is recycled between requests.
  store ??= makeSnapshotStore(process.env, process.cwd());
  return store;
}
