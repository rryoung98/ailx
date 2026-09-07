// @vitest-environment jsdom
/**
 * A SITTING WITH NO MODEL, END TO END ON THE PAGE (TEN-149).
 *
 * Measured on staging 2026-09-05: a signed-in candidate could not start a
 * sitting at all. The Start pill read "Connect a model to start" and stayed
 * shut, because the gate was per-RUN — one boolean for four tracks, two of
 * which need no model. This suite drives the fixed path: start with nothing
 * connected, sit the model-free tracks, be told plainly why the other two
 * are shut, connect mid-run and watch them open where they stand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  append, saveAttempt,
  type SequencedEntry, type SessionConfig, type TrackId,
} from "@ailx/session";
import { FUNNEL_EVENTS_PATH, parseFunnelBatch, type FunnelEvent } from "@ailx/contract";
import { funnel, resetFunnel } from "../lib/data/funnel";
import { withQueryClient } from "./helpers/clientPage";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const ENDPOINT_SLOT = "foray:llm-base-url";
const ENDPOINT = "https://exam.example/v1/model";
const CONNECTION_CHANGED = "foray:connection-changed";

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

const config: SessionConfig = {
  instrument: "ailx", version: "2026.1", locale: "en",
  budgets: { t1: 600, t2: 600, t3: 600, t4: 600 }, demo: true,
};

/** A run that sat `done` and nothing else, sitting between tracks. */
function partialLog(done: readonly TrackId[]): SequencedEntry[] {
  let ts = Date.UTC(2026, 8, 5, 12, 0, 0);
  let log = append([], { type: "attempt_started", attemptId: "att-modelfree", config, ts });
  for (const t of done) {
    ts += 1_000;
    log = append(log, { type: "track_started", trackId: t, ts });
    ts += 1_000;
    log = append(log, { type: "track_completed", trackId: t, artifact: {}, timedOut: false, ts });
  }
  return log;
}

let root: Root | null = null;
let host: HTMLElement | null = null;
const posts: { body: string }[] = [];

beforeEach(() => {
  posts.length = 0;
  resetFunnel();
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  Object.defineProperty(window, "sessionStorage", { value: memoryStorage(), configurable: true });
  vi.stubEnv("NEXT_PUBLIC_AILX_API_BASE", "https://api.example");
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    if (String(url).includes(FUNNEL_EVENTS_PATH)) {
      posts.push({ body: String(init?.body ?? "") });
      return new Response(null, { status: 204 });
    }
    return new Response("{}", { status: 500 });
  });
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

async function mount(): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(withQueryClient(createElement(ExamPage))); });
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
  return host;
}

function button(match: RegExp): HTMLButtonElement | undefined {
  return [...host!.querySelectorAll("button")].find((b) => match.test(b.textContent ?? ""));
}

async function click(el: Element): Promise<void> {
  await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

function funnelSteps(): string[] {
  funnel().flush();
  const out: FunnelEvent[] = [];
  for (const post of posts) {
    const parsed = parseFunnelBatch(JSON.parse(post.body));
    expect(parsed, "the service must accept every batch this app sends").not.toBeNull();
    out.push(...parsed!);
  }
  return out.map((e) => e.step);
}

describe("starting with no model connected", () => {
  it("opens the Start pill and offers exactly the model-free tracks", async () => {
    const el = await mount();
    const pill = [...el.querySelectorAll("button")].find((b) => b.classList.contains("pill-cta"))!;
    expect(pill.textContent).toContain("Start your run");
    expect(pill.getAttribute("aria-disabled")).toBeNull();

    // The two that cannot run say so where they are read, with the action.
    const note = el.querySelector('[data-testid="start-note"]')!.textContent ?? "";
    expect(note).toContain("T2 and T3");
    expect(note).toContain("T1 and T4");
    expect(el.querySelector('[data-testid="locked-t1"]')!.textContent).toContain("Connect one above");
    expect(el.querySelector('[data-testid="locked-t4"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="locked-t2"]')).toBeNull();

    await click(pill);
    // The run started, and T2 — not T1 — is the track on offer.
    expect(window.localStorage.getItem("foray:attempt:v1")).not.toBeNull();
    expect(button(/Start T2/)).toBeDefined();
    expect(button(/Start T1/)).toBeUndefined();
    expect(el.querySelector('[data-testid="locked-t1"]')!.textContent).toContain("needs a model");
  });

  it("emits sitting_started exactly once", async () => {
    const el = await mount();
    const pill = [...el.querySelectorAll("button")].find((b) => b.classList.contains("pill-cta"))!;
    await click(pill);
    expect(funnelSteps().filter((s) => s === "sitting_started")).toHaveLength(1);
  });
});

describe("starting with a model connected", () => {
  it("offers all four tracks and starts at T1", async () => {
    window.localStorage.setItem(ENDPOINT_SLOT, ENDPOINT);
    const el = await mount();
    expect(el.querySelector('[data-testid="start-note"]')).toBeNull();
    expect(el.querySelector('[data-testid="locked-t1"]')).toBeNull();
    const pill = [...el.querySelectorAll("button")].find((b) => b.classList.contains("pill-cta"))!;
    await click(pill);
    expect(button(/Start T1/)).toBeDefined();
  });
});

describe("the last available track is finished", () => {
  it("ends the run honestly instead of hanging on a track it cannot offer", async () => {
    saveAttempt(window.localStorage, partialLog(["t2", "t3"]));
    const el = await mount();
    // No Start for a locked track, and the run can be closed.
    expect(button(/^Start T/)).toBeUndefined();
    const finish = button(/Finish here/)!;
    expect(finish.textContent).toContain("T2 and T3");
    expect(el.querySelector('[data-testid="locked-t1"]')).not.toBeNull();

    await click(finish);
    const summary = el.querySelector('[data-testid="completion-summary"]')!.textContent ?? "";
    expect(summary).toContain("T1 and T4 were not sat");
    expect(summary).toContain("partial sitting");
  });

  it("connecting mid-run opens the remaining tracks without restarting", async () => {
    saveAttempt(window.localStorage, partialLog(["t2", "t3"]));
    const el = await mount();
    const before = window.localStorage.getItem("foray:attempt:v1");
    expect(button(/Finish here/)).toBeDefined();

    await act(async () => {
      window.localStorage.setItem(ENDPOINT_SLOT, ENDPOINT);
      window.dispatchEvent(new Event(CONNECTION_CHANGED));
    });

    // T1 is next, the run log is untouched, and no clock was spent.
    expect(button(/Start T1/)).toBeDefined();
    expect(button(/Finish here/)).toBeUndefined();
    expect(el.querySelector('[data-testid="locked-t1"]')).toBeNull();
    expect(window.localStorage.getItem("foray:attempt:v1")).toBe(before);
  });
});
