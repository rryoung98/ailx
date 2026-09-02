import { canonicalJson, sha256Bytes, sha256Hex } from "./hash.js";
import type { Judgment } from "./plugin.js";

/**
 * Content addressing — spec §14. Canonical JSON lives in ./hash.js (the
 * repo's single hashing module); this file derives the addressed ids.
 * item_id = sha256(canonical_json(item)). An edited item is a NEW item,
 * never a mutation.
 */
export function itemId(item: unknown): string {
  return sha256Hex(canonicalJson(item));
}

/**
 * judgment_id = sha256(canonical_json(judgment)) — the same rule as itemId,
 * applied to a STORED JUDGE OUTPUT.
 *
 * An LLM judge does not repeat itself, even at temperature 0, so a judgment is
 * evidence that was COLLECTED once and must then be treated exactly like an
 * item: addressed, immutable, and re-judged only by writing a new row. This is
 * the check an auditor runs. Recompute the ids over the stored judgments; if
 * they match the ones recorded against the score, score() is obliged to return
 * the same number, byte for byte. If they do not match, the judgments were
 * mutated and the score of record is void — which is a different and much
 * louder failure than a judge that drifted.
 *
 * Validation is not skipped, it is delegated: canonicalJson REJECTS anything
 * JSON cannot represent losslessly (NaN, ±Infinity, -0, an undefined-valued
 * property), so a judgment carrying one of those throws here rather than
 * quietly sharing an id with a different judgment.
 */
export function judgmentId(judgment: Judgment): string {
  return sha256Hex(canonicalJson(judgment));
}

/** rubric_version = hash(rubric + prompts). Changing a prompt is a version bump. */
export function rubricVersion(parts: ReadonlyArray<string>): string {
  // Equivalent to node:crypto's streaming update: hash the concatenation of
  // each part's raw digest (locked byte-for-byte by test/content-address vectors).
  const acc = new Uint8Array(parts.length * 32);
  parts.forEach((p, i) => {
    acc.set(sha256Bytes(p), i * 32);
  });
  return sha256Hex(acc);
}
