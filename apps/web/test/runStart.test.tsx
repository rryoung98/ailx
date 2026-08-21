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
      (b.textContent ?? "").includes("Start your run"),
    );
    expect(start).toBeTruthy();
    expect(
      connect!.compareDocumentPosition(start!) & Node.DOCUMENT_POSITION_FOLLOWING,
      "AI connection must precede the Start pill",
    ).toBeTruthy();
  });

  it("keeps the fixed Start pill above the footer stacking context (#main z-index)", () => {
    const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");
    // body > * puts #main and the footer at z-index 1; the later-DOM footer
    // then paints OVER the fixed pill trapped inside #main. The #main
    // override must stay.
    expect(css).toMatch(/#main \{ z-index: 2; \}/);
  });
});
