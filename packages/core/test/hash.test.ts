import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { crc32 as zlibCrc32 } from "node:zlib";
import { canonicalJson, crc32, sha256Bytes, sha256Hex } from "../src/hash.js";
import { itemId, rubricVersion } from "../src/content-address.js";

// ---------------------------------------------------------------------------
// sha256 — locked against FIPS 180-4 vectors and node:crypto.
// ---------------------------------------------------------------------------

describe("sha256Hex", () => {
  it("matches the FIPS 180-4 known-answer vectors", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("matches node:crypto across block-boundary lengths, unicode and long input", () => {
    const samples = [
      "", "a", "abc",
      "x".repeat(55), "x".repeat(56), "x".repeat(63), "x".repeat(64), "x".repeat(65),
      "x".repeat(10_000),
      "unicode \u3053\u3093\u306b\u3061\u306f \ud55c\uad6d\uc5b4 \u00e9\u00e8\u00ea \ud83d\ude80",
      JSON.stringify({ a: 1, b: [2, 3], c: { d: null } }),
    ];
    for (const s of samples) {
      expect(sha256Hex(s)).toBe(createHash("sha256").update(s).digest("hex"));
    }
  });

  it("accepts raw bytes and hashes them identically to node:crypto", () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 254, 128, 64]);
    expect(sha256Hex(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
});

describe("sha256Bytes", () => {
  it("returns the raw 32-byte digest matching node:crypto", () => {
    for (const s of ["", "abc", "rubric v1"]) {
      expect(Buffer.from(sha256Bytes(s))).toEqual(createHash("sha256").update(s).digest());
    }
  });
});

// ---------------------------------------------------------------------------
// crc32 — shared by the backend ZIP validator and the client ZIP writer.
// ---------------------------------------------------------------------------

describe("crc32", () => {
  it("matches the ISO 3309 check vector", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("matches node:zlib across empty, binary and long inputs", () => {
    const samples = [
      new Uint8Array(0),
      new Uint8Array([0, 1, 2, 255, 254, 128, 64]),
      new TextEncoder().encode("x".repeat(10_000)),
      new TextEncoder().encode("<!doctype html><html>\u3053\u3093\u306b\u3061\u306f</html>"),
    ];
    for (const s of samples) {
      expect(crc32(s)).toBe(zlibCrc32(s));
    }
  });
});

// ---------------------------------------------------------------------------
// canonicalJson — the single canonical serialization for content addressing.
// ---------------------------------------------------------------------------

describe("canonicalJson", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [{ z: 0, y: 1 }] } })).toBe(
      '{"a":{"c":[{"y":1,"z":0}],"d":2},"b":1}',
    );
  });

  it("preserves array order (arrays are ordered, only keys sort)", () => {
    expect(canonicalJson([3, 1, 2, [{ b: 1, a: 2 }]])).toBe('[3,1,2,[{"a":2,"b":1}]]');
  });

  it("emits no insignificant whitespace", () => {
    expect(canonicalJson({ a: [1, 2], b: { c: 3 } })).toBe('{"a":[1,2],"b":{"c":3}}');
  });

  it("keeps unicode strings as JSON.stringify emits them", () => {
    const v = { s: "\u3053\u3093\u306b\u3061\u306f \ud83d\ude80 \u00e9" };
    expect(canonicalJson(v)).toBe(JSON.stringify(v));
  });

  it("serializes numbers with JSON semantics (-0 collapses, exponents kept)", () => {
    expect(canonicalJson({ n: -0 })).toBe('{"n":0}');
    expect(canonicalJson({ n: 1e21 })).toBe('{"n":1e+21}');
    expect(canonicalJson({ n: 0.1 })).toBe('{"n":0.1}');
  });

  it("follows JSON semantics for null / undefined / non-finite numbers", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
    // undefined object values are dropped; undefined array slots become null.
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson([undefined, 1])).toBe("[null,1]");
    // JSON.stringify(undefined) is undefined — callers must not address it.
    expect(canonicalJson(undefined)).toBeUndefined();
    expect(canonicalJson({ a: NaN, b: Infinity })).toBe('{"a":null,"b":null}');
  });

  it("does not mutate its input", () => {
    const input = { b: [1, { z: 1, a: 2 }], a: 0 };
    const before = JSON.stringify(input);
    canonicalJson(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Regression locks: these digests were produced by the pre-consolidation
// node:crypto implementation. They must NEVER change (spec §14 invariant:
// any score ever issued is byte-identically recomputable).
// ---------------------------------------------------------------------------

describe("content-address regression vectors", () => {
  it("itemId is locked byte-for-byte", () => {
    expect(itemId({ a: 1, b: [2, 3], c: { d: null } })).toBe(
      "8b0fba87926ba9ef2bfae35db2c5ab5f0996f0142a9ea319ae6c97d581c0f7a9",
    );
    // key order must not matter
    expect(itemId({ c: { d: null }, b: [2, 3], a: 1 })).toBe(
      "8b0fba87926ba9ef2bfae35db2c5ab5f0996f0142a9ea319ae6c97d581c0f7a9",
    );
  });

  it("rubricVersion is locked byte-for-byte", () => {
    expect(rubricVersion([])).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(rubricVersion(["rubric v1", "prompt en"])).toBe(
      "eef810da881e2365e6084d0f8329bf434086229457f7ee8baff69fe008464a45",
    );
  });

  it("rubricVersion matches node:crypto digest chaining for arbitrary parts", () => {
    const cases = [[], ["a"], ["a", "b"], ["\u30eb\u30fc\u30d6\u30ea\u30c3\u30af", "\ud504\ub86c\ud504\ud2b8"]];
    for (const parts of cases) {
      const h = createHash("sha256");
      for (const p of parts) h.update(createHash("sha256").update(p).digest());
      expect(rubricVersion(parts)).toBe(h.digest("hex"));
    }
  });
});
