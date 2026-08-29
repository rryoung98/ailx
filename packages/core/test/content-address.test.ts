import { describe, it, expect } from "vitest";
import { itemId, rubricVersion } from "../src/content-address.js";
import { canonicalJson } from "../src/hash.js";
import { runPure } from "../src/purity.js";

describe("canonicalJson", () => {
  it("is stable under key order", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] }))
      .toBe(canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
  });
});

describe("itemId", () => {
  it("changes when content changes", () => {
    expect(itemId({ stem: "x" })).not.toBe(itemId({ stem: "y" }));
  });
  it("is a sha256 hex digest", () => {
    expect(itemId({})).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("rubricVersion", () => {
  it("is order-sensitive and content-sensitive", () => {
    expect(rubricVersion(["a", "b"])).not.toBe(rubricVersion(["b", "a"]));
    expect(rubricVersion(["a"])).not.toBe(rubricVersion(["a", ""]));
  });
});

describe("runPure", () => {
  it("throws when score code calls Date.now", () => {
    expect(() => runPure(() => Date.now())).toThrow(/Purity violation/);
  });
  it("throws when score code calls Math.random", () => {
    expect(() => runPure(() => Math.random())).toThrow(/Purity violation/);
  });
  it("restores globals", () => {
    try { runPure(() => Math.random()); } catch {}
    expect(typeof Math.random()).toBe("number");
  });
});
