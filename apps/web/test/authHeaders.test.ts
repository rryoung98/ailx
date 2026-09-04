// @vitest-environment jsdom
/**
 * The identity seam: which credential travels with a request, and what
 * happens when the token provider is absent, empty or broken.
 *
 * This exists BEFORE Clerk is mounted on purpose (docs/ARCHITECTURE.md
 * §10.2): the switch has to be atomic, so the half that does not need a
 * provider ships first, dormant, with its edge cases already pinned.
 */
import { DEV_USER_COOKIE, DEV_USER_HEADER, isDevUserId } from "@ailx/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEV_USER_KEY,
  authHeaders,
  clearDevUser,
  devUser,
  existingDevUser,
  hasAuthTokenSource,
  setAuthTokenSource,
} from "../lib/data/authHeaders";

const storage = {
  map: new Map<string, string>(),
  getItem: (k: string) => storage.map.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.map.set(k, v),
  removeItem: (k: string) => void storage.map.delete(k),
};

beforeEach(() => {
  storage.map.clear();
  setAuthTokenSource(null);
});
afterEach(() => setAuthTokenSource(null));

describe("with no provider mounted (today)", () => {
  it("sends the asserted dev id and nothing else", async () => {
    const h = await authHeaders(storage);
    expect(Object.keys(h)).toEqual([DEV_USER_HEADER]);
    expect(h[DEV_USER_HEADER]).toBe(storage.getItem(DEV_USER_KEY));
    expect(hasAuthTokenSource()).toBe(false);
  });

  it("mints the id once and reuses it across requests", async () => {
    const first = await authHeaders(storage);
    const second = await authHeaders(storage);
    expect(second[DEV_USER_HEADER]).toBe(first[DEV_USER_HEADER]);
  });

  it("produces a header the server's own provider accepts", async () => {
    // The provider itself lives in the PRIVATE repo now, so this half asserts
    // that what the browser SENDS satisfies the shared contract, and the
    // private suite asserts that DevAuthProvider accepts exactly that set
    // (packages/backend/test/auth.test.ts). One predicate, pinned from both
    // sides — which is stronger than the in-process round trip it replaces,
    // because that one could only ever see its own repo.
    const h = await authHeaders(storage);
    expect(isDevUserId(h[DEV_USER_HEADER])).toBe(true);
  });
});

/**
 * The second mode, for the PUBLIC pages (TEN-107). `/gallery` and `/world`
 * are meant to be readable with no account, and every /v1 route is behind
 * auth today, so they send the id this browser already has — and never make
 * one up, because a page that works only because it minted a caller is a page
 * that will fail for the first real visitor.
 */
describe("an optional identity", () => {
  it("sends the id this browser already has", async () => {
    storage.setItem(DEV_USER_KEY, "web-abc123");
    expect(await authHeaders(storage, "optional")).toEqual({ [DEV_USER_HEADER]: "web-abc123" });
  });

  it("sends NOTHING when there is none, and mints none", async () => {
    expect(await authHeaders(storage, "optional")).toEqual({});
    expect(storage.map.size).toBe(0);
  });

  it("ignores a stored id that is not a legal one, and still mints nothing", async () => {
    storage.setItem(DEV_USER_KEY, "not a legal id!");
    expect(await authHeaders(storage, "optional")).toEqual({});
    expect(storage.getItem(DEV_USER_KEY)).toBe("not a legal id!");
  });

  it("still prefers a proven token", async () => {
    setAuthTokenSource(async () => "jwt-abc");
    expect(await authHeaders(storage, "optional")).toEqual({ authorization: "Bearer jwt-abc" });
  });

  it("existingDevUser reads without writing — no mint, no cookie mirror", () => {
    // Whatever a previous test left in `document.cookie` must be UNCHANGED:
    // the point is that this function writes nothing, not that the jar is
    // empty.
    const before = document.cookie;
    expect(existingDevUser(storage)).toBeNull();
    expect(storage.map.size).toBe(0);
    storage.setItem(DEV_USER_KEY, "web-abc123");
    expect(existingDevUser(storage)).toBe("web-abc123");
    expect(document.cookie).toBe(before);
  });

  it("required is still the default, and still mints", async () => {
    expect((await authHeaders(storage))[DEV_USER_HEADER]).toMatch(/^web-/);
  });
});

describe("with a token source mounted (Clerk, tomorrow)", () => {
  it("sends the bearer token INSTEAD of the dev id, never both", async () => {
    setAuthTokenSource(async () => "jwt-abc");
    const h = await authHeaders(storage);
    expect(h).toEqual({ authorization: "Bearer jwt-abc" });
    expect(h[DEV_USER_HEADER]).toBeUndefined();
    expect(hasAuthTokenSource()).toBe(true);
  });

  it("falls back to the dev id when nobody is signed in", async () => {
    setAuthTokenSource(async () => null);
    expect(Object.keys(await authHeaders(storage))).toEqual([DEV_USER_HEADER]);
  });

  it("falls back on an empty token rather than sending `Bearer `", async () => {
    setAuthTokenSource(async () => "");
    expect(Object.keys(await authHeaders(storage))).toEqual([DEV_USER_HEADER]);
  });

  it("falls back when the refresh throws — a failed refresh must not kill the run", async () => {
    setAuthTokenSource(async () => {
      throw new Error("network");
    });
    expect(Object.keys(await authHeaders(storage))).toEqual([DEV_USER_HEADER]);
  });

  it("unregisters on sign-out", async () => {
    setAuthTokenSource(async () => "jwt-abc");
    setAuthTokenSource(null);
    expect(Object.keys(await authHeaders(storage))).toEqual([DEV_USER_HEADER]);
  });
});

describe("the cookie is a same-origin convenience, never the identity of record", () => {
  it("is written next to localStorage and cleared with it", () => {
    const user = devUser(storage);
    expect(document.cookie).toContain(`${DEV_USER_COOKIE}=${user}`);
    clearDevUser(storage);
    expect(document.cookie).not.toContain(`${DEV_USER_COOKIE}=${user}`);
  });

  it("is Lax, so a browser will not send it to the exam service", () => {
    // The assertion the cutover rests on: cross-origin needs the HEADER.
    // jsdom drops attributes from document.cookie, so pin the written string.
    let written = "";
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
    Object.defineProperty(document, "cookie", {
      configurable: true,
      set: (v: string) => {
        written = v;
      },
    });
    devUser(storage);
    Object.defineProperty(document, "cookie", desc as PropertyDescriptor);
    expect(written).toContain("SameSite=Lax");
    expect(written).not.toContain("SameSite=None");
  });
});
