import { describe, expect, it } from "vitest";
import {
  DEV_AUTH_OVERRIDE,
  DEV_USER_COOKIE,
  DEV_USER_HEADER,
  DevAuthProvider,
  authProviderFromEnv,
  readCookie,
  verifiedAuthProvider,
} from "../src/auth.js";
import { ClerkAuthProvider } from "../src/clerk.js";

describe("DevAuthProvider", () => {
  const dev = new DevAuthProvider();

  it("resolves the dev header to a namespaced auth_ref", async () => {
    expect(await dev.verify({ [DEV_USER_HEADER]: "alice" })).toEqual({ authRef: "dev:alice" });
  });

  it("accepts Authorization: Bearer dev:<id>", async () => {
    expect(await dev.verify({ authorization: "Bearer dev:bob" })).toEqual({ authRef: "dev:bob" });
  });

  it("prefers the explicit dev header over the bearer token", async () => {
    expect(
      await dev.verify({ [DEV_USER_HEADER]: "alice", authorization: "Bearer dev:bob" }),
    ).toEqual({ authRef: "dev:alice" });
  });

  it("returns null with no credentials", async () => {
    expect(await dev.verify({})).toBeNull();
  });

  it("rejects ids with illegal characters (no auth_ref injection)", async () => {
    expect(await dev.verify({ [DEV_USER_HEADER]: "a b" })).toBeNull();
    expect(await dev.verify({ [DEV_USER_HEADER]: "clerk:sub" })).toBeNull();
    expect(await dev.verify({ [DEV_USER_HEADER]: "x".repeat(65) })).toBeNull();
  });

  it("ignores non-dev bearer tokens", async () => {
    expect(await dev.verify({ authorization: "Bearer eyJhbGciOi" })).toBeNull();
  });

  // A header only rides on a fetch the app makes. A server-rendered PAGE is
  // reached by a document navigation, which carries cookies and nothing else.
  it("resolves the dev cookie, so a plain navigation has an identity", async () => {
    expect(await dev.verify({ cookie: `${DEV_USER_COOKIE}=alice` })).toEqual({ authRef: "dev:alice" });
  });

  it("finds the cookie among others, in any position", async () => {
    expect(await dev.verify({ cookie: `a=1; ${DEV_USER_COOKIE}=alice; z=2` })).toEqual({
      authRef: "dev:alice",
    });
    expect(await dev.verify({ cookie: `${DEV_USER_COOKIE}=alice; z=2` })).toEqual({
      authRef: "dev:alice",
    });
  });

  it("prefers the explicit header over the cookie the browser is carrying", async () => {
    expect(
      await dev.verify({ [DEV_USER_HEADER]: "alice", cookie: `${DEV_USER_COOKIE}=mallory` }),
    ).toEqual({ authRef: "dev:alice" });
  });

  it("prefers the bearer token over the cookie", async () => {
    expect(
      await dev.verify({ authorization: "Bearer dev:bob", cookie: `${DEV_USER_COOKIE}=mallory` }),
    ).toEqual({ authRef: "dev:bob" });
  });

  // A caller who asserted a BAD id is refused outright rather than quietly
  // demoted to whatever cookie the browser had — no silent identity swap.
  it("does not fall back to the cookie when an explicit header is illegal", async () => {
    expect(await dev.verify({ [DEV_USER_HEADER]: "a b", cookie: `${DEV_USER_COOKIE}=alice` })).toBeNull();
  });

  it("rejects an illegal cookie id exactly as it rejects a header one", async () => {
    expect(await dev.verify({ cookie: `${DEV_USER_COOKIE}=clerk:sub` })).toBeNull();
    expect(await dev.verify({ cookie: `${DEV_USER_COOKIE}=${"x".repeat(65)}` })).toBeNull();
    expect(await dev.verify({ cookie: `${DEV_USER_COOKIE}=` })).toBeNull();
  });

  it("ignores unrelated cookies", async () => {
    expect(await dev.verify({ cookie: "session=abc; theme=dark" })).toBeNull();
    expect(await dev.verify({ cookie: "" })).toBeNull();
    // A prefix match must not count.
    expect(await dev.verify({ cookie: `x_${DEV_USER_COOKIE}=alice` })).toBeNull();
  });
});

describe("readCookie", () => {
  it("reads a named value, trimming the spacing browsers actually send", () => {
    expect(readCookie("a=1; b=2", "b")).toBe("2");
    expect(readCookie("a=1;b=2", "b")).toBe("2");
  });

  it("percent-decodes, so a written value round-trips", () => {
    expect(readCookie(`x=${encodeURIComponent("a@b.c")}`, "x")).toBe("a@b.c");
  });

  it("returns undefined for absent, empty and valueless entries", () => {
    expect(readCookie(undefined, "x")).toBeUndefined();
    expect(readCookie("", "x")).toBeUndefined();
    expect(readCookie("y=1", "x")).toBeUndefined();
    expect(readCookie("x=", "x")).toBeUndefined();
    expect(readCookie("x", "x")).toBeUndefined();
  });

  it("takes the first of a duplicated name rather than throwing", () => {
    expect(readCookie("x=1; x=2", "x")).toBe("1");
  });

  it("survives a malformed %-escape instead of throwing at the auth seam", () => {
    expect(readCookie("x=%zz", "x")).toBe("%zz");
  });
});

describe("ClerkAuthProvider", () => {
  const clerk = new ClerkAuthProvider("sk_test_x");

  it("returns null without a bearer token", async () => {
    expect(await clerk.verify({})).toBeNull();
    expect(await clerk.verify({ authorization: "Basic abc" })).toBeNull();
  });

  it("returns null for a malformed token instead of throwing", async () => {
    expect(await clerk.verify({ authorization: "Bearer not-a-jwt" })).toBeNull();
  });
});

describe("verifiedAuthProvider", () => {
  it("hands back the already-verified identity, ignoring headers", async () => {
    const p = verifiedAuthProvider("clerk", { authRef: "clerk:sub_1" });
    expect(p.name).toBe("clerk");
    expect(await p.verify({})).toEqual({ authRef: "clerk:sub_1" });
    expect(await p.verify({ [DEV_USER_HEADER]: "mallory" })).toEqual({ authRef: "clerk:sub_1" });
  });
});

describe("authProviderFromEnv (fails CLOSED)", () => {
  it("refuses to start with no AILX_AUTH at all", async () => {
    await expect(authProviderFromEnv({})).rejects.toThrow(/AILX_AUTH is not set/);
  });

  it("refuses an empty AILX_AUTH", async () => {
    await expect(authProviderFromEnv({ AILX_AUTH: "" })).rejects.toThrow(/AILX_AUTH is not set/);
  });

  it("names both remedies in the unset message (actionable)", async () => {
    await expect(authProviderFromEnv({})).rejects.toThrow(/AILX_AUTH=clerk/);
    await expect(authProviderFromEnv({})).rejects.toThrow(/CLERK_SECRET_KEY/);
  });

  it("never falls back to dev when only production-ish env is present", async () => {
    await expect(
      authProviderFromEnv({ NODE_ENV: "production", DATABASE_URL: "postgres://x" }),
    ).rejects.toThrow(/AILX_AUTH is not set/);
  });

  it("selects dev explicitly outside production", async () => {
    expect((await authProviderFromEnv({ AILX_AUTH: "dev" })).name).toBe("dev");
    expect((await authProviderFromEnv({ AILX_AUTH: "dev", NODE_ENV: "development" })).name).toBe("dev");
    expect((await authProviderFromEnv({ AILX_AUTH: "dev", NODE_ENV: "test" })).name).toBe("dev");
  });

  it("refuses dev under NODE_ENV=production", async () => {
    await expect(
      authProviderFromEnv({ AILX_AUTH: "dev", NODE_ENV: "production" }),
    ).rejects.toThrow(/AILX_AUTH=dev is refused under NODE_ENV=production/);
  });

  it("allows dev in production only with the explicit unsafe override", async () => {
    const env = { AILX_AUTH: "dev", NODE_ENV: "production", [DEV_AUTH_OVERRIDE]: "1" };
    expect((await authProviderFromEnv(env)).name).toBe("dev");
  });

  it("treats any override value other than \"1\" as not set", async () => {
    for (const value of ["", "0", "true", "yes"]) {
      await expect(
        authProviderFromEnv({ AILX_AUTH: "dev", NODE_ENV: "production", [DEV_AUTH_OVERRIDE]: value }),
      ).rejects.toThrow(/refused under NODE_ENV=production/);
    }
  });

  it("ignores the override when dev auth was never selected", async () => {
    await expect(
      authProviderFromEnv({ [DEV_AUTH_OVERRIDE]: "1" }),
    ).rejects.toThrow(/AILX_AUTH is not set/);
  });

  it("selects clerk when a secret key is present", async () => {
    const p = await authProviderFromEnv({ AILX_AUTH: "clerk", CLERK_SECRET_KEY: "sk_test_x" });
    expect(p.name).toBe("clerk");
  });

  it("selects clerk under production without any override", async () => {
    const p = await authProviderFromEnv({
      AILX_AUTH: "clerk",
      CLERK_SECRET_KEY: "sk_test_x",
      NODE_ENV: "production",
    });
    expect(p.name).toBe("clerk");
  });

  it("refuses clerk mode without a secret key", async () => {
    await expect(authProviderFromEnv({ AILX_AUTH: "clerk" })).rejects.toThrow(/CLERK_SECRET_KEY/);
  });

  it("refuses an unknown mode", async () => {
    await expect(authProviderFromEnv({ AILX_AUTH: "auth0" })).rejects.toThrow(/unknown AILX_AUTH/);
    await expect(authProviderFromEnv({ AILX_AUTH: "DEV" })).rejects.toThrow(/unknown AILX_AUTH/);
  });
});
