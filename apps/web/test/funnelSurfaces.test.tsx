// @vitest-environment jsdom
/**
 * The instrumented surfaces, one test each: does the step fire, once, with
 * the shape the schema declares?
 *
 * These are deliberately end to end through the REAL emitter rather than a
 * mock of it. The thing that goes wrong with funnel instrumentation is not
 * "the function was called" — it is a step firing on a render nobody asked
 * for, or twice for one action. A mock proves neither.
 *
 * Every test runs with `NEXT_PUBLIC_AILX_API_BASE` set, because with no
 * backend the emitter is silent by design; the last describe block proves
 * that silence on the same surfaces.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type FunctionComponent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushAsync, withQueryClient } from "./helpers/clientPage";
import { FUNNEL_EVENTS_PATH, parseFunnelBatch, type FunnelEvent } from "@ailx/contract";
import { DAILY_DECK_SIZE, PRACTICE_OPTIONS, dailyDay, dailyDeck } from "@ailx/report";
import { funnel, resetFunnel } from "../lib/data/funnel";
import { DAILY_POOL } from "../lib/instrument/demoItems";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

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

/** Every batch the emitter posted, in order. */
const posts: { url: string; body: string; init: RequestInit }[] = [];

/**
 * A `fetch` that records the funnel's own POSTs and hands everything else to
 * the test's stub. The emitter uses `fetch(keepalive)` rather than a beacon
 * (lib/data/funnel.ts says why), so this is where its traffic is observed.
 */
function stubFetch(handler: (url: unknown, init?: RequestInit) => Promise<Response>): void {
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    if (String(url).includes(FUNNEL_EVENTS_PATH)) {
      posts.push({ url: String(url), body: String(init?.body ?? ""), init: init ?? {} });
      return new Response(null, { status: 204 });
    }
    return handler(url, init);
  });
}

/** The events actually posted, parsed the way the exam service will parse them. */
async function events(): Promise<FunnelEvent[]> {
  funnel().flush();
  const out: FunnelEvent[] = [];
  for (const post of posts) {
    const parsed = parseFunnelBatch(JSON.parse(post.body));
    expect(parsed, "the service must accept every batch this app sends").not.toBeNull();
    out.push(...parsed!);
  }
  return out;
}

const steps = async (): Promise<string[]> => (await events()).map((e) => e.step);

let root: Root | null = null;
let host: HTMLElement | null = null;

// Generic in the component's props: `Record<string, unknown>` said nothing
// about what a given surface needs, so `render(ShareLink, { attemptId })` was
// checked against a component that takes no props at all. Now a missing or
// misspelt prop is a type error at the call site.
async function render<P extends object>(node: FunctionComponent<P>, props?: P): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(withQueryClient(createElement(node, props)));
  });
  await flushAsync();
  return host;
}

function buttons(): HTMLButtonElement[] {
  return [...host!.querySelectorAll("button")];
}

async function click(match: string | RegExp): Promise<void> {
  const re = typeof match === "string" ? new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : match;
  const btn = buttons().find((b) => re.test(b.textContent ?? ""));
  expect(btn, `button ${String(match)} in: ${buttons().map((b) => b.textContent).join(" | ")}`).toBeTruthy();
  await act(async () => {
    btn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  posts.length = 0;
  resetFunnel();
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  Object.defineProperty(window, "sessionStorage", { value: memoryStorage(), configurable: true });
  vi.stubEnv("NEXT_PUBLIC_AILX_API_BASE", "https://api.example");
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
  stubFetch(async () => new Response("{}", { status: 500 }));
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  resetFunnel();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("landing", () => {
  it("counts the front page once, and counts no play for the hero card sitting there", async () => {
    const Home = (await import("../app/page")).default;
    await render(Home);
    const seen = await steps();
    expect(seen.filter((s) => s === "landing_viewed")).toHaveLength(1);
    // The landing hero embeds a real drill. Dealing its deck is not a play.
    expect(seen).not.toContain("play_started");
    expect(seen[0]).toBe("visit_started");
  });

  it("posts to the exam service's events path", async () => {
    const Home = (await import("../app/page")).default;
    await render(Home);
    await events();
    expect(posts[0]!.url).toBe("https://api.example/v1/events");
    // No cookie rides with a funnel row, on any host.
    expect(posts[0]!.init.credentials).toBe("omit");
  });

  it("does not count a second visit when the page is re-rendered in the same tab", async () => {
    const Home = (await import("../app/page")).default;
    await render(Home);
    // What a real page does on the way out: the queue is drained on
    // visibilitychange before the document goes away.
    funnel().flush();
    act(() => root!.unmount());
    host!.remove();
    // A reload keeps sessionStorage; the singleton is rebuilt, as it is on a
    // real reload.
    resetFunnel();
    await render(Home);
    const seen = await steps();
    expect(seen.filter((s) => s === "landing_viewed")).toHaveLength(1);
    expect(seen.filter((s) => s === "visit_started")).toHaveLength(1);
  });
});

describe("the practice drill", () => {
  /** Play every card of the dealt round. */
  async function playRound(): Promise<void> {
    const { PracticeDrill } = await import("../features/practice/PracticeDrill");
    if (host === null) await render(PracticeDrill);
    for (let i = 0; ; i++) {
      const call = buttons().find((b) => PRACTICE_OPTIONS.includes((b.textContent ?? "") as never));
      if (call === undefined) break;
      await act(async () => call.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      const next = buttons().find((b) => /Next card|Finish the round/i.test(b.textContent ?? ""));
      if (next === undefined) break;
      await act(async () => next.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      if (i > 30) throw new Error("the round never ended");
    }
  }

  it("counts no play until a card is actually called", async () => {
    const { PracticeDrill } = await import("../features/practice/PracticeDrill");
    await render(PracticeDrill);
    expect(await steps()).not.toContain("play_started");
  });

  it("counts one start and one completion for one round", async () => {
    const { PracticeDrill } = await import("../features/practice/PracticeDrill");
    await render(PracticeDrill);
    await playRound();
    const seen = await events();
    const started = seen.filter((e) => e.step === "play_started");
    const done = seen.filter((e) => e.step === "play_completed");
    expect(started).toHaveLength(1);
    expect(done).toHaveLength(1);
    expect(started[0]).toMatchObject({ mode: "practice" });
    expect(done[0]).toMatchObject({ mode: "practice" });
    // Same round, so the two steps carry the same play id and can be paired.
    expect((done[0] as { playId: string }).playId).toBe((started[0] as { playId: string }).playId);
    expect((done[0] as { answered: number }).answered).toBeGreaterThan(0);
  });

  it("counts a second round in the same day as a second play", async () => {
    const { PracticeDrill } = await import("../features/practice/PracticeDrill");
    await render(PracticeDrill);
    await playRound();
    await click(/Another round/i);
    await playRound();
    const seen = await steps();
    expect(seen.filter((s) => s === "play_started")).toHaveLength(2);
    expect(seen.filter((s) => s === "play_completed")).toHaveLength(2);
  });
});

describe("the daily", () => {
  const DAY = dailyDay(Date.now(), -new Date().getTimezoneOffset());

  async function playDaily(): Promise<void> {
    const deck = dailyDeck(DAY, DAILY_POOL);
    for (let i = 0; i < deck.length; i++) {
      await click(deck[i]!.options[0]!);
      await click(i === deck.length - 1 ? "See today" : "Next card");
    }
  }

  it("counts one start on the first card and one completion on the last", async () => {
    const { DailyChallenge } = await import("../features/daily/DailyChallenge");
    await render(DailyChallenge);
    expect(await steps()).not.toContain("play_started");
    await playDaily();
    const seen = await events();
    expect(seen.filter((e) => e.step === "play_started")).toHaveLength(1);
    const done = seen.filter((e) => e.step === "play_completed");
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ mode: "daily", answered: DAILY_DECK_SIZE });
  });
});

describe("the scored sitting", () => {
  it("counts the start, and emits nothing else while the run is under way", async () => {
    // A connection is an ENDPOINT now, never a key in this browser (TEN-62).
    window.localStorage.setItem("ailx:llm-base-url", "https://exam.example/v1/model");
    const ExamPage = (await import("../app/exam/page")).default;
    await render(ExamPage);
    await click(/Start your run/);
    const seen = await steps();
    expect(seen.filter((s) => s === "sitting_started")).toHaveLength(1);
    // Everything a candidate does after this is exam evidence, and the
    // append-only store is where it goes (AGENTS.md core invariants).
    expect(seen).toEqual(["visit_started", "sitting_started"]);
  });
});

describe("identity", () => {
  it("counts a signed-in account once, and nothing for an anonymous one", async () => {
    const { FunnelIdentity } = await import("../lib/auth/FunnelIdentity");
    const { publishIdentity, resetIdentity } = await import("../lib/auth/identityState");
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_stub");
    resetIdentity();
    await render(FunnelIdentity);
    await act(async () => publishIdentity({ status: "anonymous", userId: null }));
    expect(await steps()).not.toContain("signed_in");
    await act(async () => publishIdentity({ status: "signed-in", userId: "user_1" }));
    await act(async () => publishIdentity({ status: "signed-in", userId: "user_1" }));
    const seen = await events();
    expect(seen.filter((e) => e.step === "signed_in")).toHaveLength(1);
    // No account id travels with it.
    expect(JSON.stringify(seen)).not.toContain("user_1");
    resetIdentity();
  });
});

describe("the share path", () => {
  const TOKEN = "b".repeat(43);

  it("counts a card that a stranger opened and that resolved", async () => {
    vi.doMock("next/navigation", () => ({
      notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
      useParams: () => ({ token: TOKEN }),
    }));
    const { sharePayloadFrom } = await import("@ailx/report");
    const share = {
      status: "unlisted",
      createdAt: "2026-02-03T10:00:00.000Z",
      views: 1,
      payload: sharePayloadFrom({ t1: 88.2, t2: 79.5, t3: 71.1, t4: 66.9 }, "Distinction", {
        instrument: "ailx 2026.1",
      }),
    };
    stubFetch(async () => new Response(JSON.stringify({ share }), { status: 200 }));
    const { ShareView } = await import("../features/share/ShareView");
    await render(ShareView);
    const seen = await steps();
    expect(seen.filter((s) => s === "share_opened")).toHaveLength(1);
    // A stranger with no history: their first event of all is the visit that
    // makes them countable at all.
    expect(seen[0]).toBe("visit_started");
    vi.doUnmock("next/navigation");
  });

  it("counts a share link the moment one exists, and sends no token with it", async () => {
    const TOKEN_A = "a".repeat(43);
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    window.localStorage.setItem("ailx:dev-user", "tester");
    const { sharePayloadFrom } = await import("@ailx/report");
    const share = {
      status: "unlisted",
      views: 0,
      token: TOKEN_A,
      payload: sharePayloadFrom({ t1: 1, t2: 1, t3: 1, t4: 1 }, "Pass", { instrument: "ailx 2026.1" }),
      rejectReason: null,
    };
    stubFetch(async (_url: unknown, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response(JSON.stringify({ share }), { status: 200 })
        : new Response("{}", { status: 404 }),
    );
    const { ShareLink } = await import("../features/report/ShareLink");
    await render(ShareLink, { attemptId: "11111111-1111-4111-8111-111111111111" });
    await click(/Create a share link/);
    const seen = await events();
    expect(seen.filter((e) => e.step === "share_created")).toHaveLength(1);
    expect(JSON.stringify(seen)).not.toContain(TOKEN_A);
  });

  it("counts nothing when the link 404s", async () => {
    vi.doMock("next/navigation", () => ({
      notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
      useParams: () => ({ token: TOKEN }),
    }));
    stubFetch(async () => new Response("{}", { status: 404 }));
    const { ShareView } = await import("../features/share/ShareView");
    await expect(render(ShareView)).rejects.toThrow();
    expect(await steps()).not.toContain("share_opened");
    vi.doUnmock("next/navigation");
  });
});

describe("the page listener", () => {
  it("leaves exactly one live visibilitychange listener behind, however often it is rebuilt", () => {
    const seen: AddEventListenerOptions[] = [];
    const real = document.addEventListener.bind(document);
    const spy = vi
      .spyOn(document, "addEventListener")
      .mockImplementation((type, handler, options) => {
        if (type === "visibilitychange" && typeof options === "object" && options !== null) {
          seen.push(options);
        }
        real(type, handler, options);
      });
    funnel();
    resetFunnel();
    funnel();
    resetFunnel();
    funnel();
    expect(seen).toHaveLength(3);
    expect(seen.filter((o) => o.signal?.aborted !== true)).toHaveLength(1);
    spy.mockRestore();
  });
});

describe("silence with no backend", () => {
  it("posts nothing at all from the landing page and a played round", async () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_API_BASE", "");
    const Home = (await import("../app/page")).default;
    await render(Home);
    const call = buttons().find((b) => PRACTICE_OPTIONS.includes((b.textContent ?? "") as never));
    if (call !== undefined) {
      await act(async () => call.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    }
    funnel().flush();
    expect(posts).toEqual([]);
    // And the static export leaves no funnel record in the browser either.
    expect(window.localStorage.getItem("ailx.funnel.client.v1")).toBeNull();
  });
});
