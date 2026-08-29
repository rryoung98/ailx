/**
 * T1 snapshot store wiring for server mode. Local filesystem for dev; a GCS
 * or Vercel Blob class implementing @ailx/backend's SnapshotStore slots in
 * here later without touching routes. Only route.api.ts files import this,
 * so none of it exists in the static export.
 */
import { join } from "node:path";
import { FsSnapshotStore, type SnapshotStore } from "@ailx/backend/t1";

/** Pure: resolve the snapshot directory from an environment map. */
export function snapshotDir(env: Readonly<Record<string, string | undefined>>, cwd: string): string {
  return env.AILX_SNAPSHOT_DIR ?? join(cwd, ".ailx-snapshots");
}

let store: SnapshotStore | undefined;

export function getSnapshotStore(): SnapshotStore {
  store ??= new FsSnapshotStore(snapshotDir(process.env, process.cwd()));
  return store;
}
