// @vitest-environment jsdom
/**
 * T1 two-pane Claude-Code-style layout — regression for the user report
 * "T1 is still dark inside / the runner needs a chat + live preview".
 *
 * LEFT pane: brief pinned on top, chat log (user + assistant bubbles),
 * input at the bottom. RIGHT pane: tablist with Preview (default) and
 * Code; the sandbox re-renders AUTOMATICALLY ~500ms after an edit.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Runner, AUTO_PREVIEW_DEBOUNCE_MS } from "../src/Runner.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const lsStore = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => lsStore.get(k) ?? null,
    setItem: (k: string, v: string) => void lsStore.set(k, String(v)),
    removeItem: (k: string) => void lsStore.delete(k),
    clear: () => lsStore.clear(),
  },
});

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  lsStore.clear();
  vi.useRealTimers();
});

function mount(extra: Record<string, unknown> = {}) {
  const c = document.createElement("div");
  document.body.appendChild(c);
  root = createRoot(c);
  act(() =>
    root!.render(
      createElement(Runner, {
        attemptId: "a-1",
        locale: "en" as const,
        config: {},
        onEvent: () => {},
        onComplete: () => {},
        secondsRemaining: 900,
        onCheckpoint: () => {},
        ...extra,
      }),
    ),
  );
  return c;
}

function type(el: HTMLTextAreaElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("T1 two-pane layout", () => {
  it("renders the conversation pane (brief on top, chat log, input) and the tabbed live page", () => {
    const c = mount();
    const convo = c.querySelector('section[aria-label="Build conversation"]')!;
    expect(convo).not.toBeNull();
    // Brief pinned INSIDE the conversation pane.
    const brief = convo.querySelector('[role="note"][aria-label="Brief"]');
    expect(brief).not.toBeNull();
    expect(brief!.textContent).toContain("Brief");
    // Chat log + input live in the same pane.
    expect(convo.querySelector('[role="log"][aria-label="AI assist conversation"]')).not.toBeNull();
    expect(convo.querySelector('textarea[aria-label="Assist prompt"]')).not.toBeNull();

    // RIGHT: tablist with Preview selected by default, Code behind a tab.
    const tablist = c.querySelector('[role="tablist"]')!;
    expect(tablist).not.toBeNull();
    const tabs = [...tablist.querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(["Preview", "Code"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[1].getAttribute("aria-selected")).toBe("false");
    // The preview panel is visible; the code panel is hidden but MOUNTED.
    expect(c.querySelector("#t1-panel-preview")!.hasAttribute("hidden")).toBe(false);
    expect(c.querySelector("#t1-panel-code")!.hasAttribute("hidden")).toBe(true);
    expect(c.querySelector('textarea[aria-label="HTML editor"]')).not.toBeNull();
    expect(c.querySelector('iframe[title="Artifact preview"]')).not.toBeNull();
  });

  it("switching to the Code tab reveals the editor and the manual fallback button", () => {
    const c = mount();
    const codeTab = [...c.querySelectorAll('[role="tab"]')].find((t) => t.textContent === "Code")!;
    act(() => codeTab.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(codeTab.getAttribute("aria-selected")).toBe("true");
    expect(c.querySelector("#t1-panel-code")!.hasAttribute("hidden")).toBe(false);
    const manual = [...c.querySelectorAll("button")].find((b) => b.textContent === "Run preview");
    expect(manual, "manual Run preview stays as a fallback").toBeTruthy();
  });

  it("chat: a demo prompt renders a user bubble and an assistant reply bubble", () => {
    const c = mount();
    const input = c.querySelector('textarea[aria-label="Assist prompt"]') as HTMLTextAreaElement;
    type(input, "give me a project grid");
    const send = [...c.querySelectorAll("button")].find((b) => b.textContent === "Send")!;
    act(() => send.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const log = c.querySelector('[role="log"][aria-label="AI assist conversation"]')!;
    expect(log.textContent).toContain("you");
    expect(log.textContent).toContain("give me a project grid");
    expect(log.textContent).toContain("demo assist");
    // The input clears after sending, like a chat box.
    expect((c.querySelector('textarea[aria-label="Assist prompt"]') as HTMLTextAreaElement).value).toBe("");
  });

  it("no dark chrome: the shell carries the paper palette and no purple", () => {
    const c = mount();
    const shell = c.querySelector(".t1-shell") as HTMLElement;
    expect(shell).not.toBeNull();
    expect(c.innerHTML).not.toContain("#6d5bd0");
    expect(c.innerHTML).not.toContain("#0b0b10");
  });
});

describe("T1 automatic live preview", () => {
  it(`re-renders the sandbox ${AUTO_PREVIEW_DEBOUNCE_MS}ms after the last edit — no button press`, () => {
    vi.useFakeTimers();
    const c = mount();
    const iframe = () => c.querySelector('iframe[title="Artifact preview"]') as HTMLIFrameElement;
    const before = iframe().getAttribute("srcdoc")!;
    const editor = c.querySelector('textarea[aria-label="HTML editor"]') as HTMLTextAreaElement;
    type(editor, "<!doctype html><html><head></head><body><h1>AUTO PREVIEW WORKS</h1></body></html>");
    // Not yet — debounce pending.
    expect(iframe().getAttribute("srcdoc")).toBe(before);
    act(() => void vi.advanceTimersByTime(AUTO_PREVIEW_DEBOUNCE_MS - 1));
    expect(iframe().getAttribute("srcdoc")).toBe(before);
    act(() => void vi.advanceTimersByTime(1));
    expect(iframe().getAttribute("srcdoc")).toContain("AUTO PREVIEW WORKS");
  });

  it("every keystroke resets the debounce (renders once, from the final text)", () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const c = mount({ onEvent: (e: { verb: string }) => events.push(e.verb) });
    const editor = c.querySelector('textarea[aria-label="HTML editor"]') as HTMLTextAreaElement;
    type(editor, "<h1>one</h1>");
    act(() => void vi.advanceTimersByTime(300));
    type(editor, "<h1>two</h1>");
    act(() => void vi.advanceTimersByTime(300));
    type(editor, "<h1>three</h1>");
    act(() => void vi.advanceTimersByTime(AUTO_PREVIEW_DEBOUNCE_MS));
    const iframe = c.querySelector('iframe[title="Artifact preview"]') as HTMLIFrameElement;
    expect(iframe.getAttribute("srcdoc")).toContain("three");
    expect(iframe.getAttribute("srcdoc")).not.toContain("<h1>one</h1>");
    // Exactly ONE revised event for the whole burst.
    expect(events.filter((v) => v === "revised")).toHaveLength(1);
  });
});
