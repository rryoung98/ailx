import { canonicalJson, sha256Bytes, sha256Hex } from "./hash.js";

/**
 * Content addressing — spec §14. Canonical JSON lives in ./hash.js (the
 * repo's single hashing module); this file derives the addressed ids.
 * item_id = sha256(canonical_json(item)). An edited item is a NEW item,
 * never a mutation.
 */
export function itemId(item: unknown): string {
  return sha256Hex(canonicalJson(item));
}

/** rubric_version = hash(rubric + prompts). Changing a prompt is a version bump. */
export function rubricVersion(parts: ReadonlyArray<string>): string {
  // Equivalent to node:crypto's streaming update: hash the concatenation of
  // each part's raw digest (locked byte-for-byte by test/content-address vectors).
  const acc = new Uint8Array(parts.length * 32);
  parts.forEach((p, i) => acc.set(sha256Bytes(p), i * 32));
  return sha256Hex(acc);
}
