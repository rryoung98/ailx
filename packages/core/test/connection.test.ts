import { describe, expect, it } from "vitest";
import { CONNECTION_CHANGED_EVENT, MODEL_ENDPOINT_SLOT } from "../src/connection.js";
import { legacyStorageKey, STORAGE_NAMESPACE } from "../src/storageKeys.js";

/**
 * The endpoint slot is a PERSISTED spelling: a browser that connected
 * yesterday holds the old string, so changing it silently disconnects every
 * candidate mid-sitting. It is pinned here, ONCE — this is the only literal
 * of it left in the repo's source, and the two track packages re-export this
 * constant rather than spelling it again.
 */
describe("the connected model endpoint", () => {
  it("keeps the persisted slot spelling", () => {
    expect(MODEL_ENDPOINT_SLOT).toBe("foray:llm-base-url");
  });

  it("keeps the announcement spelling", () => {
    expect(CONNECTION_CHANGED_EVENT).toBe("foray:connection-changed");
  });

  it("is namespaced, so the one-shot legacy read can find its pre-rename twin", () => {
    expect(MODEL_ENDPOINT_SLOT.startsWith(STORAGE_NAMESPACE)).toBe(true);
    expect(legacyStorageKey(MODEL_ENDPOINT_SLOT)).toBe("ailx:llm-base-url");
  });

  it("holds a URL, never a credential", () => {
    // TEN-62: the browser receives no provider key, so no spelling here may
    // suggest it stores one.
    expect(MODEL_ENDPOINT_SLOT).not.toMatch(/key|token|secret/i);
  });
});
