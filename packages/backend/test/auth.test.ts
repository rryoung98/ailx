import { describe, expect, it } from "vitest";
import {
  DEV_AUTH_OVERRIDE,
  DEV_USER_HEADER,
  DevAuthProvider,
  authProviderFromEnv,
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
