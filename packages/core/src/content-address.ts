import { createHash } from "node:crypto";

/**
 * Canonical JSON: stable key order, no insignificant whitespace.
 * item_id = sha256(canonical_json(item)) — spec §14.
 * An edited item is a NEW item, never a mutation.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortValue((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

export function itemId(item: unknown): string {
  return createHash("sha256").update(canonicalJson(item)).digest("hex");
}

/** rubric_version = hash(rubric + prompts). Changing a prompt is a version bump. */
export function rubricVersion(parts: ReadonlyArray<string>): string {
  const h = createHash("sha256");
  for (const p of parts) {
    h.update(createHash("sha256").update(p).digest());
  }
  return h.digest("hex");
}
