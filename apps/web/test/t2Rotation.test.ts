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
import { t2AnswerKeys, t2DeckItemIds, t2DeckRecords, t2BankSha256, t2Items, trackConfig } from "../lib/instrument";
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
});
