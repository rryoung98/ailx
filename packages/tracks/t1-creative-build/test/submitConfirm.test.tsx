// @vitest-environment jsdom
/**
 * T1 submit is irreversible: it ends the track and forfeits the rest of the
 * clock, and its button sits a few pixels below "Send" in the same column.
 * A single unconfirmed click used to throw the whole remaining budget away,
 * so submission is armed first and confirmed second.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Runner } from "../src/Runner.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;
let completed: unknown[];
let events: unknown[];

function mount(secondsRemaining = 519) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      createElement(Runner, {
        attemptId: "a-1",
        locale: "en" as const,
        config: {},
        onEvent: (e: unknown) => void events.push(e),
        onComplete: (a: unknown) => void completed.push(a),
        secondsRemaining,
      }),
    ),
  );
}

function button(label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find((b) => b.textContent === label) as
    | HTMLButtonElement
    | undefined;
}

function click(label: string) {
  const btn = button(label);
  expect(btn, `button ${label}`).toBeTruthy();
  act(() => btn!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

beforeEach(() => {
  completed = [];
  events = [];
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  vi.unstubAllGlobals();
});

describe("T1 submit confirmation", () => {
  it("does not submit on the first click", () => {
    mount();
    click("Submit final artifact");
    expect(completed).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("names the time being forfeited so the cost is not a surprise", () => {
    mount(519);
    click("Submit final artifact");
    expect(host.textContent).toContain("8:39");
    expect(host.textContent).toContain("forfeits");
  });

  it("announces the armed state to a screen reader", () => {
    mount();
    click("Submit final artifact");
    expect(host.querySelector('[role="alert"]')).toBeTruthy();
  });

  it("submits exactly one artifact on confirmation", () => {
    mount();
    click("Submit final artifact");
    click("Yes, submit final artifact");
    expect(completed).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(host.textContent).toContain("Submitted");
  });

  it("Keep working disarms and leaves the track running", () => {
    mount();
    click("Submit final artifact");
    click("Keep working");
    expect(completed).toHaveLength(0);
    expect(button("Submit final artifact")).toBeTruthy();
    expect(button("Yes, submit final artifact")).toBeUndefined();
  });

  it("can be armed again after being disarmed", () => {
    mount();
    click("Submit final artifact");
    click("Keep working");
    click("Submit final artifact");
    click("Yes, submit final artifact");
    expect(completed).toHaveLength(1);
  });
});

describe("T1 brief heading", () => {
  it("keeps the countdown out of the heading but on screen", () => {
    mount(597);
    const h2 = [...host.querySelectorAll("h2")].find((h) => h.textContent === "Brief");
    expect(h2, "a stable Brief heading").toBeTruthy();
    expect(host.textContent).toContain("9:57 left");
  });
});
