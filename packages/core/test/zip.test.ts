import { describe, expect, it } from "vitest";
import { crc32, writeStoredZip } from "../src/index.js";

const utf8 = (s: string) => new TextEncoder().encode(s);

/** Minimal EOCD reader — enough to assert the writer's own header fields. */
function eocd(zip: Uint8Array): { entries: number; cdSize: number; cdOffset: number } {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const at = zip.length - 22;
  expect(dv.getUint32(at, true)).toBe(0x06054b50);
  return {
    entries: dv.getUint16(at + 8, true),
    cdSize: dv.getUint32(at + 12, true),
    cdOffset: dv.getUint32(at + 16, true),
  };
}

describe("writeStoredZip", () => {
  it("is deterministic — same files, byte-identical archive", () => {
    const files = [
      { path: "index.html", data: utf8("<h1>hi</h1>") },
      { path: "assets/app.css", data: utf8("body{}") },
    ];
    expect(writeStoredZip(files)).toEqual(writeStoredZip(files));
  });

  it("stores entries uncompressed with zeroed timestamps", () => {
    const data = utf8("<h1>hi</h1>");
    const zip = writeStoredZip([{ path: "index.html", data }]);
    const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    expect(dv.getUint16(6, true)).toBe(0); // flags
    expect(dv.getUint16(8, true)).toBe(0); // method: store
    expect(dv.getUint16(10, true)).toBe(0); // dos time
    expect(dv.getUint16(12, true)).toBe(0); // dos date
    expect(dv.getUint32(14, true)).toBe(crc32(data));
    expect(dv.getUint32(18, true)).toBe(data.length); // compressed
    expect(dv.getUint32(22, true)).toBe(data.length); // uncompressed
    expect(dv.getUint16(28, true)).toBe(0); // no extra fields
  });

  it("writes one central-directory record per file, in argument order", () => {
    const files = [
      { path: "b.txt", data: utf8("b") },
      { path: "a.txt", data: utf8("aa") },
    ];
    const zip = writeStoredZip(files);
    const { entries, cdSize, cdOffset } = eocd(zip);
    expect(entries).toBe(2);
    expect(cdOffset + cdSize + 22).toBe(zip.length);
    const names: string[] = [];
    let at = cdOffset;
    const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (let i = 0; i < entries; i++) {
      expect(dv.getUint32(at, true)).toBe(0x02014b50);
      const nameLen = dv.getUint16(at + 28, true);
      names.push(new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLen)));
      at += 46 + nameLen;
    }
    expect(names).toEqual(["b.txt", "a.txt"]);
  });

  it("encodes non-ASCII paths as UTF-8", () => {
    const zip = writeStoredZip([{ path: "café/ünï.txt", data: utf8("x") }]);
    const name = utf8("café/ünï.txt");
    const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(dv.getUint16(26, true)).toBe(name.length);
    expect(zip.subarray(30, 30 + name.length)).toEqual(name);
  });

  it("writes a valid empty archive", () => {
    const zip = writeStoredZip([]);
    expect(zip.length).toBe(22);
    expect(eocd(zip)).toEqual({ entries: 0, cdSize: 0, cdOffset: 0 });
  });

  it("preserves raw binary bytes", () => {
    const data = new Uint8Array([0, 255, 13, 10, 26, 127]);
    const zip = writeStoredZip([{ path: "raw.bin", data }]);
    expect(zip.subarray(30 + 7, 30 + 7 + data.length)).toEqual(data);
  });

  it("refuses more entries than a zip32 header can count", () => {
    const files = Array.from({ length: 0x10000 }, (_, i) => ({ path: `${i}.txt`, data: utf8("x") }));
    expect(() => writeStoredZip(files)).toThrow(RangeError);
  });

  it("refuses an entry name longer than its 16-bit length field", () => {
    expect(() => writeStoredZip([{ path: "x".repeat(0x10000), data: utf8("x") }])).toThrow(RangeError);
  });
});
