/**
 * Browser-safe, dependency-free SHA-256 + canonical JSON — the single shared
 * implementation for the whole repo (content addressing is a core invariant,
 * so there is exactly ONE place a hashing bug can live).
 *
 * Pure TypeScript, no node:crypto and no crypto.subtle: it must run inside a
 * static browser bundle, and synchronously inside pure score() code and the
 * purity harness (crypto.subtle is async). Output is verified byte-for-byte
 * against node:crypto in test/hash.test.ts.
 */

/**
 * Canonical JSON: stable key order, no insignificant whitespace (spec §14).
 *
 * REJECTS AT THE BOUNDARY. Plain `JSON.stringify` is LOSSY: it collapses -0
 * into 0, NaN/Infinity/-Infinity into null, and an own property explicitly set
 * to `undefined` into that property's absence. Content addressing that is not
 * injective is not content addressing — two different judgments would share
 * one judgmentId and the "byte-identically recomputable" invariant would be
 * unfalsifiable. Every one of those values is a BUG upstream, never something
 * we want silently aliased, so the encoder throws instead of encoding.
 *
 * The check lives HERE, inside the single encoder, and not in a validating
 * wrapper used only by itemId/judgmentId: there is exactly ONE canonical
 * encoder in this repo (see the module comment above), every content address
 * and every canonical bank line goes through it, and a second parallel encoder
 * — a lenient one and a strict one — is precisely the drift we consolidated
 * this module to prevent.
 *
 * What it does NOT check, on purpose: `toJSON()` carriers (a Date encodes as
 * its ISO string, as JSON demands), and key ordering/unicode escaping, which
 * are locked byte-for-byte by test/hash.test.ts and must never change.
 *
 * @throws {Error} on a non-finite number, on -0, on undefined/function/symbol/
 *   bigint anywhere (including the top level and array holes).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value, "$"));
}

function reject(path: string, what: string): never {
  throw new Error(
    `canonicalJson: refusing to content-address ${what} at ${path} ` +
      `(JSON cannot represent it losslessly, so hashing it would alias two different values)`,
  );
}

function sortValue(v: unknown, path: string): unknown {
  if (Array.isArray(v)) {
    // An indexed loop, not .map: .map SKIPS holes, and a hole is exactly the
    // undefined that JSON.stringify would silently write out as null.
    const out = new Array<unknown>(v.length);
    for (let i = 0; i < v.length; i++) out[i] = sortValue(v[i], `${path}[${i}]`);
    return out;
  }
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortValue((v as Record<string, unknown>)[k], `${path}.${k}`);
    }
    return out;
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) reject(path, `the non-finite number ${String(v)}`);
    // Object.is separates -0 from 0; JSON.stringify does not.
    if (Object.is(v, -0)) reject(path, "negative zero");
    return v;
  }
  if (v === undefined) reject(path, "undefined");
  if (typeof v === "function") reject(path, "a function");
  if (typeof v === "symbol") reject(path, "a symbol");
  if (typeof v === "bigint") reject(path, "a bigint");
  return v;
}

// ---------------------------------------------------------------------------
// Pure-JS SHA-256 (FIPS 180-4).
// ---------------------------------------------------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 of a UTF-8 string or raw bytes, as lowercase hex. */
export function sha256Hex(input: string | Uint8Array): string {
  const h = sha256Words(input);
  let out = "";
  for (let i = 0; i < 8; i++) out += h[i].toString(16).padStart(8, "0");
  return out;
}

/** Raw 32-byte digest — needed for digest chaining (rubricVersion). */
export function sha256Bytes(input: string | Uint8Array): Uint8Array {
  const h = sha256Words(input);
  const out = new Uint8Array(32);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) dv.setUint32(i * 4, h[i]);
  return out;
}

function sha256Words(input: string | Uint8Array): Uint32Array {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const bitLen = data.length * 8;
  // Pad: 0x80 then zeros to 56 mod 64, then 64-bit big-endian length.
  const padded = new Uint8Array((((data.length + 8) >> 6) + 1) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(padded.length - 4, bitLen >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return h;
}

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

// ---------------------------------------------------------------------------
// CRC-32 (ISO 3309) — shared by the backend ZIP validator (readZip) and the
// browser-side store-only ZIP writer, so both ends of the T1 site submission
// pipeline agree on entry checksums by construction.
// ---------------------------------------------------------------------------

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

/** CRC-32 of raw bytes as an unsigned 32-bit integer. */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
