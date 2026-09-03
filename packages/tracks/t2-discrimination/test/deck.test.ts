/**
 * Pure deck sampler — determinism, composition invariants, and thin-strata
 * edge cases. Same (candidates, seed) must be byte-identical forever: a
 * recorded attempt deck is re-derived from stored inputs alone.
 */
import { describe, expect, it } from "vitest";
import {
  sampleT2DeckIds,
  t2DeckSeed,
  type T2DeckCandidate,
  type T2DeckComposition,
} from "../src/deck.js";

const BANK_SHA = "a".repeat(64);

/** The deck the shipped instruments declare (config.deck in t2's track.yaml). */
const DECK: T2DeckComposition = { mediaPairs: 1, text: 2, provenance: 2 };

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
      expect(JSON.stringify(sampleT2DeckIds(bank(), DECK, s))).toBe(
        JSON.stringify(sampleT2DeckIds(bank(), DECK, s)),
      );
    }
    const distinct = new Set(seeds.map((s) => sampleT2DeckIds(bank(), DECK, s).join("|")));
    expect(distinct.size).toBeGreaterThan(10);
  });

  it("no seed \u2192 fixed default deck (first-in-order picks)", () => {
    const a = sampleT2DeckIds(bank(), DECK);
    expect(a).toEqual(sampleT2DeckIds(bank(), DECK));
    expect(a).toHaveLength(6);
    expect(a[0]).toBe("m-ai-0"); // bank order, AI first in the default pair
    expect(a.slice(2, 4)).toEqual(["t-ai-0", "t-real-0"]);
    expect(a.slice(4)).toEqual(["p-0", "p-1"]);
  });

  it("holds composition invariants across many seeds", () => {
    for (let k = 0; k < 25; k++) {
      const deck = sampleT2DeckIds(bank(), DECK, t2DeckSeed(`att-${k}`, BANK_SHA));
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
      const deck = sampleT2DeckIds(noReal, DECK, seed);
      expect(deck.filter((id) => kindOf(id) === "media")).toHaveLength(0);
      expect(deck).toHaveLength(4); // text pair + provenance pair remain
    }
  });

  it("thin pools shrink blocks without crashing", () => {
    expect(sampleT2DeckIds([], DECK)).toEqual([]);
    expect(sampleT2DeckIds([], DECK, t2DeckSeed("att-z", BANK_SHA))).toEqual([]);
    const onlyProv: T2DeckCandidate[] = [
      { id: "p-solo", kind: "provenance", signal: false, difficulty: 0.5 },
    ];
    expect(sampleT2DeckIds(onlyProv, DECK, t2DeckSeed("att-z", BANK_SHA))).toEqual(["p-solo"]);
    const oneText: T2DeckCandidate[] = [
      { id: "t-solo", kind: "text", signal: true, difficulty: 0.5 },
    ];
    expect(sampleT2DeckIds(oneText, DECK, t2DeckSeed("att-z", BANK_SHA))).toEqual(["t-solo"]);
  });

  it("deals the DECLARED composition, not a fixed one", () => {
    const wide: T2DeckComposition = { mediaPairs: 2, text: 4, provenance: 1 };
    for (const seed of [undefined, t2DeckSeed("att-wide", BANK_SHA)]) {
      const deck = sampleT2DeckIds(bank(), wide, seed);
      expect(deck).toHaveLength(2 * 2 + 4 + 1);
      expect(new Set(deck).size).toBe(deck.length);
      const media = deck.filter((id) => kindOf(id) === "media");
      expect(media).toHaveLength(4);
      expect(media.filter(isSignal)).toHaveLength(2);
      expect(deck.slice(0, 4)).toEqual(media); // media still lead
      const text = deck.filter((id) => kindOf(id) === "text");
      expect(text).toHaveLength(4);
      expect(text.filter(isSignal)).toHaveLength(2); // still class-balanced
      expect(deck.filter((id) => kindOf(id) === "provenance")).toHaveLength(1);
    }
  });

  it("a stratum declared at zero is not dealt at all", () => {
    const noMedia: T2DeckComposition = { mediaPairs: 0, text: 2, provenance: 2 };
    for (const seed of [undefined, t2DeckSeed("att-nomedia", BANK_SHA)]) {
      const deck = sampleT2DeckIds(bank(), noMedia, seed);
      expect(deck.filter((id) => kindOf(id) === "media")).toHaveLength(0);
      expect(deck).toHaveLength(4);
    }
    expect(sampleT2DeckIds(bank(), { mediaPairs: 0, text: 0, provenance: 0 })).toEqual([]);
  });

  it("an odd text count stays as balanced as it can be", () => {
    const odd: T2DeckComposition = { mediaPairs: 0, text: 3, provenance: 0 };
    const deck = sampleT2DeckIds(bank(), odd, t2DeckSeed("att-odd", BANK_SHA));
    expect(deck).toHaveLength(3);
    expect(new Set(deck).size).toBe(3);
    expect(deck.filter(isSignal).length).toBeGreaterThanOrEqual(1);
    expect(deck.filter((id) => !isSignal(id)).length).toBeGreaterThanOrEqual(1);
  });

  /**
   * TEN-74. The backfill pool used to be rebuilt from the ORIGINAL bank
   * order, which lists every AI item before every real item, so the extra
   * item of an ODD text count was always the first remaining AI item. The
   * later presentation shuffle hid it: it reorders what was sampled, it does
   * not change what was sampled. d\u2032 is computed against a signal/noise
   * split, so a deck that leans one way deterministically does not average
   * out across candidates.
   */
  it("an odd text count draws its extra item from BOTH classes across seeds", () => {
    const odd: T2DeckComposition = { mediaPairs: 0, text: 3, provenance: 0 };
    const signalCounts = new Set<number>();
    for (let k = 0; k < 40; k++) {
      const deck = sampleT2DeckIds(bank(), odd, t2DeckSeed(`att-odd-${k}`, BANK_SHA));
      expect(deck).toHaveLength(3);
      expect(new Set(deck).size).toBe(3);
      // The declared half of each class is always dealt; only the ONE extra
      // item is free, so the mix is 2:1 one way or the other, never 3:0.
      const signal = deck.filter(isSignal).length;
      expect(signal).toBeGreaterThanOrEqual(1);
      expect(signal).toBeLessThanOrEqual(2);
      signalCounts.add(signal);
    }
    expect(signalCounts).toEqual(new Set([1, 2]));
  });

  it("the odd extra item is still identical for the same seed", () => {
    const odd: T2DeckComposition = { mediaPairs: 0, text: 3, provenance: 0 };
    const seeds = [...Array(20).keys()].map((k) => t2DeckSeed(`att-odd-${k}`, BANK_SHA));
    for (const s of seeds) {
      expect(sampleT2DeckIds(bank(), odd, s)).toEqual(sampleT2DeckIds(bank(), odd, s));
    }
    expect(new Set(seeds.map((s) => sampleT2DeckIds(bank(), odd, s).join("|"))).size)
      .toBeGreaterThan(10);
  });

  /**
   * TEN-74. A class too thin to fill its declared half used to be papered
   * over with items of the OTHER class, silently. That changes the
   * signal/noise split the report claims to have measured, so it is refused
   * out loud instead \u2014 the same stance the declaration check takes.
   */
  it("refuses a text class too thin to deal balanced, rather than backfilling", () => {
    const noBenign = bank().filter((c) => !(c.kind === "text" && !c.signal));
    const noSignal = bank().filter((c) => !(c.kind === "text" && c.signal));
    for (const thin of [noBenign, noSignal]) {
      for (const seed of [undefined, t2DeckSeed("att-thin", BANK_SHA)]) {
        expect(() => sampleT2DeckIds(thin, DECK, seed)).toThrow(/class-balanced/);
      }
    }
    // Exactly thin enough to trigger ONE backfill: 4 declared text items
    // needs 2 per class, and one class holds 1.
    const oneShort = bank().filter((c) => !(c.kind === "text" && !c.signal && c.id !== "t-real-0"));
    expect(() =>
      sampleT2DeckIds(oneShort, { mediaPairs: 0, text: 4, provenance: 0 },
        t2DeckSeed("att-one-short", BANK_SHA)),
    ).toThrow(/class-balanced/);
  });

  it("an EXHAUSTED text pool shrinks the block instead of refusing", () => {
    // Nothing to backfill WITH, so no class mix is corrupted: the deck is
    // smaller and still says what it is.
    const noText = bank().filter((c) => c.kind !== "text");
    for (const seed of [undefined, t2DeckSeed("att-notext", BANK_SHA)]) {
      const deck = sampleT2DeckIds(noText, DECK, seed);
      expect(deck.filter((id) => kindOf(id) === "text")).toHaveLength(0);
      expect(deck).toHaveLength(4);
    }
  });

  it("refuses a malformed declaration rather than dealing something else", () => {
    const bads: T2DeckComposition[] = [
      { mediaPairs: -1, text: 2, provenance: 2 },
      { mediaPairs: 1, text: 1.5, provenance: 2 },
      { mediaPairs: 1, text: 2, provenance: Number.NaN },
      // A MISSING field is a malformed declaration, not a stratum at zero:
      // an instrument that forgot to say is not an instrument that said none.
      { mediaPairs: 1, text: 2 } as unknown as T2DeckComposition,
      { text: 2, provenance: 2 } as unknown as T2DeckComposition,
      { mediaPairs: 1, text: undefined, provenance: 2 } as unknown as T2DeckComposition,
      { mediaPairs: 1, text: null, provenance: 2 } as unknown as T2DeckComposition,
    ];
    for (const bad of bads) {
      expect(() => sampleT2DeckIds(bank(), bad)).toThrow(/non-negative integer/);
      expect(() => sampleT2DeckIds(bank(), bad, t2DeckSeed("att-bad", BANK_SHA))).toThrow(
        /non-negative integer/,
      );
    }
  });
});
