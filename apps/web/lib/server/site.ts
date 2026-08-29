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
  UPLOAD_GRANT_TTL_MS,
  prefixedKey,
  type BlobClient,
  type SnapshotStore,
  type SnapshotUploadStaging,
  type StagedUploadRead,
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

/** The blob-mode credential, or the one error that explains its absence. */
function blobToken(env: Env): string {
  const token = env[BLOB_TOKEN_ENV];
  if (!token) {
    throw new Error(
      `AILX_SNAPSHOT_STORE=blob requires ${BLOB_TOKEN_ENV} (link a Vercel Blob store to the project)`,
    );
  }
  return token;
}

/** Pure-ish factory: environment in, store out. Exported for tests. */
export function makeSnapshotStore(env: Env, cwd: string): SnapshotStore {
  if (snapshotStoreMode(env) === "fs") return new FsSnapshotStore(snapshotDir(env, cwd));
  return new BlobSnapshotStore(vercelBlobClient(blobToken(env)), snapshotBlobPrefix(env));
}

let store: SnapshotStore | undefined;

export function getSnapshotStore(): SnapshotStore {
  // A store holds no connection or handle, so caching it is safe even where
  // the process is recycled between requests.
  store ??= makeSnapshotStore(process.env, process.cwd());
  return store;
}

/**
 * The staging half of the Blob store — where a browser PUTs a ZIP that
 * is too big for a serverless request body (docs/DEPLOY.md §5.1).
 *
 * Every scope decision is here and server-side: the key, the content
 * type, the byte cap and the expiry. `addRandomSuffix: false` keeps the
 * key we minted (a suffix would leave the object where finalize cannot
 * find it), and `allowOverwrite: false` means a grant cannot even
 * rewrite its own key once used — one grant, one object.
 *
 * `access: "private"` matches the snapshot store: a staged ZIP is
 * unvalidated candidate content, so it must never be readable from a
 * guessable public URL.
 */
function vercelBlobStaging(token: string, prefix: string): SnapshotUploadStaging {
  const key = (relative: string) => prefixedKey(prefix, relative);
  return {
    async authorize({ key: relative, maxBytes, contentType }) {
      const { generateClientTokenFromReadWriteToken } = await import("@vercel/blob/client");
      const expiresAt = Date.now() + UPLOAD_GRANT_TTL_MS;
      return {
        token: await generateClientTokenFromReadWriteToken({
          token,
          pathname: key(relative),
          maximumSizeInBytes: maxBytes,
          allowedContentTypes: [contentType],
          validUntil: expiresAt,
          addRandomSuffix: false,
          allowOverwrite: false,
        }),
        expiresAt,
      };
    },
    async read(relative, maxBytes): Promise<StagedUploadRead> {
      const { get } = await import("@vercel/blob");
      // useCache: false — a just-written scratch object must be read as
      // it is, not as a CDN edge last saw that key.
      const res = await get(key(relative), { access: "private", token, useCache: false });
      if (res === null || res.stream === null) return { kind: "missing" };
      const size = res.blob.size;
      // Refuse from the metadata, before the body is buffered: the
      // grant already capped this, and a cap is worth nothing if
      // exceeding it still costs us the memory.
      if (typeof size === "number" && size > maxBytes) {
        await res.stream.cancel();
        return { kind: "too_large", bytes: size };
      }
      return { kind: "bytes", data: new Uint8Array(await new Response(res.stream).arrayBuffer()) };
    },
    async discard(relative) {
      const { del } = await import("@vercel/blob");
      await del(key(relative), { token });
    },
  };
}

/**
 * Pure-ish factory: environment in, staging out — or null when this
 * deployment has no client-direct target. The filesystem store is a
 * local disk with no upload endpoint a browser could reach, so
 * `fs` mode returns null and the client keeps POSTing ZIPs (which is
 * exactly right: a local server has no 4.5 MB request cap either).
 */
export function makeUploadStaging(env: Env): SnapshotUploadStaging | null {
  if (snapshotStoreMode(env) !== "blob") return null;
  return vercelBlobStaging(blobToken(env), snapshotBlobPrefix(env));
}

let staging: { value: SnapshotUploadStaging | null } | undefined;

export function getUploadStaging(): SnapshotUploadStaging | null {
  // Boxed: null is a real answer (fs mode), not a missing cache entry.
  staging ??= { value: makeUploadStaging(process.env) };
  return staging.value;
}
