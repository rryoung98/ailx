import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { canonicalJson as coreCanonicalJson, itemId as coreItemId, rubricVersion as coreRubricVersion } from "@ailx/core";
import { canonicalJson, itemId, rubricVersionOf, seededUniform, sha256Hex } from "../src/index.js";

const SAMPLES = [
  "",
  "abc",
  "The quick brown fox jumps over the lazy dog",
  "unicode \u3053\u3093\u306b\u3061\u306f \ud55c\uad6d\uc5b4 \u00e9\u00e8\u00ea \ud83d\ude80",
  "x".repeat(10_000),
  JSON.stringify({ a: 1, b: [2, 3], c: { d: null } }),
];

describe("sha256Hex", () => {
  it("matches node:crypto for ascii, unicode and long inputs", () => {
    for (const s of SAMPLES) {
      const ref = createHash("sha256").update(s).digest("hex");
      expect(sha256Hex(s)).toBe(ref);
    }
  });
});

describe("canonical JSON + itemId parity with @ailx/core", () => {
  const items = [
    { id: "t2-item-001", kind: "media", label: "synthetic", locale: { en: "A", ja: "B" } },
    { z: 1, a: { nested: [3, { y: 2, x: 1 }] }, m: null },
    [1, "two", { b: 2, a: 1 }],
  ];
  it("canonicalJson matches the core reference implementation", () => {
    for (const item of items) {
      expect(canonicalJson(item)).toBe(coreCanonicalJson(item));
    }
  });
  it("itemId matches the core reference implementation", () => {
    for (const item of items) {
      expect(itemId(item)).toBe(coreItemId(item));
    }
  });
  it("an edited item is a NEW item (different id)", () => {
    const a = { stem: "Is this photograph authentic?", key: "synthetic" };
    const b = { ...a, stem: "Is this photograph authentic?!" };
    expect(itemId(a)).not.toBe(itemId(b));
  });
  it("key order does not change the id", () => {
    expect(itemId({ a: 1, b: 2 })).toBe(itemId({ b: 2, a: 1 }));
  });
});

describe("rubricVersionOf", () => {
  it("matches @ailx/core rubricVersion chaining byte-for-byte", () => {
    const cases = [
      [],
      ["rubric v1"],
      ["rubric v1", "screening prompt en", "screening prompt ja"],
      ["\u30eb\u30fc\u30d6\u30ea\u30c3\u30af", "\ud504\ub86c\ud504\ud2b8"],
    ];
    for (const parts of cases) {
      expect(rubricVersionOf(parts)).toBe(coreRubricVersion(parts));
    }
  });
  it("changing a prompt is a version bump", () => {
    expect(rubricVersionOf(["r", "p1"])).not.toBe(rubricVersionOf(["r", "p2"]));
  });
});

describe("seededUniform", () => {
  it("is deterministic and in [0, 1)", () => {
    for (let i = 0; i < 50; i++) {
      const u = seededUniform("demo", i);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      expect(seededUniform("demo", i)).toBe(u);
    }
    expect(seededUniform("demo", 1)).not.toBe(seededUniform("demo", 2));
    expect(seededUniform("a", 1)).not.toBe(seededUniform("b", 1));
  });
});
