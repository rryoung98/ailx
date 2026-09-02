// @vitest-environment jsdom
/**
 * The dev identity has to be readable by a SERVER-RENDERED page.
 *
 * `x-ailx-dev-user` only exists on a fetch this app makes; a navigation to
 * /progress carries cookies and nothing else, which is why that page told
 * every browser "we do not know who you are". localStorage stays the single
 * source of truth and the cookie is its mirror — asserted, never proven, and
 * only ever read by DevAuthProvider (Clerk remains the real answer).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEV_USER_COOKIE, isDevUserId } from "@ailx/contract";
import { DEV_USER_KEY, clearDevUser, devUser } from "../lib/data/persistence";

/** This vitest/jsdom combo exposes no storage (see
 *  connectPanel.test.tsx) — and devUser takes any StorageLike anyway. */
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}
let storage = fakeStorage();

const cookieValue = (name: string): string | undefined =>
  document.cookie
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${name}=`))
    ?.slice(name.length + 1);

beforeEach(() => {
  storage = fakeStorage();
  clearDevUser(storage);
});

describe("devUser", () => {
  it("mirrors the minted identity into the cookie, byte for byte", () => {
    const user = devUser(storage);
    expect(user).toMatch(/^web-/);
    expect(storage.getItem(DEV_USER_KEY)).toBe(user);
    expect(cookieValue(DEV_USER_COOKIE)).toBe(user);
  });

  it("mirrors an identity that already existed only in localStorage", () => {
    storage.setItem(DEV_USER_KEY, "returning-player");
    expect(devUser(storage)).toBe("returning-player");
    expect(cookieValue(DEV_USER_COOKIE)).toBe("returning-player");
  });

  it("writes a cookie carrying an id the server's contract accepts", async () => {
    // Same split as authHeaders.test.ts: the browser's half is asserted here
    // against the shared predicate, and DevAuthProvider's half is asserted in
    // the private repo. Neither repo can import the other, and a shared
    // predicate is the only version of this guarantee that both can check.
    const user = devUser(storage);
    expect(isDevUserId(user)).toBe(true);
    expect(cookieValue(DEV_USER_COOKIE)).toBe(user);
  });

  it("never adopts a cookie back into localStorage — no silent re-identification", () => {
    document.cookie = `${DEV_USER_COOKIE}=somebody-else; Path=/`;
    const user = devUser(storage);
    expect(user).not.toBe("somebody-else");
    expect(cookieValue(DEV_USER_COOKIE)).toBe(user);
  });

  it("overwrites a stale cookie whenever localStorage disagrees", () => {
    document.cookie = `${DEV_USER_COOKIE}=stale; Path=/`;
    storage.setItem(DEV_USER_KEY, "current");
    devUser(storage);
    expect(cookieValue(DEV_USER_COOKIE)).toBe("current");
  });

  it("replaces a corrupt localStorage id in both stores", () => {
    storage.setItem(DEV_USER_KEY, "not a legal id");
    const user = devUser(storage);
    expect(user).toMatch(/^web-/);
    expect(cookieValue(DEV_USER_COOKIE)).toBe(user);
  });
});

describe("clearDevUser", () => {
  it("clears BOTH stores, so nothing keeps asserting the old identity", async () => {
    devUser(storage);
    clearDevUser(storage);
    expect(storage.getItem(DEV_USER_KEY)).toBeNull();
    expect(cookieValue(DEV_USER_COOKIE)).toBeUndefined();
    expect(cookieValue(DEV_USER_COOKIE)).toBeUndefined();
  });

  it("is safe to call when there was no identity at all", () => {
    expect(() => clearDevUser(storage)).not.toThrow();
    expect(cookieValue(DEV_USER_COOKIE)).toBeUndefined();
  });

  it("leaves an identity minted afterwards unrelated to the cleared one", () => {
    const before = devUser(storage);
    clearDevUser(storage);
    expect(devUser(storage)).not.toBe(before);
  });
});
