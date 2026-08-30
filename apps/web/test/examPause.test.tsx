// @vitest-environment jsdom
/**
 * The pause overlay is a full-workspace modal over a SCORED sitting. It used
 * to contain no control at all: the only way out was a Resume button outside
 * it, in the page header, which a keyboard or screen-reader user reaches only
 * by tabbing through a veiled workspace. It also opened an `h3` directly
 * under the page `h1`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ATTEMPT_KEY, append, project, saveAttempt,
  type SequencedEntry, type SessionConfig,
} from "@ailx/session";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../lib/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/registry")>();
  return {
    ...actual,
    loadTrackModule: async () => ({
      placeholder: false,
      Runner: () => createElement("p", null, "runner alive"),
    }),
  };
});

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

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  let log = append([], { type: "attempt_started", attemptId: "att-pause", config, ts: Date.now() });
  log = append(log, { type: "track_started", trackId: "t1", ts: Date.now() });
  saveAttempt(window.localStorage, log);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function mountExam() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(ExamPage)); });
  await act(async () => { await Promise.resolve(); });
}

function button(label: string): HTMLButtonElement | undefined {
  return [...host!.querySelectorAll("button")].find((b) => b.textContent === label) as
    | HTMLButtonElement
    | undefined;
}

function click(label: string) {
  const btn = button(label);
  expect(btn, `button ${label}`).toBeTruthy();
  act(() => btn!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function dialog(): HTMLElement | null {
  return host!.querySelector('[role="dialog"][aria-label="Paused"]');
}

function storedPhase(): string {
  const raw = window.localStorage.getItem(ATTEMPT_KEY)!;
  return project((JSON.parse(raw) as { log: SequencedEntry[] }).log).phase;
}

describe("exam pause overlay", () => {
  it("carries its own way out instead of stranding the candidate", async () => {
    await mountExam();
    click("Pause");
    const d = dialog();
    expect(d, "pause dialog").not.toBeNull();
    const resume = [...d!.querySelectorAll("button")].find((b) => b.textContent === "Resume track");
    expect(resume, "a Resume control INSIDE the dialog").toBeTruthy();
  });

  it("is a modal dialog, so the veiled workspace is out of the reading order", async () => {
    await mountExam();
    click("Pause");
    expect(dialog()!.getAttribute("aria-modal")).toBe("true");
  });

  it("does not skip a heading level under the page h1", async () => {
    await mountExam();
    click("Pause");
    const heading = dialog()!.querySelector("h1, h2, h3, h4");
    expect(heading!.tagName).toBe("H2");
    expect(heading!.textContent).toBe("Paused");
  });

  it("moves focus into the dialog when it opens", async () => {
    await mountExam();
    click("Pause");
    expect(document.activeElement?.textContent).toBe("Resume track");
  });

  it("resuming from inside the dialog restarts the track clock", async () => {
    await mountExam();
    click("Pause");
    expect(storedPhase()).toBe("paused");
    click("Resume track");
    expect(dialog()).toBeNull();
    expect(storedPhase()).toBe("in_track");
  });

  it("returns focus to the header Pause control on resume", async () => {
    await mountExam();
    click("Pause");
    click("Resume track");
    expect(document.activeElement?.textContent).toBe("Pause");
  });

  it("does not steal focus while no pause is open", async () => {
    await mountExam();
    expect(dialog()).toBeNull();
    expect(document.activeElement?.textContent).not.toBe("Resume track");
  });
});
