// @vitest-environment jsdom
/**
 * TEN-206 — a failed finalize POST is never retried, so a completed hosted
 * sitting is never scored.
 *
 * `/finalize` is the only thing that issues a score of record (TEN-66), the
 * mirror posted it exactly once, and the only retry triggers were another
 * `save()` or `load()` — neither of which happens after `attempt_completed`,
 * because that is the last thing the candidate ever does. One 500 at the
 * worst moment left `Run complete` followed by a report with no score, no
 * reason and no action.
 *
 * Every case here hangs or fails on today's `main`: `resume`, `status` and
 * `subscribe` do not exist there, and the automatic retry does not happen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { append, type SequencedEntry, type SessionConfig } from "@ailx/session";
import { createApiPersistence, type AttemptPersistence } from "../lib/data/persistence";
import { FinalizeNotice } from "../features/exam/FinalizeNotice";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const CONFIG: SessionConfig = {
  instrument: "ailx",
  version: "2026.1",
  locale: "en",
  budgets: { t1: 60, t2: 60, t3: 60, t4: 60 },
  demo: true,
};

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

/** A complete sitting: started, one track sat, `attempt_completed` last. */
function completedLog(attemptId = "att-fin"): SequencedEntry[] {
  let log = append([], { type: "attempt_started", attemptId, config: CONFIG, ts: 1_000 });
  log = append(log, { type: "track_started", trackId: "t1", ts: 2_000 });
  log = append(log, { type: "track_completed", trackId: "t1", artifact: {}, timedOut: false, ts: 3_000 });
  return append(log, { type: "attempt_completed", ts: 4_000 });
}

const ATTEMPT_ID = "00000000-0000-4000-8000-0000000000aa";

/** A service that refuses `/finalize` a set number of times, then accepts it. */
function service(failFinalize: number) {
  const calls: string[] = [];
  const state = { failFinalize };
  const fetchFn = (async (url: unknown) => {
    const path = String(url);
    calls.push(path);
    if (path.endsWith("/finalize") && state.failFinalize > 0) {
      state.failFinalize--;
      return { ok: false, status: 500, json: async () => ({}) } as Response;
    }
    const body = path.endsWith("/attempts")
      ? { attempt: { id: ATTEMPT_ID } }
      : path.endsWith("/finalize")
        ? { attempt: { finalizedAt: "2026-01-05T00:00:00.000Z" } }
        : { response: { id: "1", created: true } };
    return { ok: true, status: 201, json: async () => body } as Response;
  }) as typeof fetch;
  return { fetchFn, calls, state };
}

const finalizes = (calls: readonly string[]) => calls.filter((c) => c.endsWith("/finalize")).length;

describe("the mirror retries a failed finalize on its own", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = (storage: ReturnType<typeof memoryStorage>, srv: ReturnType<typeof service>): AttemptPersistence =>
    createApiPersistence(storage, {
      baseUrl: "/api",
      siteRoot: "/api",
      fetchFn: srv.fetchFn,
      onSyncError: () => {},
    });

  it("asks again after one 500 — nothing else was ever going to", async () => {
    const storage = memoryStorage();
    const srv = service(1);
    const p = make(storage, srv);
    p.save(completedLog());
    let status = await p.flush();
    expect(finalizes(srv.calls)).toBe(1);
    expect(status.finalizePending).toBe(true);
    expect(status.finalized).toBe(false);

    // The candidate does nothing, because there is nothing left for them to
    // do. The mirror's own backoff is what gets the sitting scored.
    await vi.advanceTimersByTimeAsync(1_000);
    status = await p.flush();
    expect(finalizes(srv.calls)).toBe(2);
    expect(status.finalized).toBe(true);
    expect(status.finalizePending).toBe(false);
    expect(status.phase).toBe("synced");
  });

  it("gives up after a BOUNDED number of tries and says so, rather than hammering", async () => {
    const storage = memoryStorage();
    const srv = service(99);
    const p = make(storage, srv);
    const seen: string[] = [];
    p.subscribe((s) => seen.push(s.phase));
    p.save(completedLog());
    await p.flush();
    // Every entry of the backoff table, and not one attempt more.
    await vi.advanceTimersByTimeAsync(1_000 + 4_000 + 10_000 + 30_000 + 60_000);
    const status = await p.flush();
    expect(finalizes(srv.calls)).toBe(5);
    expect(status.phase).toBe("failed");
    expect(status.finalizePending).toBe(true);
    expect(status.failures).toBe(5);
    expect(seen).toContain("failed");
  });

  it("hands the outcome back to the caller, so a surface can render it", async () => {
    const storage = memoryStorage();
    const srv = service(0);
    const p = make(storage, srv);
    p.save(completedLog());
    await expect(p.flush()).resolves.toMatchObject({
      phase: "synced",
      finalized: true,
      finalizePending: false,
    });
  });

  it("lets a FRESH page finish a sitting the tab that ran it could not", async () => {
    const storage = memoryStorage();
    const srv = service(99);
    const dead = make(storage, srv);
    dead.save(completedLog());
    await vi.advanceTimersByTimeAsync(1_000 + 4_000 + 10_000 + 30_000);
    await dead.flush();
    expect((await dead.flush()).finalized).toBe(false);

    // The report: a new persistence over the same store, which is exactly
    // what a page load builds. It reads the stored log and asks again — the
    // pass the report never fired.
    const working = service(0);
    const report = make(storage, working);
    const status = await report.resume();
    expect(finalizes(working.calls)).toBe(1);
    expect(status.finalized).toBe(true);
  });
});

describe("what the candidate is shown", () => {
  let root: Root | null = null;
  let host: HTMLElement | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  async function render(node: ReturnType<typeof createElement>) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(node));
    return host;
  }

  it("says nothing at all when the service has the sitting", async () => {
    await render(
      createElement(FinalizeNotice, {
        status: { phase: "synced", finalized: true, finalizePending: false, failures: 0 },
        onRetry: () => {},
      }),
    );
    expect(host!.querySelector('[data-testid="finalize-notice"]')).toBeNull();
  });

  it("tells a candidate to wait while the retries are still running", async () => {
    await render(
      createElement(FinalizeNotice, {
        status: { phase: "pending", finalized: false, finalizePending: true, failures: 2 },
        onRetry: () => {},
      }),
    );
    expect(host!.textContent).toContain("Your sitting is not scored yet.");
    expect(host!.querySelector('[data-testid="finalize-retrying"]')).not.toBeNull();
    // No button while asking again is our job: an action that duplicates what
    // is already happening is not an action.
    expect(host!.querySelector("button")).toBeNull();
  });

  it("gives the one action there is once the retries are spent", async () => {
    let asked = 0;
    await render(
      createElement(FinalizeNotice, {
        status: {
          phase: "failed",
          finalized: false,
          finalizePending: true,
          failures: 5,
          message: "POST /finalize failed: 500",
        },
        onRetry: () => {
          asked += 1;
        },
      }),
    );
    const notice = host!.querySelector('[data-testid="finalize-notice"]')!;
    expect(notice.textContent).toContain("Your sitting is not scored yet.");
    // What happened, and what it means for their work — never "something went
    // wrong". The service's own words are quoted for anyone who reports it.
    expect(notice.textContent).toContain("stored in this browser");
    expect(notice.textContent).toContain("POST /finalize failed: 500");
    const button = host!.querySelector("button")!;
    expect(button.textContent).toBe("Send it again");
    await act(async () => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(asked).toBe(1);
  });
});
