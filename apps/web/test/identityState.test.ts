// @vitest-environment jsdom
/**
 * Who the browser thinks it is — the state every view reads to decide whether
 * a practice round goes to an account or stays in this browser.
 *
 * The three rules pinned here are the ones the rest of the on-ramp is built
 * on, and each of them is a bug somewhere else if it breaks:
 *
 *  1. The static export is RESOLVED (anonymous), never pending — it has no
 *     accounts at all. The hosted build starts pending and resolves when the
 *     Clerk bridge publishes.
 *  2. `pending` is a real state. Clerk answers asynchronously, and a drill
 *     that guessed "anonymous" in the meantime would deal a round the
 *     signed-in person's account never hears about.
 *  3. An id belongs to a signed-in identity and to NOTHING else. Downstream,
 *     "is there an account?" is read as "is there an id?".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const BACKEND = process.env.NEXT_PUBLIC_AILX_BACKEND;
const KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

async function load(build: "static" | "hosted") {
  vi.resetModules();
  process.env.NEXT_PUBLIC_AILX_BACKEND = build === "static" ? "" : "1";
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = build === "hosted" ? "pk_test_stub" : "";
  return import("../lib/auth/identityState");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env.NEXT_PUBLIC_AILX_BACKEND = BACKEND;
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = KEY;
});

describe("readIdentity, per build", () => {
  it("is anonymous in the static export, which has no accounts at all", async () => {
    const { readIdentity } = await load("static");
    expect(readIdentity()).toEqual({ status: "anonymous", userId: null });
  });

  it("is pending in the hosted build until the bridge publishes", async () => {
    const { readIdentity } = await load("hosted");
    expect(readIdentity()).toEqual({ status: "pending", userId: null });
  });

  it("ignores what a bridge published when this build mounts no Clerk", async () => {
    const { publishIdentity, readIdentity } = await load("static");
    publishIdentity({ status: "signed-in", userId: "user_a" });
    expect(readIdentity()).toEqual({ status: "anonymous", userId: null });
  });

  it("returns the SAME object for an unchanged state", async () => {
    // useSyncExternalStore compares snapshots by reference: a fresh object per
    // read is an infinite render loop, not a slow one.
    const { readIdentity } = await load("hosted");
    expect(readIdentity()).toBe(readIdentity());
  });
});

describe("hasIdentity — the other fact (TEN-153)", () => {
  it("is true for an account AND for the asserted dev id, false otherwise", async () => {
    // Two facts, two words: `hasIdentity` answers "will the service accept a
    // read from this browser?", `status === "signed-in"` answers "is there an
    // account?". Nearly every reader wants the first one.
    const { hasIdentity } = await load("hosted");
    expect(hasIdentity("signed-in")).toBe(true);
    expect(hasIdentity("asserted")).toBe(true);
    expect(hasIdentity("anonymous")).toBe(false);
    expect(hasIdentity("pending")).toBe(false);
  });
});

describe("publishIdentity", () => {
  it("carries a signed-in id through", async () => {
    const { publishIdentity, readIdentity } = await load("hosted");
    publishIdentity({ status: "signed-in", userId: "user_a" });
    expect(readIdentity()).toEqual({ status: "signed-in", userId: "user_a" });
  });

  it("strips an id off any state that is not signed in", async () => {
    const { publishIdentity, readIdentity } = await load("hosted");
    for (const status of ["anonymous", "pending", "asserted"] as const) {
      publishIdentity({ status, userId: "user_a" } as never);
      expect(readIdentity()).toEqual({ status, userId: null });
    }
  });

  it("notifies subscribers when the identity changes, and only then", async () => {
    const { publishIdentity, resetIdentity, subscribeIdentity } = await load("hosted");
    const seen: string[] = [];
    const stop = subscribeIdentity(() => seen.push("x"));
    publishIdentity({ status: "anonymous", userId: null });
    publishIdentity({ status: "anonymous", userId: null });
    publishIdentity({ status: "signed-in", userId: "user_a" });
    publishIdentity({ status: "signed-in", userId: "user_a" });
    stop();
    publishIdentity({ status: "anonymous", userId: null });
    resetIdentity();
    expect(seen).toHaveLength(2);
  });
});
