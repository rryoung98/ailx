/**
 * Deterministic, store-only ZIP writer — the byte-level mirror of the T1
 * submission validator (`readZip` in @ailx/backend/t1).
 *
 * Lives in @ailx/core, not in the backend, because BOTH ends need it and
 * neither may own it alone: the browser packs the T1 artifact before it is
 * uploaded, and the server repacks a stored snapshot when the candidate
 * exports it. One writer means one set of bytes — a downloaded export
 * re-uploads to the SAME content address it was scored under.
 *
 * Pure and deterministic by construction: every entry is stored (method 0),
 * every timestamp is zeroed, no extra fields, no zip64, no comments. The
 * same files in the same order always produce the same bytes.
 */

import { crc32 } from "./hash.js";

export interface ZipFile {
  /** Archive-relative path, `/`-separated. Written verbatim as UTF-8. */
  path: string;
  data: Uint8Array;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/** Sizes and counts a ZIP header cannot express — see `writeStoredZip`. */
const MAX_ENTRIES = 0xffff;
const MAX_U32 = 0xffffffff;

/**
 * Build a ZIP archive with every entry stored (method 0) and all timestamps
 * zeroed.
 *
 * Throws RangeError rather than emitting a header that silently truncates:
 * the classic zip32 fields are 16/32 bits wide, and writing 0xffff/0xffffffff
 * into one is the zip64 escape marker, which this writer (and the validator
 * it mirrors) does not support. T1 caps every submission far below these, so
 * the throw is a guard against a future caller, not a path a candidate hits.
 */
export function writeStoredZip(files: readonly ZipFile[]): Uint8Array<ArrayBuffer> {
  if (files.length > MAX_ENTRIES) {
    throw new RangeError(`a stored ZIP holds at most ${MAX_ENTRIES} entries (got ${files.length})`);
  }
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.path);
    if (name.length > MAX_ENTRIES) {
      throw new RangeError(`entry name is too long for a ZIP header: ${f.path}`);
    }
    if (f.data.length > MAX_U32 || offset > MAX_U32) {
      throw new RangeError("archive is too large for a non-zip64 ZIP");
    }
    const crc = crc32(f.data);

    const local = new Uint8Array(30 + name.length + f.data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, SIG_LOCAL, true);
    lv.setUint16(4, 20, true); // version needed: 2.0
    // flags(6), method(8: store), dos time(10), dos date(12) all stay 0.
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true); // compressed == uncompressed (store)
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    // extra length(28) stays 0.
    local.set(name, 30);
    local.set(f.data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, SIG_CENTRAL, true);
    cv.setUint16(4, 20, true); // version made by: 2.0, host 0 (DOS — no unix attrs)
    cv.setUint16(6, 20, true); // version needed
    // flags/method/time/date (8..14) stay 0.
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    // extra/comment lengths, disk, attributes (30..41) stay 0.
    cv.setUint32(42, offset, true); // local header offset
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }

  const cdSize = centrals.reduce((a, c) => a + c.length, 0);
  if (cdSize > MAX_U32) throw new RangeError("archive is too large for a non-zip64 ZIP");
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const chunk of [...locals, ...centrals]) {
    out.set(chunk, p);
    p += chunk.length;
  }
  const ev = new DataView(out.buffer, p);
  ev.setUint32(0, SIG_EOCD, true);
  // disk numbers (4, 6) stay 0.
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  // comment length (20) stays 0.
  return out;
}
