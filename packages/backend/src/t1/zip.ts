/**
 * Strict, minimal ZIP reader for T1 site submissions — spec §12 "No build
 * step". Deliberately hand-rolled rather than a general-purpose library: this
 * is a security validator, so anything unusual is REJECTED instead of
 * tolerated — encryption, zip64, multi-disk archives, compression methods
 * other than store/deflate, undecodable filenames, CRC mismatches, declared
 * sizes that disagree with reality.
 *
 * Pure in the scoring sense: bytes in → entries out, no I/O, no clock, no
 * randomness (node:zlib inflateRawSync is deterministic). Size limits are
 * enforced HERE, before any inflation, so a zip bomb is refused from its
 * declared sizes without ever being decompressed.
 */

import { inflateRawSync } from "node:zlib";
import { crc32 } from "@ailx/core";
import { SnapshotError } from "./errors.js";

// Re-exported so backend test fixtures keep a single import site.
export { crc32 };

export interface ZipLimits {
  /** Maximum number of file entries (directories excluded). */
  maxFiles: number;
  /** Maximum uncompressed size of a single file, bytes. */
  maxFileBytes: number;
  /** Maximum total uncompressed size, bytes. */
  maxTotalBytes: number;
}

export interface ZipEntry {
  /** Entry name exactly as stored (path policy is snapshot.ts's job). */
  path: string;
  /** Decompressed, CRC-verified content. */
  data: Uint8Array;
  /** Unix symlink bit from the central directory (rejected by policy later). */
  isSymlink: boolean;
}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 0xffff;
const ZIP64_U16 = 0xffff;
const ZIP64_U32 = 0xffffffff;

function bad(message: string): never {
  throw new SnapshotError("bad_zip", message);
}

function unsupported(message: string): never {
  throw new SnapshotError("unsupported_zip", message);
}

const UTF8 = new TextDecoder("utf-8", { fatal: true });

/**
 * Parse and decompress every file entry, enforcing `limits` on DECLARED sizes
 * before touching compressed bytes. Directory entries are skipped. Throws
 * SnapshotError("bad_zip" | "unsupported_zip" | size codes) — never returns a
 * partially-trusted result.
 */
export function readZip(buf: Uint8Array, limits: ZipLimits): ZipEntry[] {
  if (buf.length < EOCD_MIN) bad("too small to be a ZIP archive");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // End-of-central-directory: scan backwards through a possible comment.
  let eocd = -1;
  const scanFloor = Math.max(0, buf.length - EOCD_MIN - MAX_COMMENT);
  for (let i = buf.length - EOCD_MIN; i >= scanFloor; i--) {
    if (dv.getUint32(i, true) === SIG_EOCD && dv.getUint16(i + 20, true) === buf.length - i - EOCD_MIN) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) bad("end-of-central-directory record not found — not a ZIP archive");

  const diskNum = dv.getUint16(eocd + 4, true);
  const cdDisk = dv.getUint16(eocd + 6, true);
  const entriesOnDisk = dv.getUint16(eocd + 8, true);
  const totalEntries = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (diskNum !== 0 || cdDisk !== 0 || entriesOnDisk !== totalEntries) {
    unsupported("multi-disk archives are not supported");
  }
  if (totalEntries === ZIP64_U16 || cdSize === ZIP64_U32 || cdOffset === ZIP64_U32) {
    unsupported("zip64 archives are not supported");
  }
  if (totalEntries > limits.maxFiles) {
    throw new SnapshotError("too_many_files", `archive declares ${totalEntries} entries (limit ${limits.maxFiles})`);
  }
  if (cdOffset + cdSize > eocd) bad("central directory extends past its end record");

  const entries: ZipEntry[] = [];
  let totalBytes = 0;
  let p = cdOffset;
  for (let n = 0; n < totalEntries; n++) {
    if (p + 46 > cdOffset + cdSize) bad("central directory truncated");
    if (dv.getUint32(p, true) !== SIG_CENTRAL) bad("bad central directory entry signature");
    const madeByOs = dv.getUint8(p + 5);
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const compSize = dv.getUint32(p + 20, true);
    const uncompSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const extAttrs = dv.getUint32(p + 38, true);
    const localOffset = dv.getUint32(p + 42, true);
    if (p + 46 + nameLen > cdOffset + cdSize) bad("central directory entry name truncated");

    if (flags & 0x1) unsupported("encrypted entries are not supported");
    if (compSize === ZIP64_U32 || uncompSize === ZIP64_U32 || localOffset === ZIP64_U32) {
      unsupported("zip64 entries are not supported");
    }

    let path: string;
    try {
      path = UTF8.decode(buf.subarray(p + 46, p + 46 + nameLen));
    } catch {
      bad("entry name is not valid UTF-8");
    }
    p += 46 + nameLen + extraLen + commentLen;

    const unixMode = madeByOs === 3 ? extAttrs >>> 16 : 0;
    const isDirectory = path.endsWith("/") || (unixMode & 0xf000) === 0x4000;
    if (isDirectory) {
      if (uncompSize !== 0) bad(`directory entry ${path} declares content`);
      continue; // Directories carry no bytes; file paths imply their tree.
    }

    if (method !== 0 && method !== 8) {
      unsupported(`compression method ${method} is not supported (store/deflate only)`);
    }
    // Declared-size limits BEFORE any decompression — the zip-bomb gate.
    if (uncompSize > limits.maxFileBytes) {
      throw new SnapshotError("file_too_large", `${path} declares ${uncompSize} bytes (limit ${limits.maxFileBytes})`);
    }
    totalBytes += uncompSize;
    if (totalBytes > limits.maxTotalBytes) {
      throw new SnapshotError("total_too_large", `total uncompressed size exceeds ${limits.maxTotalBytes} bytes`);
    }

    // Local header: name/extra lengths there can differ from the central copy.
    if (localOffset + 30 > buf.length) bad(`local header for ${path} out of bounds`);
    if (dv.getUint32(localOffset, true) !== SIG_LOCAL) bad(`bad local header signature for ${path}`);
    const lNameLen = dv.getUint16(localOffset + 26, true);
    const lExtraLen = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    if (dataStart + compSize > buf.length) bad(`compressed data for ${path} out of bounds`);
    const compressed = buf.subarray(dataStart, dataStart + compSize);

    let data: Uint8Array;
    if (method === 0) {
      if (compSize !== uncompSize) bad(`stored entry ${path} has inconsistent sizes`);
      data = Uint8Array.from(compressed);
    } else {
      try {
        // maxOutputLength backstops the declared size — inflation can never
        // produce more bytes than the entry admitted to.
        data = new Uint8Array(inflateRawSync(compressed, { maxOutputLength: uncompSize }));
      } catch {
        bad(`corrupt deflate stream in ${path}`);
      }
      if (data.length !== uncompSize) bad(`${path} inflated to ${data.length} bytes, declared ${uncompSize}`);
    }
    if (crc32(data) !== crc) bad(`CRC mismatch in ${path}`);

    entries.push({ path, data, isSymlink: madeByOs === 3 && (unixMode & 0xf000) === 0xa000 });
  }
  return entries;
}
