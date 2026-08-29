/**
 * Session hashing — thin re-exports of the repo's single browser-safe
 * SHA-256 + canonical JSON implementation in @ailx/core, plus the
 * session-local seeded PRNG used by the demo simulators.
 */
import { sha256Hex } from "@ailx/core";

export { canonicalJson, itemId, sha256Bytes, sha256Hex } from "@ailx/core";
/** Historical session-side name for @ailx/core's rubricVersion. */
export { rubricVersion as rubricVersionOf } from "@ailx/core";

/**
 * Deterministic PRNG in [0, 1), seeded by sha256 of a string.
 * Used by demo simulators (judge, cohort) — same seed, same stream, forever.
 */
export function seededUniform(seed: string, index: number): number {
  const hex = sha256Hex(`${seed}:${index}`).slice(0, 13); // 52 bits
  return parseInt(hex, 16) / 2 ** 52;
}
