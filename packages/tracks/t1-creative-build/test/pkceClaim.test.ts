// @vitest-environment jsdom
/**
 * The OAuth callback is claimed once, and by whoever reads it first.
 *
 * Two components take this callback — `ConnectPanel` in the web app and the T1
 * runner — and both used to read the code, start the exchange and clean up
 * afterwards. The single-use halves are taken out of the browser as they are
 * read now (TEN-64 defects 1 to 3), so a StrictMode second pass, an unmount
 * mid-flight and a missing verifier all leave nothing behind.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { claimPkceCallback } from "../src/pkceClaim.js";
import { PKCE_VERIFIER_STORAGE } from "../src/sso.js";

const store = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
  configurable: true,
});

beforeEach(() => {
  store.clear();
  window.history.replaceState(null, "", "/exam");
});

describe("claimPkceCallback", () => {
  it("returns both halves and removes both", () => {
    window.history.replaceState(null, "", "/exam?code=abc&keep=1");
    store.set(PKCE_VERIFIER_STORAGE, "v1");
    expect(claimPkceCallback()).toEqual({ code: "abc", verifier: "v1" });
    expect(store.has(PKCE_VERIFIER_STORAGE)).toBe(false);
    expect(window.location.search).toBe("?keep=1");
  });

  it("gives the second caller nothing to spend", () => {
    window.history.replaceState(null, "", "/exam?code=abc");
    store.set(PKCE_VERIFIER_STORAGE, "v1");
    expect(claimPkceCallback()).not.toBeNull();
    expect(claimPkceCallback()).toBeNull();
  });

  it("clears a code it cannot redeem", () => {
    window.history.replaceState(null, "", "/exam?code=abc");
    expect(claimPkceCallback()).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("touches nothing on a page that is not a callback", () => {
    store.set(PKCE_VERIFIER_STORAGE, "v1");
    expect(claimPkceCallback()).toBeNull();
    expect(store.get(PKCE_VERIFIER_STORAGE)).toBe("v1");
  });
});
