/**
 * The one-shot legacy read that carries a browser across the rename
 * (docs/RENAME.md §5 step 7). Tested here rather than only at the call sites
 * because every call site trusts the same three promises: the new key wins,
 * the old key is adopted exactly once, and a storage that refuses to write
 * still yields the value.
 */
import { describe, expect, it } from "vitest";
import {
  LEGACY_STORAGE_NAMESPACE,
  STORAGE_NAMESPACE,
  legacyStorageKey,
  readMigratedItem,
  removeMigratedItem,
  type StorageLikeKeys,
} from "../src/storageKeys.js";

function memStorage(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  const storage: StorageLikeKeys & { map: Map<string, string> } = {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
  return storage;
}

describe("legacyStorageKey", () => {
  it("maps our namespace onto the pre-rename one", () => {
    expect(STORAGE_NAMESPACE).toBe("foray:");
    expect(LEGACY_STORAGE_NAMESPACE).toBe("ailx:");
    expect(legacyStorageKey("foray:attempt:v1")).toBe("ailx:attempt:v1");
    expect(legacyStorageKey("foray:checkpoint:att-1:t2")).toBe("ailx:checkpoint:att-1:t2");
  });

  it("invents no twin for a key that is not ours", () => {
    // A key outside the namespace would otherwise make us read somebody
    // else's storage on the same origin.
    for (const k of ["", "attempt", "ailx:attempt:v1", "other:foray:x", "FORAY:x"]) {
      expect(legacyStorageKey(k), k).toBeNull();
    }
  });
});

describe("readMigratedItem", () => {
  it("returns the new value and never looks at the old one", () => {
    const st = memStorage({ "foray:x": "new", "ailx:x": "old" });
    expect(readMigratedItem(st, "foray:x")).toBe("new");
    expect(st.map.get("ailx:x")).toBe("old");
  });

  it("adopts the legacy value under the new key, once", () => {
    const st = memStorage({ "ailx:x": "carried" });
    expect(readMigratedItem(st, "foray:x")).toBe("carried");
    expect(st.map.get("foray:x")).toBe("carried");
    expect(st.map.has("ailx:x")).toBe(false);
    expect(readMigratedItem(st, "foray:x")).toBe("carried");
  });

  it("carries an empty string, which is a value and not an absence", () => {
    const st = memStorage({ "ailx:x": "" });
    expect(readMigratedItem(st, "foray:x")).toBe("");
    expect(st.map.get("foray:x")).toBe("");
  });

  it("returns null when neither spelling exists", () => {
    expect(readMigratedItem(memStorage(), "foray:x")).toBeNull();
  });

  it("reads no legacy twin for a key outside the namespace", () => {
    const st = memStorage({ "ailx:x": "old" });
    expect(readMigratedItem(st, "x")).toBeNull();
  });

  it("returns the value even when adoption throws (private mode, quota)", () => {
    const inner = memStorage({ "ailx:x": "carried" });
    const readOnly: StorageLikeKeys = {
      getItem: (k) => inner.getItem(k),
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: (k) => inner.removeItem(k),
    };
    expect(readMigratedItem(readOnly, "foray:x")).toBe("carried");
    // Nothing was lost: the next load finds it under the old key again.
    expect(inner.map.get("ailx:x")).toBe("carried");
  });

  it("reads null rather than throwing when the storage refuses reads", () => {
    const hostile: StorageLikeKeys = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(readMigratedItem(hostile, "foray:x")).toBeNull();
  });
});

describe("removeMigratedItem", () => {
  it("clears both spellings, so a clear really clears", () => {
    const st = memStorage({ "foray:x": "a", "ailx:x": "b" });
    removeMigratedItem(st, "foray:x");
    expect(st.map.size).toBe(0);
  });

  it("touches nothing else and never throws on a hostile storage", () => {
    const st = memStorage({ "foray:x": "a", "foray:y": "keep" });
    removeMigratedItem(st, "foray:x");
    expect([...st.map.keys()]).toEqual(["foray:y"]);
    expect(() =>
      removeMigratedItem(
        {
          getItem: () => null,
          setItem: () => undefined,
          removeItem: () => {
            throw new Error("SecurityError");
          },
        },
        "foray:x",
      ),
    ).not.toThrow();
  });
});
