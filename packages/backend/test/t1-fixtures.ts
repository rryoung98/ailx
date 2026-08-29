/**
 * Test-only ZIP builder — hand-rolls local headers, central directory and
 * EOCD so tests can produce both honest archives and hostile ones (bad CRCs,
 * lying sizes, encrypted flags, symlink modes, zip64 markers).
 */

import { deflateRawSync } from "node:zlib";
import { crc32 } from "../src/t1/zip.js";

export interface FixtureEntry {
  path: string;
  data?: string | Uint8Array;
  /** 0 = store, 8 = deflate (default). Anything else is written verbatim. */
  method?: number;
  /** Mark as a unix symlink in the central directory. */
  symlink?: boolean;
  /** General-purpose flags override (e.g. 0x1 = encrypted). */
  flags?: number;
  /** Lie about the CRC. */
  crcOverride?: number;
  /** Lie about the uncompressed size. */
  uncompSizeOverride?: number;
  /** Central-directory "made by" OS byte (default 3 = unix). */
  madeByOs?: number;
}

export interface FixtureOptions {
  /** Override the EOCD entry counts (e.g. 0xffff to fake zip64). */
  totalEntriesOverride?: number;
  /** Trailing archive comment. */
  comment?: string;
}

function u16(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff];
}

function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

export function buildZip(entries: FixtureEntry[], opts: FixtureOptions = {}): Uint8Array {
  const chunks: number[] = [];
  const central: number[] = [];

  for (const entry of entries) {
    const raw = typeof entry.data === "string" ? new TextEncoder().encode(entry.data) : (entry.data ?? new Uint8Array());
    const method = entry.method ?? 8;
    const compressed = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
    const crc = entry.crcOverride ?? crc32(raw);
    const uncompSize = entry.uncompSizeOverride ?? raw.length;
    const flags = entry.flags ?? 0;
    const name = new TextEncoder().encode(entry.path);
    const localOffset = chunks.length;

    chunks.push(
      ...u32(0x04034b50), ...u16(20), ...u16(flags), ...u16(method),
      ...u16(0), ...u16(0), // mod time/date
      ...u32(crc), ...u32(compressed.length), ...u32(uncompSize),
      ...u16(name.length), ...u16(0),
      ...name, ...compressed,
    );

    const isDir = entry.path.endsWith("/");
    const mode = entry.symlink ? 0xa1ff : isDir ? 0x41ed : 0x81a4;
    const madeBy = ((entry.madeByOs ?? 3) << 8) | 20;
    central.push(
      ...u32(0x02014b50), ...u16(madeBy), ...u16(20), ...u16(flags), ...u16(method),
      ...u16(0), ...u16(0),
      ...u32(crc), ...u32(compressed.length), ...u32(uncompSize),
      ...u16(name.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), // disk start, internal attrs
      ...u32(mode << 16),
      ...u32(localOffset),
      ...name,
    );
  }

  const cdOffset = chunks.length;
  chunks.push(...central);
  const cdSize = chunks.length - cdOffset;
  const total = opts.totalEntriesOverride ?? entries.length;
  const comment = new TextEncoder().encode(opts.comment ?? "");
  chunks.push(
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(total), ...u16(total),
    ...u32(cdSize), ...u32(cdOffset),
    ...u16(comment.length), ...comment,
  );
  return Uint8Array.from(chunks);
}

/** A minimal valid site: index.html plus any extra files. */
export function siteZip(extra: Record<string, string | Uint8Array> = {}, index = "<h1>hi</h1>"): Uint8Array {
  const entries: FixtureEntry[] = [{ path: "index.html", data: index }];
  for (const [path, data] of Object.entries(extra)) entries.push({ path, data });
  return buildZip(entries);
}
