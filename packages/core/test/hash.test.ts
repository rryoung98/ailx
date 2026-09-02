import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { crc32 as zlibCrc32 } from "node:zlib";
import { canonicalJson, crc32, sha256Bytes, sha256Hex } from "../src/hash.js";
import { itemId, judgmentId, rubricVersion } from "../src/content-address.js";
import type { Judgment } from "../src/plugin.js";

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

  it("serializes representable numbers with JSON semantics (exponents kept)", () => {
    expect(canonicalJson({ n: 1e21 })).toBe('{"n":1e+21}');
    expect(canonicalJson({ n: 0.1 })).toBe('{"n":0.1}');
    expect(canonicalJson({ n: 0 })).toBe('{"n":0}');
    expect(canonicalJson({ n: Number.MAX_SAFE_INTEGER })).toBe('{"n":9007199254740991}');
  });

  it("keeps null, which JSON represents exactly", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
    expect(canonicalJson([null, 1])).toBe("[null,1]");
  });

  it("does not mutate its input", () => {
    const input = { b: [1, { z: 1, a: 2 }], a: 0 };
    const before = JSON.stringify(input);
    canonicalJson(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Injectivity at the hashing boundary. JSON.stringify collapses -0 into 0,
// NaN/Infinity into null and an undefined-valued property into that property's
// absence; content addressing that aliases two different values is not content
// addressing. canonicalJson refuses them, so itemId/judgmentId cannot mint one
// id for two judgments.
// ---------------------------------------------------------------------------

describe("canonicalJson rejects values JSON cannot represent", () => {
  const rejected: ReadonlyArray<readonly [string, unknown, RegExp]> = [
    ["negative zero", { n: -0 }, /negative zero at \$\.n/],
    ["NaN", { n: NaN }, /non-finite number NaN at \$\.n/],
    ["Infinity", { n: Infinity }, /non-finite number Infinity at \$\.n/],
    ["-Infinity", { n: -Infinity }, /non-finite number -Infinity at \$\.n/],
    ["a top-level undefined", undefined, /undefined at \$/],
    ["a top-level NaN", NaN, /non-finite number NaN at \$/],
    ["an undefined-valued property", { a: undefined, b: 1 }, /undefined at \$\.a/],
    ["an undefined array element", [undefined, 1], /undefined at \$\[0\]/],
    // eslint-disable-next-line no-sparse-arrays
    ["an array HOLE", [, 1], /undefined at \$\[0\]/],
    ["a nested -0", { a: { b: [1, { c: -0 }] } }, /negative zero at \$\.a\.b\[1\]\.c/],
    ["a nested undefined", { a: [{ b: undefined }] }, /undefined at \$\.a\[0\]\.b/],
    ["a function", { f: () => 1 }, /a function at \$\.f/],
    ["a symbol", { s: Symbol("x") }, /a symbol at \$\.s/],
    ["a bigint", { n: 1n }, /a bigint at \$\.n/],
  ];

  for (const [name, value, message] of rejected) {
    it(`throws on ${name}`, () => {
      expect(() => canonicalJson(value)).toThrow(message);
    });
  }

  it("names canonicalJson in the error so the caller knows which boundary refused", () => {
    expect(() => canonicalJson({ n: NaN })).toThrow(/^canonicalJson: refusing to content-address/);
  });

  it("still encodes the representable neighbours of every rejected value", () => {
    expect(canonicalJson({ n: 0 })).toBe('{"n":0}');
    expect(canonicalJson({ b: 1 })).toBe('{"b":1}');
    expect(canonicalJson([null, 1])).toBe("[null,1]");
    expect(canonicalJson({ a: { b: [1, { c: 0 }] } })).toBe('{"a":{"b":[1,{"c":0}]}}');
  });

  it("propagates through itemId and judgmentId — ids are never minted for aliased values", () => {
    // The exact aliasing JSON.stringify would have produced: these pairs would
    // otherwise share one id.
    expect(() => itemId({ n: -0 })).toThrow(/negative zero/);
    expect(() => itemId({ a: undefined, b: 1 })).toThrow(/undefined/);
    const judgment: Judgment = { dimension: "d", sample: 0, value: 1, modelId: "m" };
    expect(() => judgmentId({ ...judgment, value: NaN })).toThrow(/non-finite number NaN/);
    expect(() => judgmentId({ ...judgment, evidence: undefined })).toThrow(/undefined at \$\.evidence/);
    // An absent optional field is a different, legal value — and hashes.
    expect(judgmentId(judgment)).toMatch(/^[0-9a-f]{64}$/);
    expect(judgmentId(judgment)).not.toBe(judgmentId({ ...judgment, evidence: "" }));
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
