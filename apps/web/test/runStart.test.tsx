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
    await act(async () => { root!.render(createElement(ExamPage)); });

    const connect = host.querySelector('section[aria-label="AI connection"]');
    expect(connect, "ConnectPanel must render on the start screen").not.toBeNull();
    expect(connect!.textContent).toContain("Connect OpenRouter");

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
    await act(async () => { root!.render(createElement(ExamPage)); });

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

  it("enables the start once a key is stored (and after ConnectPanel announces a change)", async () => {
    window.localStorage.setItem("ailx:openrouter-key", "sk-or-test");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(ExamPage)); });

    const pill = [...host.querySelectorAll("button")].find((b) => b.classList.contains("pill-cta"))!;
    expect(pill.textContent).toContain("Start your run");
    expect(pill.getAttribute("aria-disabled")).toBeNull();
    await act(async () => { pill.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    // The run started (start screen replaced by the between-tracks screen).
    expect(host.textContent).not.toContain("Start your run");
    expect(host.textContent).toContain("Ready");
  });

  it("a custom base URL (local model, no key) also opens the gate", async () => {
    window.localStorage.setItem("ailx:llm-base-url", "http://localhost:11434/v1");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(ExamPage)); });
    const pill = [...host.querySelectorAll("button")].find((b) => b.classList.contains("pill-cta"))!;
    expect(pill.textContent).toContain("Start your run");
  });

  it("keeps the fixed Start pill above the footer stacking context (#main z-index)", () => {
    const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");
    // body > * puts #main and the footer at z-index 1; the later-DOM footer
    // then paints OVER the fixed pill trapped inside #main. The #main
    // override must stay.
    expect(css).toMatch(/#main \{ z-index: 2; \}/);
  });
});
