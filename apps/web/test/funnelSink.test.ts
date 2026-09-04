// @vitest-environment jsdom
/**
 * THE FUNNEL SINK THAT IS NOT THERE (TEN-133).
 *
 * On 2026-09-04 every page load on staging posted `POST /v1/events` and got
 * 404 `{"error":{"code":"not_found","message":"no such route"}}`. The exam
 * service mounts no such route; `FUNNEL_EVENTS_PATH` sat OUTSIDE `API_ROUTES`,
 * so `apps/web/test/routeManifest.test.ts` never saw the spelling, and the
 * emitter reads no response, so it posted again on the next page and the one
 * after. Every funnel step in docs/KPI.md was dropped in silence.
 *
 * Two things are pinned here. The path is the manifest's, so the guard covers
 * it and both repositories mean one URL. And a 404 stops the emitter: it says
 * so once, to the console, and makes no further request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_ROUTES, apiPath, FUNNEL_EVENTS_PATH } from "@ailx/contract";
// The emitter keeps the CONSTANT rather than calling `apiPath` — the daily's
// import guard (dailyChallenge.test.tsx) allows the funnel schema's names out
// of `@ailx/contract` and nothing else. The constant IS the manifest's path.
import { funnel, resetFunnel } from "../lib/data/funnel";

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

let posts: string[] = [];
let warnings: string[] = [];

function serviceAnswering(status: number): void {
  vi.stubGlobal("fetch", async (url: unknown) => {
    posts.push(String(url));
    return new Response(status === 404 ? '{"error":{"code":"not_found"}}' : "{}", { status });
  });
}

beforeEach(() => {
  posts = [];
  warnings = [];
  resetFunnel();
  vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
  vi.stubEnv("NEXT_PUBLIC_AILX_API_BASE", "https://service.invalid");
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  Object.defineProperty(window, "sessionStorage", { value: memoryStorage(), configurable: true });
});

afterEach(() => {
  resetFunnel();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the path is the manifest's", () => {
  it("is one spelling, declared where every other browser URL is declared", () => {
    expect(API_ROUTES.funnelEvents).toEqual({ method: "POST", path: "/events", response: "{ ok: true }" });
    expect(FUNNEL_EVENTS_PATH).toBe(API_ROUTES.funnelEvents.path);
    expect(apiPath("funnelEvents")).toBe("/events");
  });

  it("posts to the versioned root the service actually serves", async () => {
    serviceAnswering(200);
    funnel().step("landing_viewed");
    funnel().flush();
    await Promise.resolve();
    expect(posts).toEqual(["https://service.invalid/v1/events"]);
  });
});

describe("a deployment that mounts no sink", () => {
  it("stops posting after the 404 and says so once", async () => {
    serviceAnswering(404);
    funnel().step("landing_viewed");
    funnel().flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(posts).toHaveLength(1);

    funnel().step("sitting_started");
    funnel().flush();
    await Promise.resolve();
    // The second batch was not sent: the sink answered "no such route" once,
    // and it will not grow one inside this page's life.
    expect(posts).toHaveLength(1);
    expect(warnings.join(" ")).toContain("mounts no funnel sink");
    expect(warnings).toHaveLength(1);
  });

  it("keeps trying when the sink exists and is merely unhappy", async () => {
    serviceAnswering(500);
    funnel().step("landing_viewed");
    funnel().flush();
    await Promise.resolve();
    await Promise.resolve();
    funnel().step("sitting_started");
    funnel().flush();
    await Promise.resolve();
    expect(posts).toHaveLength(2);
    expect(warnings).toEqual([]);
  });
});
