/**
 * TEN-213 — the three reads that happen on the SERVER, on a render path with
 * a platform deadline of its own.
 *
 * Their `catch` fallbacks were written for an unreachable service, and a
 * service that HANGS never reaches them: the function ran out of budget and
 * the visitor got the platform's 504 instead of the honest sentence. A
 * recruiter checking a credential and every social cache scraping a share
 * card are exactly the readers that hit a service under load.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CODE = "AILX-2026.1-AB12-CD34-EF56-GH78";
const TOKEN = "tok-abcdefgh";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "ailx.example" }),
}));

/** A service that accepts the connection and never answers. */
function stubHangingService(): { signals: Array<AbortSignal | null | undefined> } {
  const signals: Array<AbortSignal | null | undefined> = [];
  vi.stubGlobal("fetch", (_url: unknown, init?: RequestInit) => {
    signals.push(init?.signal);
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "TimeoutError"));
      });
    });
  });
  return { signals };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
  vi.stubEnv("AILX_PUBLIC_ORIGIN", "https://ailx.example");
  // The budget itself is what is under test, so the test sets one it can
  // wait for. The DEFAULT is asserted separately, below.
  vi.stubEnv("AILX_SERVER_READ_TIMEOUT_MS", "25");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a server read that never answers", () => {
  it("gives the share page its not-found metadata instead of burning the function", async () => {
    const { signals } = stubHangingService();
    const { generateMetadata } = await import("../app/s/[token]/page.api");
    const meta = await generateMetadata({ params: Promise.resolve({ token: TOKEN }) });
    expect(meta.title).toContain("link not found");
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });

  it("gives the verify page its not-found title instead of burning the function", async () => {
    stubHangingService();
    const { generateMetadata } = await import("../app/verify/[code]/page.api");
    const meta = await generateMetadata({ params: Promise.resolve({ code: CODE }) });
    expect(meta.title).toContain("credential not found");
  });

  it("gives the card route its 404 instead of burning the function", async () => {
    stubHangingService();
    const { GET } = await import("../app/s/[token]/card.png/route.api");
    const res = await GET(new Request(`https://ailx.example/s/${TOKEN}/card.png`), {
      params: Promise.resolve({ token: TOKEN }),
    });
    expect(res.status).toBe(404);
  });
});

describe("the budget itself", () => {
  it("is inside the platform function limit, and is not unbounded", async () => {
    vi.unstubAllEnvs();
    const { serverReadTimeoutMs } = await import("../lib/server/page");
    // 10 s Hobby / 15 s Pro (docs/DEPLOY.md §5). The read must leave room for
    // the render that follows it.
    expect(serverReadTimeoutMs()).toBeGreaterThan(0);
    expect(serverReadTimeoutMs()).toBeLessThan(10_000);
  });

  it("ignores a value that is not a positive number", async () => {
    const { serverReadTimeoutMs } = await import("../lib/server/page");
    vi.stubEnv("AILX_SERVER_READ_TIMEOUT_MS", "nonsense");
    const fallback = serverReadTimeoutMs();
    vi.stubEnv("AILX_SERVER_READ_TIMEOUT_MS", "-5");
    expect(serverReadTimeoutMs()).toBe(fallback);
    expect(fallback).toBeGreaterThan(0);
  });
});
