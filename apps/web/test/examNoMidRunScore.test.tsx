// @vitest-environment jsdom
/**
 * THE BROWSER ASKS FOR NO SCORE MID-SITTING (TEN-126, TEN-127, TEN-129).
 *
 * TEN-60 closed the answer-key oracle by refusing `POST /attempts/:id/score`
 * on an open sitting; TEN-66 moved score issuance into `/finalize`. The exam
 * page kept asking at TRACK completion anyway, so the live run of 2026-09-04
 * collected eight 409s and printed one to the candidate mid-sitting:
 *
 *   "the server has not issued your T3 score yet:
 *    POST /attempts/856b850c-.../score failed: 409"   [Retry scoring]
 *
 * and the single retry slot held ONE track, so T2's failure was overwritten
 * by T3's and could never be retried (TEN-127).
 *
 * What is pinned here: a hosted track completion issues NO score request at
 * all, no method-path-status string can reach a candidate's screen, and the
 * hub names whose score is still owed instead of claiming it has it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Runner as T2Runner } from "@ailx/track-t2";
import { append, saveAttempt, type SessionConfig } from "@ailx/session";
import { syncKey } from "../lib/data/persistence";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../lib/instrument/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/instrument/registry")>();
  return { ...actual, loadTrackModule: async () => ({ placeholder: false, Runner: T2Runner }) };
});

const ExamPage = (await import("../app/exam/page")).default;

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ATTEMPT = "00000000-0000-4000-8000-0000000000cc";
const BANK = "c".repeat(64);

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
  // One second of T2: the watchdog finishes the track on the first tick, which
  // is the completion path this test is about.
  budgets: { t1: 600, t2: 1, t3: 600, t4: 600 }, demo: true,
};

const serverItem = (id: string) => ({
  id,
  type: "message-page",
  stem: "Server-dealt item: hostile or legitimate?",
  material: "[login page] URL: https://example.invalid/login",
  options: ["Legitimate", "Hostile"],
  signal: 1,
  difficulty: 0.4,
  exposureSeconds: 25,
  phase: "sitting",
});

let calls: { url: string; method: string }[] = [];
let root: Root | null = null;
let host: HTMLElement | null = null;

/** A hosted run sitting T2, with the T2 budget already spent. */
function seed(): void {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
  const ts = Date.now() - 60_000;
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
      deck: [{ trackId: "t2", bankSha256: BANK, itemIds: ["srv-1"] }],
    }),
  );
  vi.spyOn(window, "fetch").mockImplementation((async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    // The DEPLOYED service, verbatim: it refuses to score an open sitting.
    if (String(url).endsWith("/score")) {
      return {
        ok: false,
        status: 409,
        json: async () => ({
          error: { code: "not_finalized", message: "the sitting is open: no score before finalize" },
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () =>
        String(url).endsWith("/items")
          ? { phase: "sitting", deckDigest: BANK, released: false, items: [serverItem("srv-1")] }
          : { attempt: { id: ATTEMPT }, response: { seq: 0, created: true } },
    };
  }) as unknown as typeof fetch);
}

async function mountExam() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(ExamPage)); });
  for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
}

/** Let the watchdog close the spent T2 clock, then acknowledge the notice. */
async function runOutTheClock(): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, 1100)); });
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
  const cont = host!.querySelector('[data-testid="time-up-continue"]') as HTMLButtonElement | null;
  if (cont !== null) await act(async () => { cont.click(); });
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

beforeEach(() => { calls = []; seed(); });
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a hosted track completion", () => {
  it("asks the exam service for no score — the sitting is still open", async () => {
    await mountExam();
    await runOutTheClock();
    expect(host!.textContent).toContain("of 4 tracks complete");
    expect(calls.filter((c) => c.url.endsWith("/score"))).toEqual([]);
  });

  it("shows no method, path or status code to the candidate", async () => {
    await mountExam();
    await runOutTheClock();
    const text = host!.textContent ?? "";
    expect(text).not.toMatch(/POST |failed: \d{3}|409/);
    expect(text).not.toContain("Retry scoring");
    expect(host!.querySelector('[data-testid="score-error"]')).toBeNull();
  });

  it("says whose score the completed hosted track is waiting on", async () => {
    await mountExam();
    await runOutTheClock();
    const text = host!.textContent ?? "";
    expect(text).toContain("scored by the exam service");
    expect(text).not.toContain("recorded, not scored");
  });
});

describe("no code path can score an open attempt any more", () => {
  const sources = (dir: string, out: string[] = []): string[] => {
    for (const name of readFileSync ? require("node:fs").readdirSync(dir) : []) {
      if (["node_modules", ".next", "out", "dist", "test", "e2e"].includes(name)) continue;
      const full = join(dir, name);
      if (require("node:fs").statSync(full).isDirectory()) sources(full, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  };

  it("builds the scoreTrack route nowhere in apps/web", () => {
    const offenders = sources(WEB_ROOT).filter((f) =>
      /apiPath\(\s*"scoreTrack"|scoreTrackOnServer\(|postTrackScore\(/.test(readFileSync(f, "utf8")),
    );
    expect(offenders.map((f) => f.slice(WEB_ROOT.length + 1))).toEqual([]);
  });
});
