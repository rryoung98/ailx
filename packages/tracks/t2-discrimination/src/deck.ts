/**
 * Per-attempt T2 deck sampling — pure and deterministic (F16 recomputability):
 * the SAME (candidates, seed) pair always yields the SAME item-id list, so a
 * presented deck can be byte-identically re-derived from stored inputs alone
 * (attempt id + content-addressed bank). No I/O, clock, or Math.random.
 *
 * Composition rules (mirrors the demo deck contract):
 *   6 items = 2 media (1 AI + 1 real, difficulty-matched pair, leading the
 *   deck) + 2 text/message (1 signal + 1 benign) + 2 provenance. Both binary
 *   blocks stay class-balanced so d\u2032 stays measurable, and the single media
 *   pair is difficulty-matched so class is never confounded with difficulty.
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
 * order. `seed` (from {@link t2DeckSeed}) selects a per-attempt deck; omit
 * it for the fixed default deck. Thin strata degrade gracefully: a missing
 * media class drops the media pair (never an unmatched half-pair), a missing
 * text class back-fills from the remaining text pool, and short provenance
 * pools shrink that block \u2014 the deck is always well-formed, just smaller.
 */
export function sampleT2DeckIds(
  candidates: readonly T2DeckCandidate[],
  seed?: string,
): string[] {
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
  // Back-fill a missing text class from the remaining text pool so the deck
  // size stays content-independent.
  const backfillText = (picked: T2DeckCandidate[]) => {
    const pool = [...textAi, ...textReal].filter((c) => !picked.includes(c));
    while (picked.length < 2 && pool.length > 0) picked.push(pool.shift()!);
    return picked;
  };
  // A media pair needs BOTH classes; otherwise present no media at all.
  const pairCount = Math.min(1, mediaAi.length, mediaReal.length);

  if (seed === undefined) {
    const aiPick = mediaAi.slice(0, pairCount);
    const realPick = matchByDifficulty(aiPick, [...mediaReal]);
    const media = aiPick.flatMap((a, k) => [a, realPick[k]]);
    const text = backfillText([textAi[0], textReal[0]].filter(Boolean));
    return [...media, ...text, ...prov.slice(0, 2)].map((c) => c.id);
  }

  // 1 AI item, then 1 real item difficulty-matched to it; seeded order per
  // pair so the AI item never has a fixed slot.
  const aiPick = seededShuffle(mediaAi, seed, "media-ai").slice(0, pairCount);
  const realPick = matchByDifficulty(aiPick, seededShuffle(mediaReal, seed, "media-real"));
  const media = aiPick.flatMap((a, k) => {
    const pair = [a, realPick[k]];
    return seededUniform(`${seed}:pair-order`, k) < 0.5 ? pair : pair.reverse();
  });
  // 1 signal (AI/hostile) + 1 benign text, seeded pick and seeded order.
  const textPair = backfillText([
    seededShuffle(textAi, seed, "text-ai")[0],
    seededShuffle(textReal, seed, "text-real")[0],
  ].filter(Boolean));
  const textPick =
    seededUniform(`${seed}:text-order`, 0) < 0.5 ? textPair : [...textPair].reverse();
  const provPick = seededShuffle(prov, seed, "prov").slice(0, 2);
  return [...media, ...textPick, ...provPick].map((c) => c.id);
}
