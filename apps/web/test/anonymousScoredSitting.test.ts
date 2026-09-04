// @vitest-environment jsdom
/**
 * ANONYMOUS PLAY MUST NOT BE A WAY INTO A SCORED SITTING.
 *
 * The on-ramp deliberately removes the account from in front of the game:
 * practice plays, and keeps a streak, with no identity at all. A score of
 * RECORD is the one thing that cannot work that way. `participants.auth_ref`
 * is provider-scoped and means a proven identity, so a sitting nobody can be
 * held to is not a sitting — and a credential minted from one would assert
 * something about a person who was never there.
 *
 * The API refuses an anonymous caller (the backend's own tests pin that). What
 * is pinned HERE is that the browser does not route around the refusal:
 *
 *  1. a refused attempt creation yields NO attempt id, so nothing is recorded,
 *     no server deck is dealt, and no score is ever requested;
 *  2. the local practice ledger reaches nothing on the exam path — different
 *     store, different module graph, and no import either way;
 *  3. a claim carries practice day counts and can carry nothing else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ATTEMPT_KEY, LOCAL_PRACTICE_KEY } from "./helpers/keys";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string): string => readFileSync(join(WEB_ROOT, rel), "utf8");

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => { m.delete(k); },
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
  } as Storage;
}

/** Every request the app made, so a test can prove one was NEVER made. */
const calls: Array<{ url: string; method: string }> = [];

/** The exam service as it answers somebody with no identity. */
function anonymousApi(): void {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    return new Response(JSON.stringify({ error: { code: "unauthorized" } }), { status: 401 });
  });
}

async function loadPersistence() {
  vi.resetModules();
  process.env.NEXT_PUBLIC_AILX_BACKEND = "1";
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_stub";
  return import("../lib/data/persistence");
}

beforeEach(() => {
  calls.length = 0;
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  anonymousApi();
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.NEXT_PUBLIC_AILX_BACKEND = "";
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "";
});

describe("an anonymous browser gets no server attempt", () => {
  it("starts no server attempt when the service refuses the caller", async () => {
    const { startServerAttempt } = await loadPersistence();
    // The refusal REACHES the caller (TEN-114). It used to be swallowed into
    // a null, and a hosted run then started on the published practice deck.
    await expect(startServerAttempt("en")).rejects.toThrow(/401/);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /api/attempts"]);
  });

  it("records no server attempt id, so nothing downstream believes there is one", async () => {
    const { getServerAttemptId, startServerAttempt } = await loadPersistence();
    await startServerAttempt("en").catch(() => undefined);
    // Whatever attempt id the run then invents locally, the mirror knows of
    // no server attempt under it.
    expect(getServerAttemptId(window.localStorage, "att-anything")).toBeUndefined();
  });

  it("deals no server deck for a run the server never created", async () => {
    const { fetchServerDeck } = await loadPersistence();
    expect(await fetchServerDeck("att-local")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("asks for no track form either", async () => {
    const { fetchServerTrackView } = await loadPersistence();
    expect(await fetchServerTrackView("att-local", "t1")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("NEVER asks the server to score a run at all — the builder is gone", async () => {
    const persistence = await loadPersistence();
    // TEN-126: the browser asked for a per-track score at track completion and
    // the service refused an open sitting with 409, so the request shape was
    // removed rather than deferred. `/finalize` issues the scores (TEN-66) and
    // the report reads them back off GET /attempts/:id.
    expect("scoreTrackOnServer" in persistence).toBe(false);
    expect("postTrackScore" in persistence).toBe(false);
    expect(calls.filter((c) => c.url.includes("/score"))).toEqual([]);
  });

  it("keeps mirroring best-effort without inventing an attempt", async () => {
    const { createApiPersistence } = await loadPersistence();
    const errors: unknown[] = [];
    const p = createApiPersistence(window.localStorage, {
      baseUrl: "/api",
      siteRoot: "/api",
      fetchFn: fetch,
      onSyncError: (e) => errors.push(e),
    });
    p.save([{ seq: 0, type: "attempt_started", attemptId: "att-local", ts: 1 } as never]);
    await p.flush();
    // The refusal is reported, not swallowed into a pretend success, and no
    // finalize was attempted.
    expect(errors).toHaveLength(1);
    expect(calls.some((c) => c.url.includes("/finalize"))).toBe(false);
  });
});

describe("the practice ledger is nowhere near a sitting", () => {
  it("uses a store the exam path never reads or writes", () => {
    expect(LOCAL_PRACTICE_KEY).not.toBe(ATTEMPT_KEY);
    expect(LOCAL_PRACTICE_KEY.startsWith(ATTEMPT_KEY)).toBe(false);
    expect(ATTEMPT_KEY.startsWith(LOCAL_PRACTICE_KEY)).toBe(false);
  });

  it("is imported by nothing on the exam or scoring path", () => {
    for (const file of ["app/exam/page.tsx", "lib/data/persistence.ts", "lib/data/checkpoints.ts"]) {
      expect(read(file), file).not.toMatch(/localPractice/);
    }
  });

  it("imports nothing from the exam or scoring path itself", () => {
    const source = read("lib/data/localPractice.ts");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/persistence|checkpoints|scoreTrack|attempt|instrument/i);
  });

  it("carries practice day counts and nothing that could be scored", async () => {
    vi.resetModules();
    const { sanitizeClaimDays } = await import("@ailx/report");
    const smuggled = sanitizeClaimDays([
      {
        day: "2026-03-01",
        sessions: 1,
        answered: 6,
        correct: 4,
        // Everything a claim must not be able to carry.
        attemptId: "att-1",
        score: 400,
        scaled: 400,
        trackId: "t2",
        authRef: "clerk:someone-else",
        credential: true,
      },
    ]);
    expect(smuggled).toEqual([{ day: "2026-03-01", sessions: 1, answered: 6, correct: 4 }]);
  });
});

describe("the drill's own separation holds for an anonymous player", () => {
  it("keeps practice out of every scored surface, in the drill and in the ledger", () => {
    for (const file of ["features/practice/PracticeDrill.tsx", "lib/data/localPractice.ts"]) {
      const code = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      // The drill may not reach the scored bank, the attempt log, or score().
      expect(code, file).not.toMatch(/bank\.jsonl|demoItems|scoreTrack|track_scored|\/attempts/);
    }
  });
});
