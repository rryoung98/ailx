/**
 * `@ailx/backend/t1` — the T1 site-submission pipeline. A separate subpath
 * (not the main barrel) because it pulls in node:zlib/fs/crypto, and the main
 * entry is also imported by client code in the static export.
 */
export { SnapshotError, SNAPSHOT_ERROR_CODES, type SnapshotErrorCode } from "./errors.js";
export { crc32, readZip, type ZipEntry, type ZipLimits } from "./zip.js";
export {
  SNAPSHOT_DIGEST_RE,
  T1_LIMITS,
  T1_MIME_BY_EXTENSION,
  snapshotFromZip,
  type SiteSnapshot,
  type SnapshotFile,
  type SnapshotManifestEntry,
} from "./snapshot.js";
export {
  BlobSnapshotStore,
  FsSnapshotStore,
  MemorySnapshotStore,
  MemoryUploadStaging,
  prefixedKey,
  type BlobClient,
  type SnapshotStore,
  type SnapshotUploadStaging,
  type StagedUploadGrant,
  type StagedUploadRead,
  type StoredSiteFile,
} from "./storage.js";
export {
  SITE_ZIP_CONTENT_TYPE,
  STAGED_UPLOAD_PREFIX,
  UPLOAD_GRANT_TTL_MS,
  handleCreateSiteUpload,
  handleFinalizeSiteUpload,
  newUploadId,
  stagedUploadKey,
  type FinalizeSiteUploadInput,
  type T1DirectContext,
} from "./direct.js";
export {
  T1_SITE_RESPONSE_KIND,
  T1_SITE_UNIQUE_INDEX,
  handleServeSite,
  handleUploadSite,
  recordSiteSubmission,
  withOwnedAttempt,
  sandboxHeaders,
  type ServeSiteResult,
  type SiteServeContext,
  type T1ApiContext,
  type UploadSiteInput,
} from "./handlers.js";
