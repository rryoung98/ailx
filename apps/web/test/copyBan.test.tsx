// @vitest-environment jsdom
/**
 * De-exam copy ban (gamify pass): product surfaces must use game
 * vocabulary — no 'exam', 'examination', 'sit the', 'attempt', or
 * 'candidate' in RENDERED text. URLs (/exam) and data-contract keys are
 * frozen and exempt; /methodology and /validate keep instrument framing
 * and are excluded from this gate.
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

const BANNED = /\b(exams?|examinations?|attempts?|candidates?)\b|sit the/i;

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

describe("game vocabulary on product surfaces", () => {
  it("landing page copy is exam-free", async () => {
    expectClean(await renderedText(createElement(Home)), "landing");
  });

  it("play page (fresh, no run) copy is exam-free", async () => {
    expectClean(await renderedText(createElement(ExamPage)), "/exam UI");
  });

  it("report page (no run) copy is exam-free", async () => {
    expectClean(await renderedText(createElement(ReportPage)), "/report UI");
  });

  it("nav, footer, and OG metadata are exam-free", () => {
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

  it("footer states the game/instrument positioning line", () => {
    const texts: string[] = [];
    const walk = (node: ReactNode): void => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (typeof node === "string") { texts.push(node); return; }
      if (!isValidElement(node)) return;
      const props = node.props as { children?: ReactNode };
      if (props?.children !== undefined) walk(props.children);
    };
    walk(RootLayout({ children: null }) as ReactElement);
    expect(texts.join(" ")).toContain("Foray plays like a game and is built like an instrument.");
  });

  it("nav pill plays the free drill, and the graded run keeps its own slot", () => {
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
      if (props?.href === "/practice" && props.className === "nav-pill" && text(props.children) === "Play") {
        found = true;
      }
      if (props?.href === "/exam" && props.className === undefined) foundRun = true;
      if (props?.children !== undefined) walk(props.children);
    };
    walk(RootLayout({ children: null }) as ReactElement);
    expect(found).toBe(true);
    expect(foundRun).toBe(true);
  });
});
