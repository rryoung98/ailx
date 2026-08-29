/**
 * Pure deck sampler — determinism, composition invariants, and thin-strata
 * edge cases. Same (candidates, seed) must be byte-identical forever: a
 * recorded attempt deck is re-derived from stored inputs alone.
 */
import { describe, expect, it } from "vitest";
import { sampleT2DeckIds, t2DeckSeed, type T2DeckCandidate } from "../src/deck.js";

const BANK_SHA = "a".repeat(64);

function bank(): T2DeckCandidate[] {
  const out: T2DeckCandidate[] = [];
  const diffs = [0.25, 0.5, 0.85];
  for (let i = 0; i < 12; i++) {
    out.push({ id: `m-ai-${i}`, kind: "media", signal: true, difficulty: diffs[i % 3] });
    out.push({ id: `m-real-${i}`, kind: "media", signal: false, difficulty: diffs[(i + 1) % 3] });
  }
  for (let i = 0; i < 4; i++) {
    out.push({ id: `t-ai-${i}`, kind: "text", signal: true, difficulty: 0.5 });
    out.push({ id: `t-real-${i}`, kind: "text", signal: false, difficulty: 0.5 });
    out.push({ id: `p-${i}`, kind: "provenance", signal: false, difficulty: 0.5 });
  }
  return out;
}

const byId = new Map(bank().map((c) => [c.id, c]));
const kindOf = (id: string) => byId.get(id)!.kind;
const isSignal = (id: string) => byId.get(id)!.signal;

describe("t2DeckSeed", () => {
  it("is deterministic and distinct per attempt AND per bank hash", () => {
    expect(t2DeckSeed("att-1", BANK_SHA)).toBe(t2DeckSeed("att-1", BANK_SHA));
    expect(t2DeckSeed("att-1", BANK_SHA)).not.toBe(t2DeckSeed("att-2", BANK_SHA));
    expect(t2DeckSeed("att-1", BANK_SHA)).not.toBe(t2DeckSeed("att-1", "b".repeat(64)));
    expect(t2DeckSeed("att-1", BANK_SHA)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("sampleT2DeckIds", () => {
  it("same seed \u2192 byte-identical deck; different seeds vary", () => {
    const seeds = [...Array(20).keys()].map((k) => t2DeckSeed(`att-${k}`, BANK_SHA));
    for (const s of seeds) {
      expect(JSON.stringify(sampleT2DeckIds(bank(), s))).toBe(
        JSON.stringify(sampleT2DeckIds(bank(), s)),
      );
    }
    const distinct = new Set(seeds.map((s) => sampleT2DeckIds(bank(), s).join("|")));
    expect(distinct.size).toBeGreaterThan(10);
  });

  it("no seed \u2192 fixed default deck (first-in-order picks)", () => {
    const a = sampleT2DeckIds(bank());
    expect(a).toEqual(sampleT2DeckIds(bank()));
    expect(a).toHaveLength(6);
    expect(a[0]).toBe("m-ai-0"); // bank order, AI first in the default pair
    expect(a.slice(2, 4)).toEqual(["t-ai-0", "t-real-0"]);
    expect(a.slice(4)).toEqual(["p-0", "p-1"]);
  });

  it("holds composition invariants across many seeds", () => {
    for (let k = 0; k < 25; k++) {
      const deck = sampleT2DeckIds(bank(), t2DeckSeed(`att-${k}`, BANK_SHA));
      expect(deck).toHaveLength(6);
      expect(new Set(deck).size).toBe(6);
      const media = deck.filter((id) => kindOf(id) === "media");
      const text = deck.filter((id) => kindOf(id) === "text");
      const prov = deck.filter((id) => kindOf(id) === "provenance");
      expect(media).toHaveLength(2);
      expect(text).toHaveLength(2);
      expect(prov).toHaveLength(2);
      // Media lead the deck; both binary blocks are class-balanced.
      expect(deck.slice(0, 2)).toEqual(media);
      expect(media.filter(isSignal)).toHaveLength(1);
      expect(text.filter(isSignal)).toHaveLength(1);
      // The 1-vs-1 media pair is difficulty-matched (never class-confounded).
      const [ai] = media.filter(isSignal);
      const [real] = media.filter((id) => !isSignal(id));
      expect(
        Math.abs(byId.get(ai)!.difficulty - byId.get(real)!.difficulty),
      ).toBeLessThanOrEqual(0.35);
    }
  });

  it("media block needs BOTH classes \u2014 never an unmatched half-pair", () => {
    const noReal = bank().filter((c) => !(c.kind === "media" && !c.signal));
    for (const seed of [undefined, t2DeckSeed("att-x", BANK_SHA)]) {
      const deck = sampleT2DeckIds(noReal, seed);
      expect(deck.filter((id) => kindOf(id) === "media")).toHaveLength(0);
      expect(deck).toHaveLength(4); // text pair + provenance pair remain
    }
  });

  it("missing text class back-fills from the remaining text pool", () => {
    const noBenign = bank().filter((c) => !(c.kind === "text" && !c.signal));
    for (const seed of [undefined, t2DeckSeed("att-y", BANK_SHA)]) {
      const text = sampleT2DeckIds(noBenign, seed).filter((id) => kindOf(id) === "text");
      expect(text).toHaveLength(2);
      expect(text.every(isSignal)).toBe(true);
    }
  });

  it("thin pools shrink blocks without crashing", () => {
    expect(sampleT2DeckIds([])).toEqual([]);
    expect(sampleT2DeckIds([], t2DeckSeed("att-z", BANK_SHA))).toEqual([]);
    const onlyProv: T2DeckCandidate[] = [
      { id: "p-solo", kind: "provenance", signal: false, difficulty: 0.5 },
    ];
    expect(sampleT2DeckIds(onlyProv, t2DeckSeed("att-z", BANK_SHA))).toEqual(["p-solo"]);
    const oneText: T2DeckCandidate[] = [
      { id: "t-solo", kind: "text", signal: true, difficulty: 0.5 },
    ];
    expect(sampleT2DeckIds(oneText, t2DeckSeed("att-z", BANK_SHA))).toEqual(["t-solo"]);
  });
});
