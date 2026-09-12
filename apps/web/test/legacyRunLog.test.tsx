// @vitest-environment jsdom
/**
 * TEN-160, end to end on the exam page: a run stored by a build older than
 * the attestation invariant (2026-09-01, commit 4ad7af6) resumes, and the
 * candidate is told it is an OLD run rather than a broken one.
 *
 * This is the exact shape that produced the founder's screenshot:
 *
 *   ⚠ Persistence warning: stored run log had 4 corrupt trailing entries
 *   truncated (entry 4 rejected: ... unknown scoredBy undefined ...)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { withQueryClient } from "./helpers/clientPage";
import { ATTEMPT_KEY, type SessionConfig } from "@ailx/session";
import ExamPage from "../app/exam/page";

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

const config: SessionConfig = {
  instrument: "ailx", version: "2026.1", locale: "en",
  budgets: { t1: 600, t2: 600, t3: 600, t4: 600 }, demo: true,
};

/**
 * Hand-built, NOT built through append(): this build cannot produce the old
 * shape any more, which is the whole point. `track_scored` carries neither
 * `scoredBy` nor `judgmentIds`, and real work follows it.
 */
function seedLegacyRun(): void {
  const t0 = Date.now() - 600_000;
  const log = [
    { type: "attempt_started", attemptId: "att-legacy", config, ts: t0, seq: 0 },
    { type: "track_started", trackId: "t2", ts: t0 + 1_000, seq: 1 },
    { type: "track_completed", trackId: "t2", artifact: { answers: ["a"] }, timedOut: false, ts: t0 + 2_000, seq: 2 },
    {
      type: "track_scored", trackId: "t2",
      score: { raw: { correct: 3 }, scaled: 60 },
      rubricVersion: "2026.1", scoringDigest: "sha256:abc", modelManifest: {},
      judgments: [], ts: t0 + 3_000, seq: 3,
    },
    { type: "track_started", trackId: "t3", ts: t0 + 4_000, seq: 4 },
    { type: "track_completed", trackId: "t3", artifact: { turns: 2 }, timedOut: false, ts: t0 + 5_000, seq: 5 },
  ];
  window.localStorage.setItem(ATTEMPT_KEY, JSON.stringify({ formatVersion: 1, rev: 1, log }));
}

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(withQueryClient(createElement(ExamPage))); });
  await act(async () => { await Promise.resolve(); });
  return host;
}

describe("a run recorded by an older build", () => {
  it("is NOT reported as corruption", async () => {
    seedLegacyRun();
    const el = await render();
    const banner = el.querySelector('[data-testid="persist-warning"]')!;
    expect(banner).not.toBeNull();
    expect(banner.textContent).not.toContain("corrupt");
    expect(banner.textContent).not.toContain("truncated");
    expect(banner.textContent).not.toContain("does not match its evidence");
  });

  it("says which version wrote it, which track lost its score, and what to do", async () => {
    seedLegacyRun();
    const el = await render();
    const text = el.querySelector('[data-testid="persist-warning"]')!.textContent ?? "";
    expect(text).toContain("Older version of Foray");
    expect(text).toContain("recorded by an older version of Foray");
    expect(text).toContain("Its saved score for T2");
    expect(text).toContain("Sit T2 again");
    expect(text).toContain("The rest of your run was kept.");
  });

  it("KEEPS the run — the T3 the old truncation used to throw away is still sat", async () => {
    seedLegacyRun();
    const el = await render();
    // The run resumed rather than dropping back to the start gate.
    expect(el.textContent).not.toContain("Start your run");
    // Both completed tracks survived the load. Under the OLD rule the
    // truncation started at the legacy score, so T3 was gone and this said
    // "1 of 4".
    expect(el.textContent).toContain("2 of 4 tracks complete");
    expect(el.textContent).toContain("att-legacy");
  });
});
