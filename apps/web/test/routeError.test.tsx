// @vitest-environment jsdom
/**
 * Route-level error boundaries (P0-1). Everything OUTSIDE the track runner
 * — the exam shell, the report, the layout itself — used to fail to a blank
 * page. These two files are the App Router's only export-safe boundaries,
 * so they must exist, must say the stored run is intact, and must offer a
 * single obvious way back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import ErrorScreen from "../app/error";
import GlobalError from "../app/global-error";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
let errors: unknown[][] = [];

beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { errors.push(a); });
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

function render(node: ReturnType<typeof createElement>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(node); });
  return host;
}

describe("app/error.tsx", () => {
  it("reports the error and offers retry plus a route back to the run", () => {
    const reset = vi.fn();
    const error = Object.assign(new Error("boom"), { digest: "d1" });
    const el = render(createElement(ErrorScreen, { error, reset }));

    const alert = el.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain("Your run is saved");
    expect(alert!.textContent).toContain("boom");
    expect(alert!.textContent).toContain("digest d1");

    const back = el.querySelector('a[href="/exam"]');
    expect(back, "a way back into the run").not.toBeNull();

    const retry = [...el.querySelectorAll("button")].find((b) => b.textContent === "Try again")!;
    act(() => retry.click());
    expect(reset).toHaveBeenCalledTimes(1);

    const logged = errors.find((a) => a[0] === "[ailx] route error");
    expect(logged).toBeDefined();
    expect((logged![1] as { message: string }).message).toBe("boom");
  });
});

describe("app/global-error.tsx", () => {
  it("renders a self-contained document with a reload affordance", () => {
    const reset = vi.fn();
    // It replaces the whole document (<html>/<body>), which cannot nest in a
    // div host — render it to static markup instead.
    const html = renderToStaticMarkup(
      createElement(GlobalError, { error: new Error("layout died"), reset }),
    );
    expect(html).toContain("<html");
    expect(html).toContain("layout died");
    expect(html).toContain("Reload");
    expect(html).toContain('role="alert"');
    // Self-contained styling: globals.css is exactly what may have failed.
    expect(html).toContain("#f7f4f2");
  });
});
