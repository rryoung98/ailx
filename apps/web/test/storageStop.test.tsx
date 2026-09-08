// @vitest-environment jsdom
/**
 * TEN-208 — a localStorage quota failure was a warning banner, not a stop,
 * and the local write threw BEFORE the mirror enqueue, so the entry reached
 * NEITHER store.
 *
 * The log only grows, so the first refusal is not a one-off: every later save
 * fails the same way. The candidate kept working, kept being charged for the
 * time, and the rest of the sitting existed nowhere. Reachable in ordinary
 * T4/T1 play on a 5 MB origin budget.
 *
 * Two halves, and both fail on today's `main`: the seam must still offer the
 * work to the server, and the page must stop rather than warn.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ATTEMPT_KEY,
  append,
  SaveConflictError,
  type SequencedEntry,
  type SessionConfig,
} from "@ailx/session";
import { createApiPersistence } from "../lib/data/persistence";
import { storageStopCopy } from "../features/exam/storageStopCopy";
import { withQueryClient } from "./helpers/clientPage";
import ExamPage from "../app/exam/page";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const CONFIG: SessionConfig = {
  instrument: "ailx",
  version: "2026.1",
  locale: "en",
  budgets: { t1: 600, t2: 600, t3: 600, t4: 600 },
  demo: true,
};

/** A store with a switchable ceiling, like a browser at its origin budget. */
function cappedStorage() {
  const m = new Map<string, string>();
  const state = { full: false };
  const storage = {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => {
      m.delete(k);
    },
    setItem: (k: string, v: string) => {
      if (state.full) {
        const err = new Error("The quota has been exceeded.");
        err.name = "QuotaExceededError";
        throw err;
      }
      m.set(k, String(v));
    },
  } as Storage;
  return { storage, state, map: m };
}

describe("the seam still offers the work to the server", () => {
  const started = (): SequencedEntry[] =>
    append([], { type: "attempt_started", attemptId: "att-full", config: CONFIG, ts: 1_000 });

  function mirror(storage: Storage) {
    const calls: string[] = [];
    const fetchFn = (async (url: unknown) => {
      const path = String(url);
      calls.push(path);
      const body = path.endsWith("/attempts")
        ? { attempt: { id: "00000000-0000-4000-8000-0000000000aa" } }
        : { response: { id: "1", created: true } };
      return { ok: true, status: 201, json: async () => body } as Response;
    }) as typeof fetch;
    return {
      calls,
      p: createApiPersistence(storage, {
        baseUrl: "/api",
        siteRoot: "/api",
        fetchFn,
        onSyncError: () => {},
      }),
    };
  }

  it("mirrors an entry the local store refused, and still reports the refusal", async () => {
    const { storage, state } = cappedStorage();
    const { p, calls } = mirror(storage);
    // The run starts normally and the store fills UP mid-sitting, which is
    // how it happens: T4 promotes full-resolution finals and T1's artifact is
    // a whole HTML document.
    p.save(started());
    await p.flush();
    calls.length = 0;
    state.full = true;
    const next = append(started(), { type: "track_started", trackId: "t1", ts: 2_000 });
    // The failure is not swallowed — the page has to know, and it does.
    expect(() => p.save(next)).toThrow(/quota/i);
    await p.flush();
    // The server write is independent and is the one a score of record is
    // computed from. It used to be skipped, because the throw came first.
    expect(calls.filter((c) => c.endsWith("/responses"))).toHaveLength(1);
  });

  it("still refuses to mirror a MULTI-TAB conflict, which is a different fact", async () => {
    const { storage } = cappedStorage();
    const { p, calls } = mirror(storage);
    p.save(started());
    await p.flush();
    calls.length = 0;
    // Another tab writes past us: our log is a divergent branch of the same
    // attempt, and pushing it at the server would be worse than losing it.
    storage.setItem(
      ATTEMPT_KEY,
      JSON.stringify({ formatVersion: 1, rev: 99, log: started() }),
    );
    expect(() => p.save(append(started(), { type: "track_started", trackId: "t1", ts: 2_000 }))).toThrow(
      SaveConflictError,
    );
    await p.flush();
    expect(calls).toEqual([]);
  });
});

describe("what the candidate is told", () => {
  it("says different things about the consequences, because they differ", () => {
    const hosted = storageStopCopy({ mirrored: true, reason: "QuotaExceededError" });
    const alone = storageStopCopy({ mirrored: false, reason: "QuotaExceededError" });
    expect(hosted.body.join(" ")).toContain("going to the Foray service");
    expect(alone.body.join(" ")).toContain("no Foray service");
    expect(alone.body.join(" ")).toContain("only until you close this tab");
    // The one thing that is the same either way: the clock is not theirs to
    // pay for while they read this.
    for (const copy of [hosted, alone]) {
      expect(copy.clockNote).toContain("held");
      expect(copy.reason).toContain("QuotaExceededError");
    }
  });
});

describe("the exam page stops rather than warns", () => {
  let root: Root | null = null;
  let host: HTMLElement | null = null;
  let capped: ReturnType<typeof cappedStorage>;

  beforeEach(() => {
    capped = cappedStorage();
    Object.defineProperty(window, "localStorage", { value: capped.storage, configurable: true });
    vi.stubGlobal("fetch", (async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch);
    const log = append([], { type: "attempt_started", attemptId: "att-stop", config: CONFIG, ts: Date.now() });
    capped.storage.setItem(ATTEMPT_KEY, JSON.stringify({ formatVersion: 1, rev: 1, log }));
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    host?.remove();
    root = null;
    host = null;
    vi.unstubAllGlobals();
  });

  async function render() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(withQueryClient(createElement(ExamPage))));
    await act(async () => {
      await Promise.resolve();
    });
    return host;
  }

  const button = (label: string): HTMLButtonElement =>
    [...host!.querySelectorAll("button")].find((b) => b.textContent?.includes(label))!;

  const click = async (el: Element) => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };

  it("blocks the run when this browser will not hold it, instead of a banner over a live clock", async () => {
    await render();
    capped.state.full = true;
    await click(button("Start T2"));
    const stop = host!.querySelector('[data-testid="storage-stop"]')!;
    expect(stop, "a full store must stop the run, not warn about it").not.toBeNull();
    expect(stop.getAttribute("role")).toBe("alertdialog");
    expect(stop.textContent).toContain("This browser cannot save any more of your run.");
    expect(host!.querySelector('[data-testid="storage-stop-reason"]')!.textContent).toContain(
      "The quota has been exceeded.",
    );
    // A stop, not a banner: the old behaviour was the banner alone.
    expect(host!.querySelector('[data-testid="persist-warning"]')).toBeNull();
  });

  it("holds the clock while it is on screen, with a recorded cause", async () => {
    await render();
    capped.state.full = true;
    await click(button("Start T2"));
    // The clock is derived from the log, and the log is in memory: the store
    // is the broken thing, so a hold that needed the store would never work.
    expect(host!.textContent).toContain("Your track clock is held");
    // Freeing space and asking again resumes exactly the hold we placed.
    capped.state.full = false;
    await click(button("Save it again"));
    expect(host!.querySelector('[data-testid="storage-stop"]')).toBeNull();
    const stored = JSON.parse(capped.storage.getItem(ATTEMPT_KEY)!) as { log: SequencedEntry[] };
    const verbs = stored.log.flatMap((e) =>
      e.type === "track_event" ? [(e as { event: { verb: string } }).event.verb] : [],
    );
    expect(verbs).toContain("storage_exhausted");
    expect(stored.log.some((e) => e.type === "resumed")).toBe(true);
  });

  it("lets a candidate carry on once, having been told what it costs", async () => {
    await render();
    capped.state.full = true;
    await click(button("Start T2"));
    await click(button("Carry on anyway"));
    expect(host!.querySelector('[data-testid="storage-stop"]')).toBeNull();
    const warning = host!.querySelector('[data-testid="persist-warning"]')!;
    expect(warning.textContent).toContain("Not saved in this browser");
    expect(warning.textContent).toContain("you chose to carry on");
  });
});
