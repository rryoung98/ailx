/**
 * Clamp untrusted numeric query input — shared by every `parse*Query` here.
 *
 * One definition, because a page and a JSON caller normalize the same hostile
 * `limit=1e9` or negative offset, and two copies of a clamp are two chances to
 * clamp differently.
 */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
