/**
 * T1 site snapshot — spec T1 "Submission is a ZIP of static assets; no build
 * step runs on our infrastructure" + §12 caps (25 MB total, 500 files, 10 MB
 * per file; extensions allowlisted; symlinks and zip-slip paths rejected).
 *
 * Pure: ZIP bytes in → validated snapshot out. The snapshot digest is
 * sha256 of the canonical JSON manifest (sorted path → file-hash), so the
 * SAME set of file bytes always addresses the SAME snapshot regardless of
 * ZIP encoding order or compression — the recomputability invariant: stored
 * bytes + digest ARE the scored artifact.
 */

import { createHash } from "node:crypto";
import { canonicalJson } from "@ailx/core";
import { T1_LIMITS } from "@ailx/contract";
import { SnapshotError } from "./errors.js";
import { readZip } from "./zip.js";

/** Spec §12 caps. Defined in @ailx/contract (the browser enforces the same
 * numbers before it uploads); re-exported so `./t1` keeps one spelling. */
export { T1_LIMITS };

/**
 * Extension allowlist AND the content type served for each — one table so the
 * allowlist and the serving map can never drift. Static assets only: nothing
 * here is executable server-side, and nothing outside this table is stored.
 * (SVG is scriptable in a document context; the sandbox CSP in handlers.ts is
 * what defangs it, as it does for HTML itself.)
 */
export const T1_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  xml: "application/xml",
  webmanifest: "application/manifest+json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
};

/** One manifest line: everything scoring needs to re-address the file. */
export interface SnapshotManifestEntry {
  path: string;
  sha256: string;
  bytes: number;
  contentType: string;
}

export interface SnapshotFile extends SnapshotManifestEntry {
  data: Uint8Array;
}

export interface SiteSnapshot {
  /** `sha256:<hex>` of the canonical manifest — the content address. */
  digest: string;
  fileCount: number;
  totalBytes: number;
  /** Sorted by path (byte order); the digest preimage. */
  manifest: SnapshotManifestEntry[];
  files: SnapshotFile[];
}

export const SNAPSHOT_DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

const sha256Hex = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

// biome-ignore lint/suspicious/noControlCharactersInRegex: detecting control characters is the point — a ZIP entry name carrying one is rejected
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const DRIVE_LETTER = /^[A-Za-z]:/;

/** Throws unsafe_path / disallowed_type; returns the file's content type. */
function validatePath(path: string): string {
  if (path.length === 0 || path.length > T1_LIMITS.maxPathLength) {
    throw new SnapshotError("unsafe_path", `entry path is empty or longer than ${T1_LIMITS.maxPathLength} characters`);
  }
  if (path.includes("\\") || CONTROL_CHARS.test(path) || DRIVE_LETTER.test(path)) {
    throw new SnapshotError("unsafe_path", `unsafe entry path: ${JSON.stringify(path)}`);
  }
  if (path.startsWith("/")) {
    throw new SnapshotError("unsafe_path", `absolute entry path: ${path}`);
  }
  for (const segment of path.split("/")) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new SnapshotError("unsafe_path", `path traversal in entry: ${path}`);
    }
  }
  const dot = path.lastIndexOf(".");
  const ext = dot > path.lastIndexOf("/") ? path.slice(dot + 1).toLowerCase() : "";
  const contentType = T1_MIME_BY_EXTENSION[ext];
  if (contentType === undefined) {
    throw new SnapshotError(
      "disallowed_type",
      `${path}: extension ${ext ? `.${ext}` : "(none)"} is not an allowed static asset type`,
    );
  }
  return contentType;
}

/**
 * Validate a submission ZIP and compute its content-addressed snapshot.
 * Throws SnapshotError on ANY violation — a snapshot either passes every
 * check or does not exist.
 */
export function snapshotFromZip(zip: Uint8Array): SiteSnapshot {
  const entries = readZip(zip, T1_LIMITS);
  if (entries.length === 0) {
    throw new SnapshotError("empty_zip", "archive contains no files");
  }

  const files: SnapshotFile[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.isSymlink) {
      throw new SnapshotError("symlink", `symlink entries are not allowed: ${entry.path}`);
    }
    const contentType = validatePath(entry.path);
    // Case-insensitive: object stores and macOS disagree about Foo vs foo.
    const key = entry.path.toLowerCase();
    if (seen.has(key)) {
      throw new SnapshotError("duplicate_path", `duplicate entry path: ${entry.path}`);
    }
    seen.add(key);
    files.push({
      path: entry.path,
      data: entry.data,
      sha256: sha256Hex(entry.data),
      bytes: entry.data.length,
      contentType,
    });
  }

  if (!seen.has("index.html")) {
    throw new SnapshotError("missing_index", "submission must contain index.html at the archive root");
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const manifest = files.map(({ path, sha256, bytes, contentType }) => ({ path, sha256, bytes, contentType }));
  const digest = `sha256:${sha256Hex(new TextEncoder().encode(canonicalJson({ version: 1, files: manifest })))}`;
  return {
    digest,
    fileCount: files.length,
    totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
    manifest,
    files,
  };
}
