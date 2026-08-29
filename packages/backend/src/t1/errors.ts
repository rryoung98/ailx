/**
 * SnapshotError — every way a T1 site ZIP can be rejected, as a closed code
 * set shared by the ZIP reader (structural codes) and the snapshot validator
 * (policy codes). Handlers map codes onto HTTP statuses; messages are safe to
 * show to the candidate.
 */

export const SNAPSHOT_ERROR_CODES = [
  // Structural (zip.ts)
  "bad_zip", // not a ZIP / corrupt / integrity failure
  "unsupported_zip", // encryption, zip64, exotic compression — valid but out of policy
  // Policy (snapshot.ts)
  "too_many_files",
  "file_too_large",
  "total_too_large",
  "unsafe_path", // absolute, traversal, backslash, control chars, over-long
  "symlink",
  "disallowed_type",
  "duplicate_path",
  "missing_index", // no root index.html — nothing to serve
  "empty_zip",
] as const;

export type SnapshotErrorCode = (typeof SNAPSHOT_ERROR_CODES)[number];

export class SnapshotError extends Error {
  constructor(
    public readonly code: SnapshotErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SnapshotError";
  }
}
