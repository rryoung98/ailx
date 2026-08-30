// @vitest-environment jsdom
/**
 * HOSTED MODE, end to end in the page: the deck the candidate sits is the
 * SERVER's, not this build's.
 *
 * This is the whole point of the custody split (docs/ARCHITECTURE.md §2.1):
 * the browser has no operational bank, so the exam page must fetch
 * GET /api/attempts/:id/items and present exactly what came back — and must
 * refuse to present anything at all when that deck contradicts the deck the
 * server recorded at create.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Runner as T2Runner } from "@ailx/track-t2";
import { append, saveAttempt, type SessionConfig } from "@ailx/session";
import { syncKey } from "../lib/persistence";
import { trackConfig } from "../lib/instrument";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../lib/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/registry")>();
  return { ...actual, loadTrackModule: async () => ({ placeholder: false, Runner: T2Runner }) };
});

const ExamPage = (await import("../app/exam/page")).default;

const ATTEMPT = "00000000-0000-4000-8000-0000000000ee";
const BANK = "b".repeat(64);
const SERVER_STEM = "Server-dealt item: hostile or legitimate?";

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

const config: SessionConfig = {
  instrument: "ailx", version: "2026.1", locale: "en",
  budgets: { t1: 600, t2: 300, t3: 600, t4: 600 }, demo: true,
};

const serverItem = (id: string) => ({
  id,
  type: "message-page",
  stem: SERVER_STEM,
  material: "[login page] URL: https://secure-payportal.com.account-verify.net/login",
  options: ["Legitimate", "Hostile"],
  signal: 1,
  difficulty: 0.4,
  exposureSeconds: 25,
  phase: "sitting",
});

const DEALT = ["srv-1", "srv-2", "srv-3"];

let root: Root | null = null;
let host: HTMLElement | null = null;

/** Seed a run that is sitting T2 under a SERVER attempt id. */
function seed(recordedIds: string[]): void {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
  const ts = Date.now();
  let log = append([], { type: "attempt_started", attemptId: ATTEMPT, config, ts });
  log = append(log, { type: "track_started", trackId: "t1", ts });
  log = append(log, { type: "track_completed", trackId: "t1", artifact: {}, timedOut: false, ts });
  log = append(log, { type: "track_started", trackId: "t2", ts });
  saveAttempt(window.localStorage, log);
  window.localStorage.setItem(
    syncKey(ATTEMPT),
    JSON.stringify({
      serverAttemptId: ATTEMPT,
      syncedThrough: 0,
      finalized: false,
      deck: [{ trackId: "t2", bankSha256: BANK, itemIds: recordedIds }],
    }),
  );
  vi.spyOn(window, "fetch").mockImplementation((async (url: unknown) => ({
    ok: true,
    status: 200,
    json: async () =>
      String(url).endsWith("/items")
        ? { phase: "sitting", deckDigest: BANK, released: false, items: DEALT.map(serverItem) }
        : { attempt: { id: ATTEMPT }, response: { seq: 0, created: true } },
  })) as unknown as typeof fetch);
}

async function mountExam() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(ExamPage)); });
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the hosted exam page sits the server's deck", () => {
  beforeEach(() => seed(DEALT));

  it("presents the items the server dealt, not the bundled practice deck", async () => {
    await mountExam();
    // The intro already counts the SERVER's deck (3), not the bundled one.
    expect(host!.textContent).toContain("3 items.");
    const start = [...host!.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Start the deck"),
    );
    await act(async () => { start!.click(); });
    expect(host!.textContent).toContain(SERVER_STEM);
    // The bundled released-practice deck must not have been mounted instead.
    const bundled = trackConfig("t2", "en", ATTEMPT) as { items: { stem: string }[] };
    expect(host!.textContent).not.toContain(bundled.items[0].stem);
    expect(host!.querySelector('[data-testid="deck-error"]')).toBeNull();
  });

  it("asked the server for THIS attempt's items", async () => {
    await mountExam();
    const urls = (window.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
      String(c[0]),
    );
    expect(urls.some((u) => u.endsWith(`/attempts/${ATTEMPT}/items`))).toBe(true);
  });
});

describe("a deck that contradicts the exposure log", () => {
  beforeEach(() => seed(["srv-1", "srv-2", "srv-OTHER"]));

  it("refuses to present anything and offers a retry", async () => {
    await mountExam();
    const err = host!.querySelector('[data-testid="deck-error"]');
    expect(err?.textContent).toContain("not the deck it recorded");
    // Nothing from either deck is on screen: no items, no fallback.
    expect(host!.textContent).not.toContain(SERVER_STEM);
    expect(host!.textContent).toContain("Retry loading your deck");
  });
});
