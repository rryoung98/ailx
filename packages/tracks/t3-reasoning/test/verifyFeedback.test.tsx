// @vitest-environment jsdom
/**
 * "Verify against source" is a scored, instrumented act that used to be an
 * invisible one: with the source panel already on screen, its
 * scrollIntoView({ block: "nearest" }) moved nothing, so the button looked
 * broken. The tally below is presentation over the SAME emitted event.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Runner } from "../src/Runner.js";
import { config as t3Fixture } from "./fixtures.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;
let events: Array<{ verb: string; object: string }>;

function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      createElement(Runner, {
        attemptId: "a-1",
        locale: "en" as const,
        config: t3Fixture,
        onEvent: (e: { verb: string; object: string }) => void events.push(e),
        onComplete: () => {},
        secondsRemaining: 600,
      }),
    ),
  );
  click("Begin");
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

/** The one live region that reports verification. */
function statusText(): string {
  const el = [...host.querySelectorAll('[role="status"]')].find((n) =>
    /Verification|Verify against source/.test(n.textContent ?? ""),
  );
  expect(el, "verification status region").toBeTruthy();
  return el!.textContent ?? "";
}

beforeEach(() => { events = []; });

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

describe("T3 verification feedback", () => {
  it("tells the candidate the act is recorded before they use it", () => {
    mount();
    expect(statusText()).toContain("Verify against source");
  });

  it("reports the first verification in the singular", () => {
    mount();
    click("Verify against source");
    expect(statusText()).toBe("Verification recorded 1 time.");
  });

  it("counts repeat verifications", () => {
    mount();
    click("Verify against source");
    click("Verify against source");
    click("Verify against source");
    expect(statusText()).toBe("Verification recorded 3 times.");
  });

  it("still emits exactly one verified event per press", () => {
    mount();
    click("Verify against source");
    click("Verify against source");
    expect(events.filter((e) => e.verb === "verified" && e.object === "source")).toHaveLength(2);
  });

  it("is a polite live region, not a bare paragraph", () => {
    mount();
    click("Verify against source");
    const el = [...host.querySelectorAll('[role="status"]')].find((n) =>
      (n.textContent ?? "").startsWith("Verification recorded"),
    );
    expect(el).toBeTruthy();
  });
});
