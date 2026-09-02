/**
 * Per-attempt T2 deck sampling — pure and deterministic (F16 recomputability):
 * the SAME (candidates, deck, seed) triple always yields the SAME item-id
 * list, so a presented deck can be byte-identically re-derived from stored
 * inputs alone (attempt id + content-addressed bank). No I/O, clock, or
 * Math.random.
 *
 * WHAT ONE SITTING IS DEALT IS DECLARED, NOT HARDCODED. The caller passes the
 * composition it read from the instrument (`config.deck` in the track's
 * `track.yaml`). This module used to hold the numbers itself — one media pair,
 * two text, two provenance — while `track.yaml` declared a 132-item form and
 * the bank held neither. Three descriptions of one track, disagreeing, with
 * nothing to notice (TEN-48). There is now one statement of the deck and this
 * sampler reads it.
 *
 * The composition rules the sampler still owns, because they are measurement
 * and not policy: a media pair is one signal item and one authentic item,
 * difficulty-matched, and it leads the deck; text is class-balanced. Both
 * binary strata stay class-balanced so d\u2032 stays measurable, and a
 * difficulty-matched pair keeps class from being confounded with difficulty.
 *
 * Without a seed the FIXED default deck is returned (fixtures, /validate):
 * first-in-bank-order picks, same composition rules.
 */
import { seededUniform, sha256Hex } from "@ailx/session";

/** Stratification facts the sampler needs about one bank item. */
export interface T2DeckCandidate {
  id: string;
  /** media = real media file; text = message/page; provenance = untimed reasoning. */
  kind: "media" | "text" | "provenance";
  /** true when the keyed answer is the SIGNAL (AI / synthetic / hostile) call. */
  signal: boolean;
  /** 0..1 difficulty used for class-vs-difficulty matching. */
  difficulty: number;
}

/**
 * What ONE sitting is dealt, as the instrument declares it (`config.deck` in
 * the track's `track.yaml`, carried into the snapshot). Counts, not items: the
 * sampler decides WHICH items meet them.
 */
export interface T2DeckComposition {
  /** Media pairs. Each pair is one signal item and one authentic item. */
  mediaPairs: number;
  /** Text/message items, class-balanced. */
  text: number;
  /** Provenance items. */
  provenance: number;
}

/**
 * Seed for one attempt's deck: sha256 of the attempt id AND the
 * content-addressed bank hash, so a bank edit (new items = new hash) can
 * never silently replay under an old deck derivation.
 */
export function t2DeckSeed(attemptId: string, bankSha256: string): string {
  return sha256Hex(`${attemptId}:${bankSha256}`);
}

/** Deterministic Fisher\u2013Yates over the @ailx/session seeded PRNG. */
function seededShuffle<T>(arr: readonly T[], seed: string, salt: string): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(seededUniform(`${seed}:${salt}`, i) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Sample a deck from `candidates` and return the presented item ids in
 * order. `deck` is the declared composition (see {@link T2DeckComposition});
 * `seed` (from {@link t2DeckSeed}) selects a per-attempt deck, and omitting it
 * returns the fixed default deck. Thin strata degrade gracefully: a missing
 * media class drops that pair (never an unmatched half-pair), a missing text
 * class back-fills from the remaining text pool, and a short provenance pool
 * shrinks that block \u2014 the deck is always well-formed, just smaller.
 *
 * A negative or non-integer count throws rather than dealing a deck nobody
 * declared: the composition comes from an instrument file, and a malformed
 * one must stop the sitting, not quietly change what is measured.
 */
export function sampleT2DeckIds(
  candidates: readonly T2DeckCandidate[],
  deck: T2DeckComposition,
  seed?: string,
): string[] {
  // The three named fields, by name: iterating the object's own keys would
  // pass a declaration that is MISSING one (and would check a field the
  // sampler never reads).
  for (const field of ["mediaPairs", "text", "provenance"] as const) {
    const n = deck?.[field];
    if (!Number.isInteger(n) || (n as number) < 0) {
      throw new Error(`t2 deck ${field} must be a non-negative integer, got ${String(n)}`);
    }
  }
  const mediaAi = candidates.filter((c) => c.kind === "media" && c.signal);
  const mediaReal = candidates.filter((c) => c.kind === "media" && !c.signal);
  const textAi = candidates.filter((c) => c.kind === "text" && c.signal);
  const textReal = candidates.filter((c) => c.kind === "text" && !c.signal);
  const prov = candidates.filter((c) => c.kind === "provenance");

  // Nearest-difficulty real partner per AI pick (splices from the pool) so a
  // 1-vs-1 class pair is never confounded with difficulty.
  const matchByDifficulty = (aiPick: T2DeckCandidate[], realPool: T2DeckCandidate[]) =>
    aiPick.map((a) => {
      let best = 0;
      for (let j = 1; j < realPool.length; j++) {
        if (Math.abs(realPool[j].difficulty - a.difficulty) <
            Math.abs(realPool[best].difficulty - a.difficulty)) best = j;
      }
      return realPool.splice(best, 1)[0];
    });
  // Half the declared text items from each class, then back-fill a thin or
  // odd class from the remaining text pool so the deck size stays
  // content-independent.
  const perTextClass = Math.floor(deck.text / 2);
  const backfillText = (picked: T2DeckCandidate[]) => {
    const pool = [...textAi, ...textReal].filter((c) => !picked.includes(c));
    while (picked.length < deck.text && pool.length > 0) picked.push(pool.shift()!);
    return picked;
  };
  // A media pair needs BOTH classes; otherwise present that pair not at all.
  const pairCount = Math.min(deck.mediaPairs, mediaAi.length, mediaReal.length);

  if (seed === undefined) {
    const aiPick = mediaAi.slice(0, pairCount);
    const realPick = matchByDifficulty(aiPick, [...mediaReal]);
    const media = aiPick.flatMap((a, k) => [a, realPick[k]]);
    const text = backfillText([
      ...textAi.slice(0, perTextClass),
      ...textReal.slice(0, perTextClass),
    ]);
    return [...media, ...text, ...prov.slice(0, deck.provenance)].map((c) => c.id);
  }

  // Per pair: 1 AI item, then 1 real item difficulty-matched to it; seeded
  // order per pair so the AI item never has a fixed slot.
  const aiPick = seededShuffle(mediaAi, seed, "media-ai").slice(0, pairCount);
  const realPick = matchByDifficulty(aiPick, seededShuffle(mediaReal, seed, "media-real"));
  const media = aiPick.flatMap((a, k) => {
    const pair = [a, realPick[k]];
    return seededUniform(`${seed}:pair-order`, k) < 0.5 ? pair : pair.reverse();
  });
  // Half signal (AI/hostile) and half benign text, seeded pick and seeded order.
  const textPair = backfillText([
    ...seededShuffle(textAi, seed, "text-ai").slice(0, perTextClass),
    ...seededShuffle(textReal, seed, "text-real").slice(0, perTextClass),
  ]);
  const textPick =
    seededUniform(`${seed}:text-order`, 0) < 0.5 ? textPair : [...textPair].reverse();
  const provPick = seededShuffle(prov, seed, "prov").slice(0, deck.provenance);
  return [...media, ...textPick, ...provPick].map((c) => c.id);
}
