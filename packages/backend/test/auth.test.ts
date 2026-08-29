import { describe, expect, it } from "vitest";
import { DEV_USER_HEADER, DevAuthProvider, authProviderFromEnv } from "../src/auth.js";
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

describe("authProviderFromEnv", () => {
  it("defaults to the dev provider with no env at all", async () => {
    expect((await authProviderFromEnv({})).name).toBe("dev");
  });

  it("selects dev explicitly", async () => {
    expect((await authProviderFromEnv({ AILX_AUTH: "dev" })).name).toBe("dev");
  });

  it("selects clerk when a secret key is present", async () => {
    const p = await authProviderFromEnv({ AILX_AUTH: "clerk", CLERK_SECRET_KEY: "sk_test_x" });
    expect(p.name).toBe("clerk");
  });

  it("refuses clerk mode without a secret key", async () => {
    await expect(authProviderFromEnv({ AILX_AUTH: "clerk" })).rejects.toThrow(/CLERK_SECRET_KEY/);
  });

  it("refuses an unknown mode", async () => {
    await expect(authProviderFromEnv({ AILX_AUTH: "auth0" })).rejects.toThrow(/unknown AILX_AUTH/);
  });
});
