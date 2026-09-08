// @vitest-environment jsdom
/**
 * `lib/data/deadline.ts` — the ONE bound on a browser request (TEN-210).
 *
 * Before this module `rg -n 'AbortSignal.timeout' apps/web` returned nothing,
 * and that is not a style point: a socket that opens and then stalls never
 * rejects, so every `catch` in `lib/data` was unreachable on the failure a
 * degraded service actually produces. These tests are all built the same way
 * — a `fetch` that NEVER SETTLES — because that is the case the suite could
 * not see. Each one hangs for ever on today's `main`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiPath } from "@ailx/contract";
import {
  CALL_TIMEOUT_MS,
  TIMEOUT_COPY,
  TimeoutAbortError,
  deadline,
  fetchWithDeadline,
  isTimeout,
  withDeadline,
} from "../lib/data/deadline";
import { serviceFetch } from "../lib/data/serviceFetch";
import { createApiPersistence } from "../lib/data/persistence";
import { installMemoryStorage } from "./helpers/clientPage";

installMemoryStorage();

/**
 * A fetch that opens a socket and says nothing — for ever, unless it is
 * aborted. Rejecting with `signal.reason` is what the platform does, and it is
 * the whole reason a bound works: nothing else in the stack ever ends this.
 * Give it no signal, as every caller in `apps/web` did before TEN-210, and it
 * never settles at all.
 */
const stalls = ((_url: unknown, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  })) as unknown as typeof fetch;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the policy table", () => {
  it("gives every call class a bound", () => {
    for (const ms of Object.values(CALL_TIMEOUT_MS)) {
      expect(ms).toBeGreaterThan(0);
    }
  });

  it("orders the classes by what the request is for, not by taste", () => {
    // A poll must never outlive its own interval; a read is a page waiting; a
    // write carries work; finalize does the scoring. If this ordering ever
    // inverts, the table has stopped meaning what its comments say.
    expect(CALL_TIMEOUT_MS.poll).toBeLessThan(CALL_TIMEOUT_MS.read);
    expect(CALL_TIMEOUT_MS.read).toBeLessThan(CALL_TIMEOUT_MS.write);
    expect(CALL_TIMEOUT_MS.write).toBeLessThan(CALL_TIMEOUT_MS.finalize);
    expect(CALL_TIMEOUT_MS.beacon).toBeLessThan(CALL_TIMEOUT_MS.read);
  });
});

describe("deadline()", () => {
  it("aborts with a TimeoutError once the bound is spent", async () => {
    const d = deadline("read");
    expect(d.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS.read);
    expect(d.signal.aborted).toBe(true);
    expect(isTimeout(d.signal.reason)).toBe(true);
    expect((d.signal.reason as TimeoutAbortError).callClass).toBe("read");
  });

  it("quotes the wait in the message, because surfaces show it to a candidate", () => {
    expect(new TimeoutAbortError("content", 20_000).message).toBe(
      "the Foray service did not answer in 20s",
    );
  });

  it("lets the caller's own abort win, and keeps its reason", async () => {
    const outer = new AbortController();
    const d = deadline("read", outer.signal);
    outer.abort(new Error("unmounted"));
    expect(d.signal.aborted).toBe(true);
    expect(isTimeout(d.signal.reason)).toBe(false);
  });

  it("starts no timer at all for a caller who has already gone", () => {
    const outer = new AbortController();
    outer.abort(new Error("unmounted"));
    const d = deadline("read", outer.signal);
    expect(d.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves nothing pending once the request has settled", async () => {
    const d = deadline("finalize");
    d.settle();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS.finalize);
    expect(d.signal.aborted).toBe(false);
  });

  it("is not fooled by an ordinary abort", () => {
    expect(isTimeout(new Error("boom"))).toBe(false);
    expect(isTimeout(null)).toBe(false);
  });
});

describe("fetchWithDeadline()", () => {
  it("rejects a stalled request instead of waiting for ever", async () => {
    vi.stubGlobal("fetch", stalls);
    const p = fetchWithDeadline("write", "/api/anything");
    const settled = p.then(
      () => "resolved",
      (err: unknown) => (isTimeout(err) ? "timed out" : "other"),
    );
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS.write);
    await expect(settled).resolves.toBe("timed out");
  });
});

describe("withDeadline()", () => {
  it("bounds a whole operation, for the seam call that has several requests", async () => {
    const settled = withDeadline("content", new Promise<string>(() => {})).then(
      () => "resolved",
      (err: unknown) => (isTimeout(err) ? "timed out" : "other"),
    );
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS.content);
    await expect(settled).resolves.toBe("timed out");
  });

  it("passes a prompt answer straight through and cancels its timer", async () => {
    await expect(withDeadline("read", Promise.resolve(7))).resolves.toBe(7);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("serviceFetch, against a service that stalls", () => {
  it("ends in an error the page can render, with its own sentence", async () => {
    vi.stubGlobal("fetch", stalls);
    const p = serviceFetch(apiPath("gallery"));
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS.read);
    const state = await p;
    expect(state.state).toBe("error");
    // Not "we could not reach it": it was reached and is too slow to use, and
    // that is the one a reload can fix.
    expect(state).toEqual({ state: "error", message: TIMEOUT_COPY });
  });

  it("still reports an unmount as loading, not as a failure the reader sees", async () => {
    vi.stubGlobal("fetch", stalls);
    const outer = new AbortController();
    const p = serviceFetch(apiPath("gallery"), { signal: outer.signal });
    outer.abort();
    expect(await p).toEqual({ state: "loading" });
  });
});

describe("the attempt mirror, against a service that stalls", () => {
  it("does not park the sync queue for the life of the tab", async () => {
    const errors: unknown[] = [];
    const p = createApiPersistence(window.localStorage, {
      baseUrl: "/api",
      siteRoot: "/api",
      fetchFn: stalls,
      onSyncError: (e) => errors.push(e),
    });
    p.save([
      {
        seq: 0,
        type: "attempt_started",
        attemptId: "att-stall",
        config: {
          instrument: "ailx",
          version: "2026.1",
          locale: "en",
          budgets: { t1: 60, t2: 60, t3: 60, t4: 60 },
          demo: true,
        },
        ts: 1000,
      },
    ]);
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS.write);
    const status = await p.flush();
    expect(errors).toHaveLength(1);
    expect(isTimeout(errors[0])).toBe(true);
    expect(status.message).toBe("the Foray service did not answer in time");
  });
});
