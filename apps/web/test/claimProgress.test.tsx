// @vitest-environment jsdom
/**
 * The CLAIM: an anonymous player signs in, and the practice days their browser
 * was holding move to the account.
 *
 * This is the path that must not fail quietly. Losing somebody's streak at the
 * moment they finally sign up is the worst possible time to lose it, so what
 * is asserted here is deliberately paranoid:
 *
 *  - a day is marked claimed ONLY when the server says it stored that day;
 *  - a failed claim loses nothing and is retried at the next sign-in;
 *  - a day already claimed is never offered to a second account;
 *  - the claim carries practice day counts and NOTHING else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LOCAL_PRACTICE_KEY } from "@ailx/report";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const store = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
  },
  configurable: true,
});

interface Posted {
  url: string;
  body: { days?: Array<Record<string, unknown>> };
  headers: Record<string, string>;
}

const posted: Posted[] = [];
/** What the server says it stored. Null = the request fails outright. */
let stored: string[] | null = [];

function installFetch(): void {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    posted.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    if (stored === null) throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify({ claimed: stored, progress: {} }), { status: 200 });
  });
}

function seed(days: Array<{ day: string; claimed?: boolean }>): void {
  store.set(
    LOCAL_PRACTICE_KEY,
    JSON.stringify({
      days: days.map((entry) => ({
        day: entry.day,
        sessions: 1,
        answered: 6,
        correct: 4,
        ...(entry.claimed === true ? { claimed: true } : {}),
      })),
    }),
  );
}

/**
 * Let the claim's own promise chain settle. The component fires it and
 * returns, on purpose — a sign-in must not wait on a network call — so a test
 * that asserts on the ledger has to wait where the person does not.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function ledger(): Array<{ day: string; claimed: boolean }> {
  const raw = JSON.parse(store.get(LOCAL_PRACTICE_KEY) ?? '{"days":[]}') as {
    days: Array<{ day: string; claimed?: boolean }>;
  };
  return raw.days.map((d) => ({ day: d.day, claimed: d.claimed === true }));
}

/** A hosted build with Clerk mounted — the only build a claim exists in. */
async function load() {
  vi.resetModules();
  process.env.NEXT_PUBLIC_AILX_BACKEND = "1";
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_stub";
  return {
    localPractice: await import("../lib/localPractice"),
    identity: await import("../lib/auth/identityState"),
    claimProgress: await import("../lib/auth/ClaimProgress"),
  };
}

let root: Root | null = null;

beforeEach(() => {
  posted.length = 0;
  store.clear();
  stored = [];
  installFetch();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
});

describe("claimLocalPractice", () => {
  it("posts every unclaimed day to the claim route", async () => {
    seed([{ day: "2026-03-01" }, { day: "2026-03-02" }]);
    const { localPractice } = await load();
    await localPractice.claimLocalPractice(window.localStorage);
    expect(posted).toHaveLength(1);
    expect(posted[0]!.url).toBe("/api/practice/claim");
    expect(posted[0]!.body.days!.map((d) => d.day)).toEqual(["2026-03-01", "2026-03-02"]);
  });

  it("sends practice day counts and nothing else", async () => {
    seed([{ day: "2026-03-01" }]);
    const { localPractice } = await load();
    await localPractice.claimLocalPractice(window.localStorage);
    expect(Object.keys(posted[0]!.body)).toEqual(["days"]);
    // No item ids, no answers, no attempt, no identity of any kind — a claim
    // is four numbers about a day, and the day is all it may ever be.
    expect(Object.keys(posted[0]!.body.days![0]!).sort()).toEqual([
      "answered",
      "correct",
      "day",
      "sessions",
    ]);
  });

  it("marks exactly the days the server said it stored", async () => {
    seed([{ day: "2026-03-01" }, { day: "2026-03-02" }]);
    stored = ["2026-03-01"];
    const { localPractice } = await load();
    const outcome = await localPractice.claimLocalPractice(window.localStorage);
    expect(outcome).toEqual({ claimed: ["2026-03-01"], ok: true });
    expect(ledger()).toEqual([
      { day: "2026-03-01", claimed: true },
      { day: "2026-03-02", claimed: false },
    ]);
  });

  it("marks nothing when the server takes nothing", async () => {
    seed([{ day: "2026-03-01" }]);
    stored = [];
    const { localPractice } = await load();
    await localPractice.claimLocalPractice(window.localStorage);
    expect(ledger()).toEqual([{ day: "2026-03-01", claimed: false }]);
  });

  it("ignores a day the server names that this browser never sent", async () => {
    seed([{ day: "2026-03-01" }]);
    stored = ["2026-03-01", "1999-01-01"];
    const { localPractice } = await load();
    await localPractice.claimLocalPractice(window.localStorage);
    expect(ledger()).toEqual([{ day: "2026-03-01", claimed: true }]);
  });

  it("ignores a claimed list that is not a list of strings", async () => {
    seed([{ day: "2026-03-01" }]);
    stored = [42, { day: "2026-03-01" }] as unknown as string[];
    const { localPractice } = await load();
    const outcome = await localPractice.claimLocalPractice(window.localStorage);
    expect(outcome!.claimed).toEqual([]);
    expect(ledger()).toEqual([{ day: "2026-03-01", claimed: false }]);
  });

  it("loses nothing when the claim fails, so the next sign-in retries it", async () => {
    seed([{ day: "2026-03-01" }, { day: "2026-03-02" }]);
    stored = null;
    const { localPractice } = await load();
    const outcome = await localPractice.claimLocalPractice(window.localStorage);
    expect(outcome).toEqual({ claimed: [], ok: false });
    expect(ledger().every((d) => !d.claimed)).toBe(true);
    // And the retry, once the network is back, hands over exactly the same days.
    stored = ["2026-03-01", "2026-03-02"];
    await localPractice.claimLocalPractice(window.localStorage);
    expect(posted[1]!.body.days!.map((d) => d.day)).toEqual(["2026-03-01", "2026-03-02"]);
    expect(ledger().every((d) => d.claimed)).toBe(true);
  });

  it("never offers a claimed day to a second account", async () => {
    seed([{ day: "2026-03-01", claimed: true }, { day: "2026-03-02" }]);
    stored = ["2026-03-02"];
    const { localPractice } = await load();
    await localPractice.claimLocalPractice(window.localStorage);
    expect(posted[0]!.body.days!.map((d) => d.day)).toEqual(["2026-03-02"]);
  });

  it("posts nothing at all when there is nothing to hand over", async () => {
    seed([{ day: "2026-03-01", claimed: true }]);
    const { localPractice } = await load();
    expect(await localPractice.claimLocalPractice(window.localStorage)).toBeNull();
    expect(posted).toEqual([]);
  });

  it("posts nothing for a browser that never practised", async () => {
    const { localPractice } = await load();
    expect(await localPractice.claimLocalPractice(window.localStorage)).toBeNull();
    expect(posted).toEqual([]);
  });

  it("carries the caller's identity headers", async () => {
    seed([{ day: "2026-03-01" }]);
    const { localPractice } = await load();
    await localPractice.claimLocalPractice(window.localStorage);
    // Dev auth asserts an id; Clerk replaces it with a bearer token through
    // the same one module. Either way the claim is never anonymous — it is
    // the request that says WHICH account these days are for.
    const headers = posted[0]!.headers;
    expect("x-ailx-dev-user" in headers || "authorization" in headers).toBe(true);
  });

  it("drops a day localStorage was rewritten to make impossible", async () => {
    store.set(
      LOCAL_PRACTICE_KEY,
      JSON.stringify({
        days: [
          { day: "2026-03-01", sessions: 1, answered: 6, correct: 4 },
          { day: "2026-03-02", sessions: 9999, answered: 9999, correct: 9999 },
        ],
      }),
    );
    const { localPractice } = await load();
    await localPractice.claimLocalPractice(window.localStorage);
    expect(posted[0]!.body.days!.map((d) => d.day)).toEqual(["2026-03-01"]);
  });
});

describe("<ClaimProgress>", () => {
  async function mount(): Promise<{
    identity: Awaited<ReturnType<typeof load>>["identity"];
  }> {
    const { identity, claimProgress } = await load();
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(createElement(claimProgress.ClaimProgress));
    });
    return { identity };
  }

  it("claims nothing while nobody is signed in", async () => {
    seed([{ day: "2026-03-01" }]);
    const { identity } = await mount();
    await act(async () => identity.publishIdentity({ status: "anonymous", userId: null }));
    expect(posted).toEqual([]);
  });

  it("claims nothing while the identity is still pending", async () => {
    seed([{ day: "2026-03-01" }]);
    await mount();
    expect(posted).toEqual([]);
  });

  it("claims the moment somebody signs in", async () => {
    seed([{ day: "2026-03-01" }]);
    stored = ["2026-03-01"];
    const { identity } = await mount();
    await act(async () => identity.publishIdentity({ status: "signed-in", userId: "user_a" }));
    await settle();
    expect(posted).toHaveLength(1);
    expect(ledger()).toEqual([{ day: "2026-03-01", claimed: true }]);
  });

  it("claims once per account, however many times the identity is republished", async () => {
    seed([{ day: "2026-03-01" }]);
    stored = ["2026-03-01"];
    const { identity } = await mount();
    for (let i = 0; i < 3; i++) {
      await act(async () => identity.publishIdentity({ status: "signed-in", userId: "user_a" }));
      await settle();
      // A token refresh republishes the same identity; nothing to re-post.
      await act(async () => identity.publishIdentity({ status: "pending", userId: null }));
      await settle();
    }
    expect(posted).toHaveLength(1);
  });

  it("tries once per account even when the try failed — the retry is the next sign-in", async () => {
    seed([{ day: "2026-03-01" }]);
    stored = null;
    const { identity } = await mount();
    await act(async () => identity.publishIdentity({ status: "signed-in", userId: "user_a" }));
    await settle();
    await act(async () => identity.publishIdentity({ status: "pending", userId: null }));
    await act(async () => identity.publishIdentity({ status: "signed-in", userId: "user_a" }));
    await settle();
    // A failed claim loses nothing and is retried when this browser next
    // signs in. It is NOT retried on every token refresh, which would be a
    // failing request every few minutes for as long as the tab is open.
    expect(posted).toHaveLength(1);
    expect(ledger()).toEqual([{ day: "2026-03-01", claimed: false }]);
  });

  it("claims nothing for an anonymous identity that somehow carries an id", async () => {
    seed([{ day: "2026-03-01" }]);
    stored = ["2026-03-01"];
    const { identity } = await mount();
    // Not a real state — `publishIdentity` normalizes it away, and this is the
    // test that says so. An id is what "there is an account" MEANS downstream,
    // so an anonymous state carrying one would be an account that never
    // existed, claiming days on its behalf.
    await act(async () =>
      identity.publishIdentity({ status: "anonymous", userId: "user_a" } as never),
    );
    await settle();
    expect(posted).toEqual([]);
    expect(identity.readIdentity().userId).toBeNull();
  });

  it("claims again for a DIFFERENT account, and offers it only what is left", async () => {
    seed([{ day: "2026-03-01" }, { day: "2026-03-02" }]);
    stored = ["2026-03-01", "2026-03-02"];
    const { identity } = await mount();
    await act(async () => identity.publishIdentity({ status: "signed-in", userId: "user_a" }));
    await settle();
    await act(async () => identity.publishIdentity({ status: "anonymous", userId: null }));
    await act(async () => identity.publishIdentity({ status: "signed-in", userId: "user_b" }));
    await settle();
    // The second account is offered nothing: those days are already somebody's.
    expect(posted).toHaveLength(1);
  });

  it("renders nothing at all", async () => {
    seed([{ day: "2026-03-01" }]);
    const { identity } = await mount();
    await act(async () => identity.publishIdentity({ status: "signed-in", userId: "user_a" }));
    expect(document.body.querySelector("div")!.textContent).toBe("");
  });
});
