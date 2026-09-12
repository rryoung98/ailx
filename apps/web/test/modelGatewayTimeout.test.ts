// @vitest-environment jsdom
/**
 * The gateway's OWN routes must be bounded too (TEN-212, adjacent path).
 *
 * TEN-212 was filed against the three MODEL request paths, and the track
 * runners now carry a deadline and a Stop button. `gatewayCall` — status,
 * disconnect, connect start and callback — is the same defect one step over:
 * the panel drives it through react-query mutations, so a service that
 * accepts the request and then says nothing leaves the mutation pending and
 * the Connect button disabled with nothing to press. A stall must end the way
 * an unreachable service already ends, not never.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readKeyStatus } from "../lib/data/modelGateway";

const store = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
  },
});

let inits: Array<RequestInit | undefined> = [];

beforeEach(() => {
  store.clear();
  inits = [];
  vi.useFakeTimers();
  vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
  vi.stubEnv("NEXT_PUBLIC_AILX_API_BASE", "https://exam.example");
  // A service that accepts the connection and then says nothing. It rejects
  // on abort, which is what a real fetch does and the only way this ends.
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) => {
      inits.push(init);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("a gateway call that never answers", () => {
  it("carries a signal and ends as unreachable rather than pending for ever", async () => {
    const read = readKeyStatus();
    const settled = expect(read).resolves.toEqual({ ok: false, httpStatus: 0 });
    await vi.advanceTimersByTimeAsync(60_000);
    await settled;
    expect(inits[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(inits[0]?.signal?.aborted).toBe(true);
  });
});
