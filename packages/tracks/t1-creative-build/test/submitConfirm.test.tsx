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
import { encodeT1Checkpoint } from "../src/checkpoint.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;
let completed: unknown[];
let events: unknown[];

let checkpoints: unknown[];

function mount(secondsRemaining = 519, checkpoint?: unknown) {
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
        checkpoint,
        onCheckpoint: (cp: unknown) => void checkpoints.push(cp),
      }),
    ),
  );
}

function rationale(): HTMLTextAreaElement | null {
  return host.querySelector('textarea[aria-label="Design rationale"]');
}

function typeRationale(text: string) {
  const el = rationale()!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
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
  checkpoints = [];
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

describe("T1 design rationale is a step, not a second input", () => {
  it("is not beside the prompt box at rest", () => {
    mount();
    expect(rationale()).toBeNull();
    expect(host.querySelector('textarea[aria-label="Assist prompt"]')).toBeTruthy();
  });

  it("opens from its own entry without arming submission", () => {
    mount();
    click("Design rationale");
    expect(rationale()).toBeTruthy();
    // Jotting is not a destructive act: no alert should interrupt.
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(completed).toHaveLength(0);
  });

  it("replaces the working controls while it is open", () => {
    mount();
    click("Design rationale");
    expect(host.querySelector('textarea[aria-label="Assist prompt"]')).toBeNull();
    expect(button("Send")).toBeUndefined();
  });

  it("is also reached from the submit entry, with the alert", () => {
    mount();
    click("Submit final artifact");
    expect(rationale()).toBeTruthy();
    expect(host.querySelector('[role="alert"]')).toBeTruthy();
  });

  it("states the honest, checkable cost of leaving it blank", () => {
    mount();
    click("Design rationale");
    expect(host.textContent).toContain("10 of T1");
    expect(host.textContent).toContain("scores zero");
  });

  it("keeps what was typed when the candidate goes back to work", () => {
    mount();
    click("Design rationale");
    typeRationale("Audience: summit delegates.");
    click("Keep working");
    expect(host.querySelector('textarea[aria-label="Assist prompt"]')).toBeTruthy();
    click("Design rationale");
    expect(rationale()!.value).toBe("Audience: summit delegates.");
  });

  it("checkpoints every keystroke, so a reload cannot lose it", () => {
    mount();
    click("Design rationale");
    typeRationale("Intent stated.");
    expect(checkpoints.at(-1)).toMatchObject({ selfReport: "Intent stated." });
  });

  it("reopening the finish step after a resume shows the restored text", () => {
    mount(519, encodeT1Checkpoint({
      html: "<main><h1>Resumed</h1></main>",
      promptLog: [],
      selfReport: "resumed self report",
    }));
    expect(rationale()).toBeNull();
    click("Design rationale");
    expect(rationale()!.value).toBe("resumed self report");
  });

  it("submits the rationale that was written in the step", () => {
    mount();
    click("Design rationale");
    typeRationale("Clean structure for a skim-reading delegate.");
    click("Yes, submit final artifact");
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ selfReport: "Clean structure for a skim-reading delegate." });
  });

  it("skipping it is allowed and quiet — an empty rationale still submits", () => {
    mount();
    click("Submit final artifact");
    click("Yes, submit final artifact");
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ selfReport: "" });
  });
});
