// @vitest-environment jsdom
/**
 * TEN-224: the exam page renders five whole-page views from one component,
 * and swapping one for another is a view change with no route change — Next's
 * App Router focus handling never sees it. Only the time-up notice landed
 * focus. A screen-reader candidate pressed Start, heard nothing, and had to
 * tab from the top of the document to find out whether the track had opened,
 * on a clock that was already running.
 *
 * FRONTEND.md §5: "Phase/route change: move focus to the new view's heading."
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TrackUIProps } from "@ailx/core";
import { withQueryClient } from "./helpers/clientPage";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** A runner with one control: submit an artifact and end the track. */
function SubmitRunner(props: TrackUIProps) {
  return createElement(
    "button",
    { type: "button", onClick: () => props.onComplete({ responses: [] }) },
    "Submit the track",
  );
}

vi.mock("../lib/instrument/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/instrument/registry")>();
  return { ...actual, loadTrackModule: async () => ({ placeholder: false, Runner: SubmitRunner }) };
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

async function click(el: Element) {
  await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

/** Leave the start gate: the sticky pill is the only control there. */
async function startRun() {
  await click([...host!.querySelectorAll("button")].find((b) => b.classList.contains("pill-cta"))!);
}

const button = (text: string) =>
  [...host!.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(text))!;

/** The heading a candidate has been landed on, if any. */
function focusedHeading(): string | null {
  const el = document.activeElement;
  return el && el.tagName === "H1" ? (el.textContent ?? "") : null;
}

describe("a phase change lands focus on the new view's heading", () => {
  it("does not steal focus on first load — arriving is not a phase change", async () => {
    await mountExam();
    expect(document.activeElement).toBe(document.body);
  });

  it("lands on the run's first heading when the start gate is left", async () => {
    await mountExam();
    await startRun();
    expect(focusedHeading()).toContain("Ready");
  });

  it("lands on the track heading when a track opens", async () => {
    await mountExam();
    await startRun();
    await click(button("Start T1"));
    expect(focusedHeading()).toContain("T1");
  });

  it("lands on the between-tracks heading when a track ends", async () => {
    await mountExam();
    await startRun();
    await click(button("Start T1"));
    await click(button("Submit the track"));
    expect(focusedHeading()).toContain("1 of 4 tracks complete");
  });

  it("lands on every later track, and on the run-complete heading", async () => {
    await mountExam();
    await startRun();
    for (const code of ["T1", "T2", "T3", "T4"]) {
      await click(button(`Start ${code}`));
      expect(focusedHeading(), `entering ${code}`).toContain(code);
      await click(button("Submit the track"));
    }
    await click(button("Finish run"));
    expect(focusedHeading()).toContain("Run complete");
  });

  it("does not move focus for a pause — the pause dialog owns that", async () => {
    await mountExam();
    await startRun();
    await click(button("Start T1"));
    await click(button("Pause"));
    // The resume control inside the dialog, never the track heading again.
    expect((document.activeElement as HTMLElement).textContent).toContain("Resume track");
  });

  it("lands focus inside the storage stop, which covers the same workspace", async () => {
    await mountExam();
    await startRun();
    await click(button("Start T1"));
    // The store refuses every write from here: the stop replaces the
    // workspace, so it owns focus exactly as a phase view does.
    const storage = window.localStorage;
    storage.setItem = () => { throw new Error("QuotaExceededError"); };
    await click(button("Submit the track"));
    const stop = host!.querySelector('[data-testid="storage-stop"]')!;
    expect(stop).not.toBeNull();
    expect(stop.contains(document.activeElement)).toBe(true);
  });
});
