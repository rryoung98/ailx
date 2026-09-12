// @vitest-environment jsdom
/**
 * Plain product copy: address the reader directly, without administrative
 * labels such as "candidate" or "attempt". "Exam" is allowed: it tells the
 * reader what the longer timed activity is. Routes and data keys are unchanged.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { withQueryClient } from "./helpers/clientPage";
import Home from "../app/page";
import ExamPage from "../app/exam/page";
import ReportPage from "../app/report/page";
import RootLayout, { metadata } from "../app/layout";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const BANNED = /\b(attempts?|candidates?)\b|sit the/i;

let root: Root | null = null;
let host: HTMLElement | null = null;

// jsdom in this environment does not always expose window.localStorage;
// install a spec-shaped in-memory Storage so the pages' hydrate paths run.
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

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  window.localStorage.clear();
});

async function renderedText(el: ReactElement): Promise<string> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(withQueryClient(el)); });
  return host.textContent ?? "";
}

function expectClean(text: string, surface: string) {
  const m = text.match(BANNED);
  expect(m, `${surface} rendered banned copy: "${m?.[0]}" near "${text.slice(Math.max(0, (m?.index ?? 0) - 40), (m?.index ?? 0) + 40)}"`).toBeNull();
}

describe("plain vocabulary on product surfaces", () => {
  it("landing page addresses the reader directly", async () => {
    expectClean(await renderedText(createElement(Home)), "landing");
  });

  it("play page avoids administrative labels", async () => {
    const text = await renderedText(createElement(ExamPage));
    expectClean(text, "/exam UI");
    expect(text).toContain("Demo scores are not official results");
    expect(text).toContain("saved AI judgments");
    expect(text).toContain("judge again may give a different result");
  });

  it("report page avoids administrative labels", async () => {
    expectClean(await renderedText(createElement(ReportPage)), "/report UI");
  });

  it("nav, footer, and metadata use plain language", () => {
    // The layout renders <html>; walk its static element tree for text.
    const texts: string[] = [];
    const walk = (node: ReactNode): void => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (typeof node === "string") { texts.push(node); return; }
      if (!isValidElement(node)) return;
      const props = node.props as { children?: ReactNode };
      if (props?.children !== undefined) walk(props.children);
    };
    walk(RootLayout({ children: null }) as ReactElement);
    expectClean(texts.join(" "), "layout chrome");
    expectClean(String(metadata.title), "metadata title");
    expectClean(String(metadata.description), "metadata description");
  });

  it("footer states the public purpose without technical detail", () => {
    const texts: string[] = [];
    const walk = (node: ReactNode): void => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (typeof node === "string") { texts.push(node); return; }
      if (!isValidElement(node)) return;
      const props = node.props as { children?: ReactNode };
      if (props?.children !== undefined) walk(props.children);
    };
    walk(RootLayout({ children: null }) as ReactElement);
    expect(texts.join(" ")).toContain("Practical AI literacy, open to everyone.");
    expect(texts.join(" ")).not.toContain("raw points");
    expect(texts.join(" ")).not.toContain("item banks are public");
  });

  it("nav leads to the short test and personal activity", () => {
    let found = false;
    let foundRun = false;
    const text = (node: ReactNode): string => {
      if (Array.isArray(node)) return node.map(text).join("");
      if (typeof node === "string") return node;
      if (!isValidElement(node)) return "";
      return text((node.props as { children?: ReactNode }).children ?? null);
    };
    const walk = (node: ReactNode): void => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (!isValidElement(node)) return;
      const props = node.props as { href?: string; className?: string; children?: ReactNode };
      // Header play control is a compact pill (green dot + Play label) and it
      // points at the fast, free drill. A four-hour sitting is a terrible
      // first click, so /exam is a plain nav link instead of the pill.
      if (props?.href === "/test" && props.className === "nav-pill" && text(props.children) === "Take the test") {
        found = true;
      }
      if (props?.href === "/me" && props.className === undefined) foundRun = true;
      if (props?.children !== undefined) walk(props.children);
    };
    walk(RootLayout({ children: null }) as ReactElement);
    expect(found).toBe(true);
    expect(foundRun).toBe(true);
  });
});
