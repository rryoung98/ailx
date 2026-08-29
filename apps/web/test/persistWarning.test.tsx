// @vitest-environment jsdom
/**
 * DRY (AGENTS.md): the persistence warning was the SAME inline-styled
 * role="alert" block copy-pasted into all five phase branches of the exam
 * page, carrying dark-theme hex colours (#3a1f1f / #7a3b3b / #ffd9d9) that
 * never followed the light-palette migration.
 *
 * Pinned here: one component, used by every call site, coloured from the
 * shipped CSS custom properties — and no stray hex left in the page.
 */
import { readFileSync } from "node:fs";
import { URL as NodeURL, fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ATTEMPT_KEY, append, type SequencedEntry, type SessionConfig } from "@ailx/session";
import { PersistWarning } from "../lib/PersistWarning";
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
 * Persist a log plus ONE illegal trailing entry: the validated loader
 * truncates it and the page raises the warning — the real production path
 * into every branch below.
 */
function seed(entries: (log: SequencedEntry[]) => SequencedEntry[]) {
  const ts = Date.now();
  const log = entries(append([], { type: "attempt_started", attemptId: "att-warn", config, ts }));
  const corrupt = [...log, { type: "resumed", ts, seq: log.length } as unknown as SequencedEntry];
  window.localStorage.setItem(
    ATTEMPT_KEY,
    JSON.stringify({ formatVersion: 1, rev: 1, log: corrupt }),
  );
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

async function render(node: ReturnType<typeof createElement>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(node); });
  await act(async () => { await Promise.resolve(); });
  return host;
}

function warning(): HTMLElement | null {
  return host!.querySelector<HTMLElement>('[data-testid="persist-warning"]');
}

describe("PersistWarning component", () => {
  it("renders nothing when there is no warning", async () => {
    await render(createElement(PersistWarning, { warning: null }));
    expect(warning()).toBeNull();
    expect(host!.textContent).toBe("");
  });

  it("is a role=alert coloured from the shipped tokens, not hardcoded hex", async () => {
    await render(createElement(PersistWarning, { warning: "quota exceeded" }));
    const el = warning()!;
    expect(el.getAttribute("role")).toBe("alert");
    expect(el.textContent).toContain("Persistence warning: quota exceeded");
    // jsdom does not resolve var(), so read the inline style as authored.
    const style = el.getAttribute("style") ?? "";
    expect(style).toContain("var(--bad)");
    expect(style).toContain("var(--card)");
    for (const hex of ["#3a1f1f", "#7a3b3b", "#ffd9d9"]) expect(style).not.toContain(hex);
  });

  it("takes a label so a non-persistence block reuses the same banner", async () => {
    await render(
      createElement(PersistWarning, { warning: "reload before starting", label: "Update required" }),
    );
    const el = warning()!;
    expect(el.textContent).toContain("Update required: reload before starting");
    expect(el.textContent).not.toContain("Persistence warning");
  });
});

describe("every exam-page call site uses it", () => {
  /**
   * The three branches a corrupt stored log can actually land on. The
   * remaining two call sites (the pre-hydration splash and the no-attempt
   * start screen) are defensive: the validated loader returns null rather
   * than a warning when NOTHING valid is stored, so they cannot be reached
   * from storage. They are covered by the component test above and by the
   * call-site count below.
   */
  const cases: Array<[string, (log: SequencedEntry[]) => SequencedEntry[], string]> = [
    ["between tracks", (log) => log, "Ready"],
    [
      "in track",
      (log) => append(log, { type: "track_started", trackId: "t1", ts: Date.now() }),
      "T1",
    ],
    [
      "completed",
      (log) => {
        let l = log;
        const ts = Date.now();
        for (const t of ["t1", "t2", "t3", "t4"] as const) {
          l = append(l, { type: "track_started", trackId: t, ts });
          l = append(l, {
            type: "track_completed", trackId: t, artifact: {}, timedOut: false, ts,
          });
        }
        return append(l, { type: "attempt_completed", ts });
      },
      "Run complete",
    ],
  ];

  for (const [name, build, marker] of cases) {
    it(`shows the warning on the ${name} branch`, async () => {
      seed(build);
      await render(createElement(ExamPage));
      expect(host!.textContent).toContain(marker);
      const el = warning();
      expect(el, `${name} branch must render the shared warning`).not.toBeNull();
      expect(el!.textContent).toContain("Persistence warning");
    });
  }
});

describe("the dark-theme copies are gone", () => {
  it("leaves no inline alert hex in the exam page", () => {
    // Resolved from this file, not `process.cwd()`: the working directory is
    // the monorepo root when the whole workspace runs as one vitest. Node's
    // URL, not jsdom's global — jsdom resolves against the document base
    // (http://localhost:3000) and would silently drop the file:// origin.
    const src = readFileSync(
      fileURLToPath(new NodeURL("../app/exam/page.tsx", import.meta.url)),
      "utf8",
    );
    for (const hex of ["#3a1f1f", "#7a3b3b", "#ffd9d9"]) {
      expect(src, `${hex} is a dark-theme leftover`).not.toContain(hex);
    }
    // One component, six call sites: five phase branches + the start gate's
    // stale-build block (same banner, different label).
    expect(src.split("<PersistWarning ").length - 1).toBe(6);
  });
});
