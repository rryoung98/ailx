/**
 * Browser-safe, dependency-free SHA-256 + canonical JSON.
 *
 * `@ailx/core` provides the reference `itemId`/`canonicalJson` implementation
 * on top of `node:crypto`, which cannot ship in a static browser bundle.
 * This module re-implements both with identical output (verified by tests in
 * `test/hash.test.ts` against @ailx/core), so the showcase web app can run
 * content-addressing checks entirely client-side.
 */

/** Canonical JSON: stable key order, no insignificant whitespace (spec §14). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortValue((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

/** item_id = sha256(canonical_json(item)) — spec §14. */
export function itemId(item: unknown): string {
  return sha256Hex(canonicalJson(item));
}

// ---------------------------------------------------------------------------
// Pure-JS SHA-256 (FIPS 180-4). Synchronous, so it can run inside pure
// scoring code and inside the purity harness (crypto.subtle is async).
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

function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function sha256Hex(input: string | Uint8Array): string {
  const h = sha256Words(input);
  let out = "";
  for (let i = 0; i < 8; i++) out += h[i].toString(16).padStart(8, "0");
  return out;
}

/** Raw 32-byte digest — needed to replicate @ailx/core rubricVersion chaining. */
export function sha256Bytes(input: string | Uint8Array): Uint8Array {
  const h = sha256Words(input);
  const out = new Uint8Array(32);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) dv.setUint32(i * 4, h[i]);
  return out;
}

/**
 * rubric_version = hash(rubric + prompts) — byte-identical to
 * @ailx/core `rubricVersion` (verified by tests): the outer hash is updated
 * with the raw digest of each part in order.
 */
export function rubricVersionOf(parts: ReadonlyArray<string>): string {
  let acc = new Uint8Array(0);
  for (const p of parts) {
    const digest = sha256Bytes(p);
    const next = new Uint8Array(acc.length + digest.length);
    next.set(acc); next.set(digest, acc.length);
    acc = next;
  }
  return sha256Hex(acc);
}

function sha256Words(input: string | Uint8Array): Uint32Array {
  const data = typeof input === "string" ? utf8Bytes(input) : input;
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
  const wArr = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) wArr[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 =
        (rotr(wArr[i - 15], 7) ^ rotr(wArr[i - 15], 18) ^ (wArr[i - 15] >>> 3)) >>> 0;
      const s1 =
        (rotr(wArr[i - 2], 17) ^ rotr(wArr[i - 2], 19) ^ (wArr[i - 2] >>> 10)) >>> 0;
      wArr[i] = (wArr[i - 16] + s0 + wArr[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (hh + S1 + ch + K[i] + wArr[i]) >>> 0;
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

/**
 * Deterministic PRNG in [0, 1), seeded by sha256 of a string.
 * Used by demo simulators (judge, cohort) — same seed, same stream, forever.
 */
export function seededUniform(seed: string, index: number): number {
  const hex = sha256Hex(`${seed}:${index}`).slice(0, 13); // 52 bits
  return parseInt(hex, 16) / 2 ** 52;
}
