/**
 * Seeded helpers for the deterministic demo assistant/judge — never used
 * inside score(). SHA-256 itself comes from the repo's single shared
 * implementation in @ailx/core.
 */
import { sha256Hex } from "@ailx/core";

export { sha256Hex };

/** Deterministic integer in [0, n) derived from a seed string. */
export function seededIndex(seed: string, n: number): number {
  if (n <= 0) return 0;
  return parseInt(sha256Hex(seed).slice(0, 8), 16) % n;
}
