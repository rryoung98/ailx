/**
 * T2 per-attempt deck rotation — regression tests.
 * The deck is deterministic per attemptId (seed = sha256(attemptId + bank
 * sha256) through the pure @ailx/track-t2 sampler), varies across attempts,
 * and holds the balance invariants: 6 items = 2 media (1 AI + 1 real, difficulty-
 * matched) + 2 text/message (1 signal + 1 benign) + 2 provenance. Without
 * an attemptId the fixed
 * default deck is returned (fixtures, /validate). The operational
 * instrument uses fixed forms; this rotation is demo-only.
 */
import { describe, expect, it } from "vitest";
import {
  t2AnswerKeys,
  t2BankSha256,
  t2DeckComposition,
  t2DeckItemIds,
  t2DeckRecords,
  t2Items,
  trackConfig,
} from "../lib/instrument";
import { scoreTrack } from "../lib/registry";
import { T2_TOTAL_POINTS } from "@ailx/track-t2";

type Item = ReturnType<typeof t2Items>[number];
const ids = (deck: Item[]) => deck.map((i) => i.id);
const isMedia = (i: Item) => i.material.startsWith("/");
const isAi = (i: Item) => i.signal === i.key;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const SEEDS = [...Array(20).keys()].map((k) => `att-rotation-${k}`);

describe("T2 deck rotation (demo-only)", () => {
  it("same attemptId → identical deck; omitted attemptId → fixed default deck", () => {
    for (const a of SEEDS.slice(0, 5)) {
      expect(ids(t2Items("en", a))).toEqual(ids(t2Items("en", a)));
    }
    expect(ids(t2Items("en"))).toEqual(ids(t2Items("en")));
  });

  it("default deck holds the same shape and difficulty-match invariants", () => {
    const deck = t2Items("en");
    expect(deck).toHaveLength(6);
    const media = deck.filter(isMedia);
    expect(media).toHaveLength(2);
    expect(media.filter(isAi)).toHaveLength(1);
    // The single pair must be difficulty-matched — a 1-vs-1 class pair with
    // a difficulty gap confounds d' with difficulty.
    expect(
      Math.abs(mean(media.filter(isAi).map((i) => i.difficulty)) -
               mean(media.filter((i) => !isAi(i)).map((i) => i.difficulty))),
    ).toBeLessThanOrEqual(0.35);
    const text = deck.filter((i) => !isMedia(i) && i.type !== "provenance");
    expect(text).toHaveLength(2);
    expect(text.filter(isAi)).toHaveLength(1);
    expect(deck.filter((i) => i.type === "provenance")).toHaveLength(2);
  });

  it("server-recorded deck records equal the presented deck ids", () => {
    for (const a of SEEDS.slice(0, 5)) {
      const [rec] = t2DeckRecords(a, "en");
      expect(rec.trackId).toBe("t2");
      expect(rec.bankSha256).toBe(t2BankSha256());
      expect(rec.bankSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(rec.itemIds).toEqual(ids(t2Items("en", a)));
      expect(rec.itemIds).toEqual(t2DeckItemIds("en", a));
    }
  });

  it("different attemptIds produce different decks", () => {
    const seen = new Set(SEEDS.map((a) => ids(t2Items("en", a)).join("|")));
    // 20 seeds must not collapse; require substantial variety.
    expect(seen.size).toBeGreaterThan(10);
    expect(ids(t2Items("en", SEEDS[0]))).not.toEqual(ids(t2Items("en", SEEDS[1])));
  });

  it("balance invariants hold across 20 seeds", () => {
    const keys = t2AnswerKeys("en");
    for (const a of SEEDS) {
      const deck = t2Items("en", a);
      expect(deck).toHaveLength(6);
      expect(new Set(ids(deck)).size).toBe(6); // no duplicates
      const media = deck.filter(isMedia);
      const prov = deck.filter((i) => i.type === "provenance");
      const text = deck.filter((i) => !isMedia(i) && i.type !== "provenance");
      expect(media).toHaveLength(2);
      expect(text).toHaveLength(2);
      expect(prov).toHaveLength(2);
      const ai = media.filter(isAi);
      const real = media.filter((i) => !isAi(i));
      expect(ai).toHaveLength(1);
      expect(real).toHaveLength(1);
      // Text block is class-balanced too: one signal, one benign.
      expect(text.filter(isAi)).toHaveLength(1);
      // Difficulty-matched classes: mean gap within one difficulty band.
      expect(
        Math.abs(mean(ai.map((i) => i.difficulty)) - mean(real.map((i) => i.difficulty))),
      ).toBeLessThanOrEqual(0.35);
      // Media items lead the deck and keep their timed exposure.
      for (const [idx, i] of deck.entries()) {
        if (isMedia(i)) expect(idx).toBeLessThan(2);
        if (i.type !== "provenance") expect(i.exposureSeconds).toBeGreaterThan(0);
        expect(keys[i.id]).toBe(i.key); // full-bank key map covers rotated decks
      }
    }
  });

  it("scoring with the same attemptId reproduces the presented deck", () => {
    const attemptId = "att-rotation-repro";
    const cfg = trackConfig("t2", "en", attemptId) as { items: Item[] };
    // Answer every presented item correctly at 90% confidence.
    const artifact = {
      responses: cfg.items.map((i) => ({
        itemId: i.id,
        choice: i.key,
        confidence: 90,
        latencyMs: 1500,
      })),
    };
    const withId = scoreTrack("t2", artifact, "en", attemptId);
    // The deck-aware d′ ceiling (cfg.dPrimeCeiling = attainable corrected
    // d′) keeps a perfect short deck near the top of T2's 80-point scale.
    expect(withId.score.scaled).toBeGreaterThan(0.95 * T2_TOTAL_POINTS);
    // Same call again is deterministic.
    expect(scoreTrack("t2", artifact, "en", attemptId).score).toEqual(withId.score);
    // The default deck is a DIFFERENT population, so scoring without the
    // attemptId must not silently agree (rotated items count as lapses).
    const withoutId = scoreTrack("t2", artifact);
    expect(withoutId.score.scaled).toBeLessThan(withId.score.scaled);
  });
  /**
   * THE DECK IS THE SAME AFTER TEN-48. The sampler now reads `config.deck`
   * from the instrument instead of holding the numbers itself, so these ids
   * are pinned against the real released bank: same attempt id, same bank
   * sha256, same items in the same order. A recorded attempt re-derives its
   * deck from stored inputs alone (F16), so a change here is a change to
   * every deck already recorded.
   */
  it("deals the ids it dealt before the sampler read the declaration", () => {
    expect(t2BankSha256()).toBe(
      "695cb4573d83fa9bb70937fddfc483fd74057cd249cb367f0bd976edf8a30511",
    );
    expect(t2DeckItemIds("en", "att-golden")).toEqual([
        "db482cd7e9d0d80490d73d01e022ac906029e96a7edb914461b5b8a4b7c71f94",
        "40a6526ecc7b6a0f4a018ffdf6075bbd4c98531ed8c5bb1de3267e301dc36191",
        "08a88a7beba12c10f67ee3761db43986e72b20ff74df9d15000d3d956880a2f6",
        "e5c2f2a504b3ecf7074c4ae7befa8f954df8cfd43c8067a4d3ea1fa141e49f01",
        "b4cb1960c7bf6ea9ed9516537cf67761bde0d0324ef4985ef557e02631f8c5e5",
        "c064fbdcea13b94da112295a592f0cdd8a11c145e8ef16ce5984e77b0be8c28e",
      ]);
    expect(t2DeckItemIds("en", "00000000-0000-4000-8000-000000000000")).toEqual([
        "99aa164bad9534302bf6410ec3fa57834867290ed3e5e2c0aed698c4af81b7fd",
        "1c8ff5ea70da707850836ee4da907a72e21f898136c3c9f7e49e1d7880e6e02c",
        "e5c2f2a504b3ecf7074c4ae7befa8f954df8cfd43c8067a4d3ea1fa141e49f01",
        "08a88a7beba12c10f67ee3761db43986e72b20ff74df9d15000d3d956880a2f6",
        "b4cb1960c7bf6ea9ed9516537cf67761bde0d0324ef4985ef557e02631f8c5e5",
        "c064fbdcea13b94da112295a592f0cdd8a11c145e8ef16ce5984e77b0be8c28e",
      ]);
    expect(t2DeckItemIds("en")).toEqual([
        "99aa164bad9534302bf6410ec3fa57834867290ed3e5e2c0aed698c4af81b7fd",
        "1c8ff5ea70da707850836ee4da907a72e21f898136c3c9f7e49e1d7880e6e02c",
        "08a88a7beba12c10f67ee3761db43986e72b20ff74df9d15000d3d956880a2f6",
        "a78afdff4d93e3ee261ea94db503c460cd7f7405ca10383a234ec62023d876e6",
        "b4cb1960c7bf6ea9ed9516537cf67761bde0d0324ef4985ef557e02631f8c5e5",
        "c064fbdcea13b94da112295a592f0cdd8a11c145e8ef16ce5984e77b0be8c28e",
      ]);
    // ja and ko hold one provenance item each, so they are dealt 5, not 6.
    expect(t2DeckItemIds("ja", "att-golden")).toEqual([
        "eb8a1ecdb191f988d0a7d4959bd58e5fc8aa2ccab44c1ced90bf06f2f23f3af4",
        "9a329c4d4d0fb465ac851213d4509a079d523540ea43d329a624b78f7445c413",
        "896ef91898f0fc31e4e8d81cc7ca602a08b39e8c79d600ff9ef9acd434fd2977",
        "cea6f4526502532744dac668ff869fa6242830123a17133e348cd4d33b8964cd",
        "9afd7a80e3ff5745e67f20150429228cb3b6a2786082f72c2509eb33bd69f51c",
      ]);
    expect(t2DeckItemIds("ko", "att-golden")).toEqual([
        "467f1542f1768b7d6b12c4a1cf1bab38818862623c3436956a036a436a6a79fd",
        "6400207b520b6a0fc47316b30c7778c6fdd786ee4ff25bc08729cc482277e26b",
        "0c0ba40a715f675c3ed9c737407d261d1c71fa996eeae1532e69f2dd44fa4e84",
        "21c7a83e8996e1a442dde96fd78640d6253bb19520c479bb7222da941a9ee36b",
        "d012ebe571eea7236546163071baeb557c3479e190418711517d5a1d0eba0723",
      ]);
  });

  it("the deck it deals is the deck the instrument declares", () => {
    expect(t2DeckComposition()).toEqual({ mediaPairs: 1, text: 2, provenance: 2 });
    const declared = t2DeckComposition();
    const deck = t2Items("en", "att-declared");
    expect(deck.filter(isMedia)).toHaveLength(2 * declared.mediaPairs);
    expect(deck.filter((i) => !isMedia(i) && i.type !== "provenance")).toHaveLength(declared.text);
    expect(deck.filter((i) => i.type === "provenance")).toHaveLength(declared.provenance);
  });
});
