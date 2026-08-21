/**
 * T2 demo deck rotation — regression tests.
 * The deck is deterministic per attemptId (seed = sha256(attemptId) through
 * the @ailx/session seeded PRNG), varies across attempts, and holds the
 * balance invariants: 12 items = 6 media (3 AI + 3 real, difficulty-
 * matched) + 3 text/message + 3 provenance. Without an attemptId the fixed
 * default deck is returned (fixtures, /validate). The operational
 * instrument uses fixed forms; this rotation is demo-only.
 */
import { describe, expect, it } from "vitest";
import { t2AnswerKeys, t2Items, trackConfig } from "../lib/instrument";
import { scoreTrack } from "../lib/registry";

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
      expect(deck).toHaveLength(12);
      expect(new Set(ids(deck)).size).toBe(12); // no duplicates
      const media = deck.filter(isMedia);
      const prov = deck.filter((i) => i.type === "provenance");
      const text = deck.filter((i) => !isMedia(i) && i.type !== "provenance");
      expect(media).toHaveLength(6);
      expect(text).toHaveLength(3);
      expect(prov).toHaveLength(3);
      const ai = media.filter(isAi);
      const real = media.filter((i) => !isAi(i));
      expect(ai).toHaveLength(3);
      expect(real).toHaveLength(3);
      // Difficulty-matched classes: mean gap within one difficulty band.
      expect(
        Math.abs(mean(ai.map((i) => i.difficulty)) - mean(real.map((i) => i.difficulty))),
      ).toBeLessThanOrEqual(0.35);
      // Media items lead the deck and keep their timed exposure.
      for (const [idx, i] of deck.entries()) {
        if (isMedia(i)) expect(idx).toBeLessThan(6);
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
    expect(withId.score.scaled).toBeGreaterThan(80);
    // Same call again is deterministic.
    expect(scoreTrack("t2", artifact, "en", attemptId).score).toEqual(withId.score);
    // The default deck is a DIFFERENT population, so scoring without the
    // attemptId must not silently agree (rotated items count as lapses).
    const withoutId = scoreTrack("t2", artifact);
    expect(withoutId.score.scaled).toBeLessThan(withId.score.scaled);
  });
});
