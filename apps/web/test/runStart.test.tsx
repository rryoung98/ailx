// @vitest-environment jsdom
/**
 * Run-start screen regression (user report: "before starting the test a
 * user needs to integrate with OpenRouter — it doesn't show up").
 *
 * The AI-connection panel must render ON the start screen ABOVE the track
 * list (the fixed Start pill is always on screen, so anything below the
 * fold is effectively invisible), and the fixed Start pill must not be
 * buried under the footer's stacking context.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { withQueryClient } from "./helpers/clientPage";
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

describe("run start screen", () => {
  it("shows the AI-connection panel ABOVE the track list and before the Start pill", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(withQueryClient(createElement(ExamPage))); });

    const connect = host.querySelector('section[aria-label="AI connection"]');
    expect(connect, "ConnectPanel must render on the start screen").not.toBeNull();
    // The static export (this test's build) offers the capped shared demo,
    // never a sign-in: there is no service to hold a key against (TEN-62).
    expect(connect!.textContent).toContain("Try the shared demo model");

    const list = host.querySelector("ul.rule-rows");
    expect(list).not.toBeNull();
    // The connection section must come BEFORE the track list in DOM order.
    expect(
      connect!.compareDocumentPosition(list!) & Node.DOCUMENT_POSITION_FOLLOWING,
      "AI connection must precede the track list",
    ).toBeTruthy();

    const start = [...host.querySelectorAll("button")].find((b) =>
      b.classList.contains("pill-cta"),
    );
    expect(start).toBeTruthy();
    expect(
      connect!.compareDocumentPosition(start!) & Node.DOCUMENT_POSITION_FOLLOWING,
      "AI connection must precede the Start pill",
    ).toBeTruthy();
  });

  it("gates the start on a model connection: disabled pill, no attempt, attention pulse", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(withQueryClient(createElement(ExamPage))); });

    const pill = [...host.querySelectorAll("button")].find((b) => b.classList.contains("pill-cta"))!;
    expect(pill.textContent).toContain("Connect a model to start");
    expect(pill.getAttribute("aria-disabled")).toBe("true");

    // Clicking the gated pill must NOT start a run — it nudges the panel.
    await act(async () => { pill.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(host.textContent).toContain("Connect a model to start"); // still on start screen
    expect(window.localStorage.getItem("ailx:attempt:v1")).toBeNull();
    const connect = host.querySelector('section[aria-label="AI connection"]')!;
    expect(connect.className).toContain("connect-attention");
  });

  it("enables the start once an endpoint is stored (and after ConnectPanel announces a change)", async () => {
    // The gate reads the ENDPOINT slot and nothing else: the key slot it also
    // used to read no longer exists in either build.
    window.localStorage.setItem("ailx:llm-base-url", "https://exam.example/v1/model");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(withQueryClient(createElement(ExamPage))); });

    const pill = [...host.querySelectorAll("button")].find((b) => b.classList.contains("pill-cta"))!;
    expect(pill.textContent).toContain("Start your run");
    expect(pill.getAttribute("aria-disabled")).toBeNull();
    await act(async () => { pill.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    // The run started (start screen replaced by the between-tracks screen).
    expect(host.textContent).not.toContain("Start your run");
    expect(host.textContent).toContain("Ready");
  });

  it("a local endpoint also opens the gate", async () => {
    window.localStorage.setItem("ailx:llm-base-url", "http://localhost:11434/v1");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(withQueryClient(createElement(ExamPage))); });
    const pill = [...host.querySelectorAll("button")].find((b) => b.classList.contains("pill-cta"))!;
    expect(pill.textContent).toContain("Start your run");
  });

  it("keeps the fixed Start pill above the footer", () => {
    const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");
    // Original bug: the later-DOM footer painted OVER the fixed pill and
    // swallowed its clicks near the page bottom. That happened because
    // #main and the footer both sat at z-index 1, which trapped the pill at
    // #main's level. The fix is that neither is given a z-index at all: the
    // pill is then a positioned descendant of the ROOT stacking context at
    // z-index 30, and the footer is an in-flow box with no z-index, so the
    // pill paints later by the normal painting order. See
    // test/stackingContext.test.ts for the rest of the layer contract.
    expect(css).toMatch(/\.pill-cta \{[^}]*z-index: 30;/);
    const footer = css.slice(css.indexOf(".site-footer {"));
    expect(footer.slice(0, footer.indexOf("}"))).not.toContain("z-index");
    expect(css).not.toMatch(/#main \{[^}]*z-index/);
  });
});
