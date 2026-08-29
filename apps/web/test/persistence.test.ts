import { beforeEach, describe, expect, it, vi } from "vitest";
import { append, SaveConflictError, ATTEMPT_KEY, type SequencedEntry, type SessionConfig } from "@ailx/session";
import {
  DEV_USER_KEY,
  DeckMismatchError,
  createApiPersistence,
  createLocalPersistence,
  createServerAttempt,
  startServerAttempt,
  type AttemptPersistence,
} from "../lib/persistence";
import { t2DeckRecords } from "../lib/instrument";

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    _map: map,
  };
}

interface Call {
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

/** Programmable fetch double: records calls; `failNext` makes calls reject. */
function fakeFetch(serverAttemptId = "00000000-0000-4000-8000-0000000000aa") {
  const calls: Call[] = [];
  const state = { failNext: 0 };
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    const path = String(url);
    calls.push({
      path,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    if (state.failNext > 0) {
      state.failNext--;
      throw new Error("network down");
    }
    const body = path.endsWith("/attempts")
      ? { attempt: { id: serverAttemptId } }
      : path.endsWith("/finalize")
        ? { attempt: { finalizedAt: "2026-01-05T00:00:00.000Z", alreadyFinalized: false } }
        : { response: { id: "1", created: true } };
    return { ok: true, status: 201, json: async () => body } as Response;
  }) as typeof fetch;
  return { fetchFn, calls, state };
}

const CONFIG: SessionConfig = {
  instrument: "ailx",
  version: "2026.1",
  locale: "en",
  budgets: { t1: 60, t2: 60, t3: 60, t4: 60 },
  demo: true,
};

function startedLog(attemptId = "att-abc123"): SequencedEntry[] {
  return append([], { type: "attempt_started", attemptId, config: CONFIG, ts: 1000 });
}

// ---------------------------------------------------------------------------

describe("createLocalPersistence", () => {
  it("round-trips a log and clears it — previous showcase behaviour", () => {
    const storage = fakeStorage();
    const p = createLocalPersistence(storage);
    expect(p.load()).toBeNull();
    const log = startedLog();
    p.save(log);
    expect(p.load()?.log).toEqual(log);
    p.clear();
    expect(p.load()).toBeNull();
  });

  it("flush resolves immediately (nothing to sync)", async () => {
    await expect(createLocalPersistence(fakeStorage()).flush()).resolves.toBeUndefined();
  });
});

describe("createApiPersistence", () => {
  let storage: ReturnType<typeof fakeStorage>;
  let server: ReturnType<typeof fakeFetch>;
  let p: AttemptPersistence;
  let syncErrors: unknown[];

  const make = () =>
    createApiPersistence(storage, {
      baseUrl: "/api",
      fetchFn: server.fetchFn,
      onSyncError: (e) => syncErrors.push(e),
    });

  beforeEach(() => {
    storage = fakeStorage();
    server = fakeFetch();
    syncErrors = [];
    p = make();
  });

  it("keeps localStorage authoritative and mirrors entries in order", async () => {
    const log = startedLog();
    p.save(log);
    await p.flush();
    expect(p.load()?.log).toEqual(log);
    expect(server.calls.map((c) => c.path)).toEqual(["/api/attempts", "/api/attempts/00000000-0000-4000-8000-0000000000aa/responses"]);
    expect(server.calls[1].body).toMatchObject({ seq: 0, clientTs: 1000, payload: log[0] });
    expect(syncErrors).toEqual([]);
  });

  it("sends a stable dev identity header on every call", async () => {
    p.save(startedLog());
    await p.flush();
    const users = server.calls.map((c) => c.headers["x-ailx-dev-user"]);
    expect(users[0]).toMatch(/^web-/);
    expect(new Set(users).size).toBe(1);
    expect(storage.getItem(DEV_USER_KEY)).toBe(users[0]);
  });

  it("mirrors only NEW entries on subsequent saves", async () => {
    let log = startedLog();
    p.save(log);
    await p.flush();
    log = append(log, { type: "track_started", trackId: "t1", ts: 2000 });
    p.save(log);
    await p.flush();
    const responsePosts = server.calls.filter((c) => c.path.endsWith("/responses"));
    expect(responsePosts.map((c) => (c.body as { seq: number }).seq)).toEqual([0, 1]);
  });

  it("retries from the last synced point after a network failure", async () => {
    server.state.failNext = 2; // create-attempt + its retry both die
    const log = startedLog();
    p.save(log);
    await p.flush();
    expect(syncErrors.length).toBe(1);
    p.save(log); // next save retries the whole remainder
    await p.flush();
    expect(syncErrors.length).toBe(2);
    p.save(log);
    await p.flush();
    const responsePosts = server.calls.filter((c) => c.path.endsWith("/responses"));
    expect(responsePosts).toHaveLength(1);
    expect(syncErrors.length).toBe(2);
  });

  it("resumes an interrupted sync on load() after a reload", async () => {
    p.save(startedLog());
    await p.flush();
    server.calls.length = 0;
    const reloaded = make(); // fresh instance, same storage — as after a reload
    const v = reloaded.load();
    expect(v?.log).toHaveLength(1);
    await reloaded.flush();
    // Everything was already synced — nothing is re-sent.
    expect(server.calls).toEqual([]);
  });

  it("does not re-create the server attempt across instances", async () => {
    p.save(startedLog());
    await p.flush();
    const again = make();
    let log = again.load()!.log;
    log = append(log, { type: "track_started", trackId: "t1", ts: 2000 });
    again.save(log);
    await again.flush();
    expect(server.calls.filter((c) => c.path === "/api/attempts")).toHaveLength(1);
  });

  it("finalizes exactly once when the log completes", async () => {
    let log = startedLog();
    for (const t of ["t1", "t2", "t3", "t4"] as const) {
      log = append(log, { type: "track_started", trackId: t, ts: 2000 });
      log = append(log, { type: "track_completed", trackId: t, artifact: {}, timedOut: false, ts: 2000 });
      log = append(log, {
        type: "track_scored", trackId: t, score: { raw: {}, scaled: 50 },
        rubricVersion: "r", scoringDigest: "d", modelManifest: {}, ts: 2000,
      });
    }
    log = append(log, { type: "attempt_completed", ts: 3000 });
    p.save(log);
    await p.flush();
    p.save(log); // replayed save after completion
    await p.flush();
    const finalizes = server.calls.filter((c) => c.path.endsWith("/finalize"));
    expect(finalizes).toHaveLength(1);
    const responsePosts = server.calls.filter((c) => c.path.endsWith("/responses"));
    expect(responsePosts).toHaveLength(log.length);
  });

  it("clear drops local state + sync bookkeeping but never touches the server", async () => {
    p.save(startedLog());
    await p.flush();
    server.calls.length = 0;
    p.clear();
    await p.flush();
    expect(p.load()).toBeNull();
    expect(storage._map.has("ailx:sync:v1:att-abc123")).toBe(false);
    expect(server.calls).toEqual([]); // append-only server rows stay
  });

  it("recovers from corrupt sync bookkeeping (server idempotency absorbs re-sends)", async () => {
    p.save(startedLog());
    await p.flush();
    storage.setItem("ailx:sync:v1:att-abc123", "{corrupt");
    server.calls.length = 0;
    const again = make();
    again.load();
    await again.flush();
    // Restarted from scratch: re-created attempt + re-sent entry (server replays them).
    expect(server.calls.map((c) => c.path.split("/").pop())).toEqual(["attempts", "responses"]);
  });

  it("propagates local SaveConflictError before any mirroring", async () => {
    const log = startedLog();
    p.save(log);
    await p.flush();
    server.calls.length = 0;
    // Simulate a foreign tab bumping the stored revision.
    const stored = JSON.parse(storage.getItem(ATTEMPT_KEY)!);
    stored.rev += 1;
    storage.setItem(ATTEMPT_KEY, JSON.stringify(stored));
    expect(() => p.save(append(log, { type: "track_started", trackId: "t1", ts: 2000 }))).toThrow(SaveConflictError);
    await p.flush();
    expect(server.calls).toEqual([]);
  });

  it("an empty or foreign log never hits the network", async () => {
    p.load();
    await p.flush();
    expect(server.calls).toEqual([]);
  });

  it("warns via console when no onSyncError handler is given", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bare = createApiPersistence(storage, { baseUrl: "/api", fetchFn: server.fetchFn });
    server.state.failNext = 1;
    bare.save(startedLog());
    await bare.flush();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("createServerAttempt (per-attempt deck keying)", () => {
  const SERVER_ID = "00000000-0000-4000-8000-0000000000aa";

  it("opts in to deck sampling and pre-writes the sync state under the server id", async () => {
    const storage = fakeStorage();
    const server = fakeFetch(SERVER_ID);
    const id = await createServerAttempt(storage, { baseUrl: "/api", fetchFn: server.fetchFn }, "ja");
    expect(id).toBe(SERVER_ID);
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0].path).toBe("/api/attempts");
    // The deck contract: locale travels, decks:true commits to the server deck.
    expect(server.calls[0].body).toEqual({ locale: "ja", decks: true });
    expect(server.calls[0].headers["x-ailx-dev-user"]).toMatch(/^web-/);
    expect(JSON.parse(storage.getItem(`ailx:sync:v1:${SERVER_ID}`)!)).toEqual({
      serverAttemptId: SERVER_ID,
      syncedThrough: 0,
      finalized: false,
    });
  });

  it("the mirror ADOPTS the pre-created attempt instead of creating a second one", async () => {
    const storage = fakeStorage();
    const server = fakeFetch(SERVER_ID);
    const opts = { baseUrl: "/api", fetchFn: server.fetchFn };
    const id = await createServerAttempt(storage, opts, "en");
    // Session adopts the server id as its attemptId; mirror log follows.
    const p = createApiPersistence(storage, opts);
    p.save(startedLog(id));
    await p.flush();
    const creates = server.calls.filter((c) => c.path === "/api/attempts");
    expect(creates).toHaveLength(1); // only the pre-creation
    const responses = server.calls.filter((c) => c.path.endsWith("/responses"));
    expect(responses.map((c) => c.path)).toEqual([`/api/attempts/${SERVER_ID}/responses`]);
    expect((responses[0].body as { seq: number }).seq).toBe(0);
  });

  it("propagates a create failure (caller falls back to a local attempt id)", async () => {
    const storage = fakeStorage();
    const server = fakeFetch(SERVER_ID);
    server.state.failNext = 1;
    await expect(
      createServerAttempt(storage, { baseUrl: "/api", fetchFn: server.fetchFn }, "en"),
    ).rejects.toThrow("network down");
    expect(storage._map.size).toBeLessThanOrEqual(1); // no sync state written (dev id at most)
  });
});

/**
 * P1-4: the client used to DISCARD the decks the server recorded and re-derive
 * its own from its OWN bundled snapshot. After a bank change, a stale tab
 * presented a deck attempt_decks says was never shown — a silent corruption of
 * the exposure log per-item stats and IRT depend on.
 */
describe("createServerAttempt deck verification", () => {
  const SERVER_ID = "00000000-0000-4000-8000-0000000000bb";

  /** POST /attempts double that answers with the given exposure decks. */
  function serverWithDecks(decks: unknown) {
    const calls: unknown[] = [];
    const fetchFn = (async (url: unknown) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 201,
        json: async () => ({ attempt: { id: SERVER_ID }, ...(decks === undefined ? {} : { decks }) }),
      } as Response;
    }) as typeof fetch;
    return { fetchFn, calls };
  }

  const create = (decks: unknown, locale = "en") => {
    const storage = fakeStorage();
    const server = serverWithDecks(decks);
    return { storage, promise: createServerAttempt(storage, { baseUrl: "/api", fetchFn: server.fetchFn }, locale) };
  };

  /** Exactly what the server's sampler (the same pure function) records. */
  const recordedDecks = (locale = "en") => t2DeckRecords(SERVER_ID, locale);

  it("accepts the deck the server actually recorded", async () => {
    const { storage, promise } = create(recordedDecks());
    await expect(promise).resolves.toBe(SERVER_ID);
    expect(JSON.parse(storage.getItem(`ailx:sync:v1:${SERVER_ID}`)!).serverAttemptId).toBe(SERVER_ID);
  });

  it("refuses a deck sampled from a DIFFERENT bank (the stale-tab deploy)", async () => {
    const stale = recordedDecks().map((d) => ({ ...d, bankSha256: "f".repeat(64) }));
    const { storage, promise } = create(stale);
    await expect(promise).rejects.toBeInstanceOf(DeckMismatchError);
    // Nothing adopted: no sync state, so no half-started attempt is mirrored.
    expect(storage.getItem(`ailx:sync:v1:${SERVER_ID}`)).toBeNull();
  });

  it("refuses a deck with different item ids", async () => {
    const swapped = recordedDecks().map((d) => ({ ...d, itemIds: [...d.itemIds.slice(1), "t2-ghost-item"] }));
    await expect(create(swapped).promise).rejects.toBeInstanceOf(DeckMismatchError);
  });

  it("refuses the same items in a different PRESENTED order", async () => {
    const reordered = recordedDecks().map((d) => ({ ...d, itemIds: [...d.itemIds].reverse() }));
    await expect(create(reordered).promise).rejects.toBeInstanceOf(DeckMismatchError);
  });

  it("refuses a deck for a track this build does not present, or a missing one", async () => {
    const extra = [...recordedDecks(), { trackId: "t3", bankSha256: "a".repeat(64), itemIds: ["x"] }];
    await expect(create(extra).promise).rejects.toBeInstanceOf(DeckMismatchError);
    await expect(create([]).promise).rejects.toBeInstanceOf(DeckMismatchError);
  });

  it("refuses a deck recorded for another LOCALE", async () => {
    // The server samples with the locale it was sent; a client that presents
    // a different locale's items is the same divergence.
    const jaDecks = t2DeckRecords(SERVER_ID, "ja");
    const en = recordedDecks();
    if (JSON.stringify(jaDecks) !== JSON.stringify(en)) {
      await expect(create(jaDecks, "en").promise).rejects.toBeInstanceOf(DeckMismatchError);
    }
    // The matching locale is accepted.
    await expect(create(jaDecks, "ja").promise).resolves.toBe(SERVER_ID);
  });

  it("accepts a response with no decks at all (host wired no sampler)", async () => {
    await expect(create(undefined).promise).resolves.toBe(SERVER_ID);
  });

  it("carries the recorded and expected banks in the error message", async () => {
    const stale = recordedDecks().map((d) => ({ ...d, bankSha256: "f".repeat(64) }));
    await expect(create(stale).promise).rejects.toThrow(/ffffffffffff/);
  });
});

describe("startServerAttempt", () => {
  it("returns null outside server mode — static showcase unchanged", async () => {
    await expect(startServerAttempt("en")).resolves.toBeNull();
  });
});
