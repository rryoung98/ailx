// @vitest-environment jsdom
/**
 * The run start screen owns the OpenRouter connection: SSO button + manual
 * key/base inputs live here, so track runners stay clean (they only hint).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConnectPanel } from "../lib/ConnectPanel";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// This vitest/jsdom combo exposes no window.localStorage — install a tiny
// in-memory shim (the component itself try/catches storage access anyway).
const store = new Map<string, string>();
const shim = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
};
Object.defineProperty(window, "localStorage", { value: shim, configurable: true });

let root: Root | null = null;
let host: HTMLElement;

function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(ConnectPanel)));
}

function click(label: string) {
  const btn = [...host.querySelectorAll("button")].find((b) => b.textContent === label);
  expect(btn, `button ${label}`).toBeTruthy();
  act(() => btn!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function setInput(aria: string, value: string) {
  const el = host.querySelector(`input[aria-label="${aria}"]`) as HTMLInputElement | null;
  expect(el, `input ${aria}`).toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

describe("ConnectPanel", () => {
  it("offers SSO plus collapsed manual setup when disconnected", () => {
    mount();
    expect(host.textContent).toContain("Connect OpenRouter");
    expect(host.querySelector('input[aria-label="OpenRouter API key"]')).toBeNull();
    click("Manual setup");
    expect(host.querySelector('input[aria-label="OpenRouter API key"]')).toBeTruthy();
    expect(host.querySelector('input[aria-label="API base URL"]')).toBeTruthy();
  });

  it("persists a pasted key to the shared slot and shows connected state", () => {
    mount();
    click("Manual setup");
    setInput("OpenRouter API key", "sk-or-test-123");
    expect(window.localStorage.getItem("ailx:openrouter-key")).toBe("sk-or-test-123");
    expect(host.textContent).toContain("Connected — key stays in this browser");
    click("Disconnect");
    expect(window.localStorage.getItem("ailx:openrouter-key")).toBeNull();
  });

  it("hydrates connected state from a key stored by T1/T4", () => {
    window.localStorage.setItem("ailx:openrouter-key", "sk-or-existing");
    mount();
    expect(host.textContent).toContain("Connected — key stays in this browser");
    expect([...host.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Connect OpenRouter");
  });

  it("shared demo connect sets the capped proxy base + marker token; disconnect clears both", () => {
    mount();
    click("Try the shared demo model");
    expect(window.localStorage.getItem("ailx:llm-base-url")).toBe("https://ailx-shared-demo.vercel.app/api/v1");
    expect(window.localStorage.getItem("ailx:openrouter-key")).toBe("shared-demo");
    expect(host.textContent).toContain("Shared demo model");
    click("Disconnect");
    expect(window.localStorage.getItem("ailx:openrouter-key")).toBeNull();
    expect(window.localStorage.getItem("ailx:llm-base-url")).toBeNull();
  });

  it("disconnect clears a manually set custom endpoint too (no stuck real mode)", () => {
    mount();
    click("Manual setup");
    setInput("API base URL", "http://localhost:11434/v1");
    setInput("OpenRouter API key", "sk-or-test-123");
    expect(window.localStorage.getItem("ailx:llm-base-url")).toBe("http://localhost:11434/v1");
    click("Disconnect");
    expect(window.localStorage.getItem("ailx:openrouter-key")).toBeNull();
    expect(window.localStorage.getItem("ailx:llm-base-url")).toBeNull();
    expect(host.textContent).toContain("Connect OpenRouter");
  });

  it("disconnect leaves unrelated slots alone", () => {
    window.localStorage.setItem("ailx:dev-user", "ui-worker-1");
    mount();
    click("Try the shared demo model");
    click("Disconnect");
    expect(window.localStorage.getItem("ailx:dev-user")).toBe("ui-worker-1");
  });

  it("promises a recoverable failure, not an automatic simulator takeover", () => {
    mount();
    expect(host.textContent).toContain("you can retry it or switch to the free offline demo simulators");
  });
});
