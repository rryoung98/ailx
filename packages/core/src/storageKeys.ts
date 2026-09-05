/**
 * Browser storage keys, and the one-shot read that carries a browser across
 * the rename (docs/RENAME.md §5 step 7).
 *
 * Every key this product writes is namespaced `foray:`. Every key it wrote
 * before the rename is namespaced `ailx:`. A browser that arrives on the
 * first load after the deploy still holds the OLD keys, and one of them —
 * `ailx:attempt:v1` — is the append-only log of a sitting IN FLIGHT. Reading
 * only the new key would lose a candidate's run, silently, on a page reload.
 *
 * So a read is: new key first; if it is absent, adopt the legacy value under
 * the new key and remove the old one. ONE SHOT — after the first read the
 * legacy key is gone and the fast path is a single `getItem`. Adopting is
 * best-effort: a quota error or a locked-down storage must never turn a
 * successful read into a lost sitting, so the value is still returned.
 *
 * Deliberately not done: writing both keys. Two spellings of one fact is a
 * bug waiting to be read twice, which is the same argument §3.6 makes
 * against emitting two credential keys.
 */

/** Namespace every key this product writes today. */
export const STORAGE_NAMESPACE = "foray:";

/** Namespace every key written before the rename. Read, never written. */
export const LEGACY_STORAGE_NAMESPACE = "ailx:";

/** The minimum of `Storage` these helpers need — `@ailx/session`'s shape. */
export interface StorageLikeKeys {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The pre-rename spelling of a key, or null when the key is not one of ours.
 * A key outside the namespace has no legacy twin and must not get one: it
 * would invent a read of somebody else's storage.
 */
export function legacyStorageKey(key: string): string | null {
  return key.startsWith(STORAGE_NAMESPACE)
    ? LEGACY_STORAGE_NAMESPACE + key.slice(STORAGE_NAMESPACE.length)
    : null;
}

/**
 * Read `key`, falling back ONCE to its pre-rename spelling and adopting the
 * value under the new key. Returns null when neither exists.
 *
 * Storage access is wrapped: Safari private mode throws on `setItem`, and a
 * browser can refuse `getItem` entirely on a sandboxed origin.
 */
export function readMigratedItem(storage: StorageLikeKeys, key: string): string | null {
  let current: string | null = null;
  try {
    current = storage.getItem(key);
  } catch {
    return null;
  }
  if (current !== null) return current;

  const legacy = legacyStorageKey(key);
  if (legacy === null) return null;

  let carried: string | null = null;
  try {
    carried = storage.getItem(legacy);
  } catch {
    return null;
  }
  if (carried === null) return null;

  try {
    storage.setItem(key, carried);
    storage.removeItem(legacy);
  } catch {
    // Adopted nothing, lost nothing: the value is returned either way, and
    // the next read tries the legacy key again.
  }
  return carried;
}

/** Remove a key AND its pre-rename twin, so "clear" really clears. */
export function removeMigratedItem(storage: StorageLikeKeys, key: string): void {
  const legacy = legacyStorageKey(key);
  try {
    storage.removeItem(key);
    if (legacy !== null) storage.removeItem(legacy);
  } catch {
    // Nothing to do: a storage that refuses a delete refuses everything.
  }
}
