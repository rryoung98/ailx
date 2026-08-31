// @vitest-environment jsdom
/**
 * The identity seam: which credential travels with a request, and what
 * happens when the token provider is absent, empty or broken.
 *
 * This exists BEFORE Clerk is mounted on purpose (docs/ARCHITECTURE.md
 * §10.2): the switch has to be atomic, so the half that does not need a
 * provider ships first, dormant, with its edge cases already pinned.
 */
import { DevAuthProvider } from "@ailx/backend";
import { DEV_USER_COOKIE, DEV_USER_HEADER } from "@ailx/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEV_USER_KEY,
  authHeaders,
  clearDevUser,
  devUser,
  hasAuthTokenSource,
  setAuthTokenSource,
} from "../lib/authHeaders";

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
    const h = await authHeaders(storage);
    const auth = await new DevAuthProvider().verify({ [DEV_USER_HEADER]: h[DEV_USER_HEADER] as string });
    expect(auth).toEqual({ authRef: `dev:${h[DEV_USER_HEADER]}` });
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
