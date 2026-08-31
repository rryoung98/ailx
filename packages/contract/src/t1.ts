/**
 * The T1 submission CAPS — spec §12 (25 MB total, 500 files, 10 MB per file,
 * 512-character paths).
 *
 * Here rather than in the server's ZIP reader because the browser enforces
 * the same numbers before it uploads (and the request-size guard rejects at
 * `maxTotalBytes` mid-stream). One table: a UI that allowed more than the
 * server accepts would waste a candidate's upload, and one that allowed less
 * would refuse work the exam permits.
 */

export const T1_LIMITS = {
  maxTotalBytes: 25 * 1024 * 1024,
  maxFiles: 500,
  maxFileBytes: 10 * 1024 * 1024,
  maxPathLength: 512,
} as const;
