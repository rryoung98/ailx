// @vitest-environment jsdom
/**
 * TEN-114: a HOSTED run must never silently become the published practice
 * deck.
 *
 * The exam service is the only holder of the operational bank. When it
 * cannot create the attempt, the honest answer is to refuse the start and
 * say so — not to mint a local attempt id and deal the 20 released-practice
 * items whose keys ship in the public bundle, with the browser marking its
 * own paper and no record on the server.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ATTEMPT_KEY } from "@ailx/session";
import { CALL_TIMEOUT_MS } from "../lib/data/deadline";
import { withQueryClient } from "./helpers/clientPage";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const ExamPage = (await import("../app/exam/page")).default;

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

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  // The start gate needs a connected model endpoint before it will start.
  window.localStorage.setItem("foray:llm-base-url", "https://exam.example/v1/model");
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function mountExam() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(withQueryClient(createElement(ExamPage))); });
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

async function clickStart() {
  const pill = [...host!.querySelectorAll("button")].find((b) => b.classList.contains("pill-cta"))!;
  await act(async () => { pill.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

describe("hosted mode: the exam service cannot create the attempt", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    vi.spyOn(window, "fetch").mockImplementation((async () => ({
      ok: false,
      status: 503,
      text: async () => "service unavailable",
      json: async () => ({ error: "service unavailable" }),
    })) as unknown as typeof fetch);
  });

  it("does not start the run", async () => {
    await mountExam();
    await clickStart();
    // Still on the start screen, and no attempt was written anywhere.
    expect(host!.textContent).toContain("Start your run");
    expect(window.localStorage.getItem(ATTEMPT_KEY)).toBeNull();
  });

  it("tells the candidate the run did not start, and offers a retry", async () => {
    await mountExam();
    await clickStart();
    const alert = host!.querySelector('[data-testid="persist-warning"]');
    expect(alert, "a visible start failure").not.toBeNull();
    expect(alert!.textContent).toContain("Your run did not start");
    // And it says why the practice deck is not offered as a stand-in. The
    // sentence was shortened in the copy pass; the disclosure did not move.
    expect(alert!.textContent).toContain("never stands in for a sitting");
    expect(alert!.textContent).toContain("its answers are published");
    // The Start pill is the retry: it stays live and still says what it does.
    const pill = [...host!.querySelectorAll("button")].find((b) => b.classList.contains("pill-cta"))!;
    expect(pill.getAttribute("aria-disabled")).toBeNull();
  });

  it("succeeds on a retry once the service answers", async () => {
    await mountExam();
    await clickStart();
    expect(host!.querySelector('[data-testid="persist-warning"]')).not.toBeNull();
    (window.fetch as unknown as { mockImplementation: (f: unknown) => void }).mockImplementation(
      (async () => ({
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({ attempt: { id: "00000000-0000-4000-8000-00000000abcd" } }),
      })) as unknown as typeof fetch,
    );
    await clickStart();
    expect(host!.querySelector('[data-testid="persist-warning"]')).toBeNull();
    expect(host!.textContent).toContain("Ready");
    expect(window.localStorage.getItem(ATTEMPT_KEY)).not.toBeNull();
  });
});

describe("static mode is unchanged: there is no service to fail", () => {
  it("starts the run on this build's practice deck", async () => {
    await mountExam();
    await clickStart();
    expect(host!.querySelector('[data-testid="persist-warning"]')).toBeNull();
    expect(host!.textContent).toContain("Ready");
  });
});

/**
 * TEN-211: a create that never answers.
 *
 * `startServerAttempt` is one POST, bounded by the `write` class in
 * lib/data/deadline.ts (TEN-210) — the page carries no timer of its own. What
 * was still missing is the OTHER half of the report: nothing on screen changed
 * while the request was in flight, a repeat tap was dropped by a ref, and the
 * candidate pressed Start and watched a dead button.
 */
describe("hosted mode: the create hangs", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    // A socket that opens and never answers. It honours the abort signal,
    // as a real fetch does — that signal is the bound under test.
    vi.spyOn(window, "fetch").mockImplementation(((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject((init.signal as AbortSignal).reason as Error);
        });
      })) as unknown as typeof fetch);
  });

  afterEach(() => { vi.useRealTimers(); });

  it("says the start is in flight instead of leaving a dead button", async () => {
    await mountExam();
    await clickStart();
    const pill = [...host!.querySelectorAll("button")].find((b) => b.classList.contains("pill-cta"))!;
    expect(pill.getAttribute("aria-busy")).toBe("true");
    expect(pill.textContent).toContain("Starting your run");
    // Nothing has been recorded, and no clock is running.
    expect(window.localStorage.getItem(ATTEMPT_KEY)).toBeNull();
  });

  it("fails with the start copy once the write bound is spent, and the pill is live again", async () => {
    await mountExam();
    await clickStart();
    expect(host!.querySelector('[data-testid="persist-warning"]')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS.write + 10); });
    for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
    const alert = host!.querySelector('[data-testid="persist-warning"]');
    expect(alert, "a hang must end in the start-failure copy").not.toBeNull();
    expect(alert!.textContent).toContain("Your run did not start");
    expect(alert!.textContent).toContain("did not answer in 15s");
    const pill = [...host!.querySelectorAll("button")].find((b) => b.classList.contains("pill-cta"))!;
    expect(pill.getAttribute("aria-busy")).toBeNull();
    expect(pill.textContent).toContain("Start your run");
    expect(window.localStorage.getItem(ATTEMPT_KEY)).toBeNull();
  });
});
