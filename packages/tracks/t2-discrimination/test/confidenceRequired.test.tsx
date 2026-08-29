// @vitest-environment jsdom
/**
 * Confidence must be CHOSEN (dogfood papercut 7): the slider used to sit at
 * a default 50 and "Lock in" accepted it, so a calibration instrument was
 * scoring a number the candidate never picked. The stored shape is
 * unchanged — a plain number in every recorded response.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TrackEvent } from "@ailx/core";
import { Runner } from "../src/Runner.js";
import { encodeT2Checkpoint } from "../src/checkpoint.js";
import { config, items } from "./fixtures.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;
let events: TrackEvent[];
let checkpoints: unknown[];

beforeEach(() => {
  events = [];
  checkpoints = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(checkpoint?: unknown) {
  act(() => {
    root.render(
      createElement(Runner, {
        attemptId: "att-conf",
        locale: "en" as const,
        config,
        onEvent: (e: TrackEvent) => events.push(e),
        onComplete: () => {},
        secondsRemaining: 600,
        checkpoint,
        onCheckpoint: (c: unknown) => checkpoints.push(c),
      }),
    );
  });
}

function buttons(): HTMLButtonElement[] {
  return [...container.querySelectorAll("button")];
}

function byText(text: string): HTMLButtonElement {
  const btn = buttons().find((b) => (b.textContent ?? "").trim() === text);
  if (!btn) throw new Error(`button "${text}" not found`);
  return btn;
}

function lockIn(): HTMLButtonElement {
  const btn = buttons().find((b) => (b.textContent ?? "").includes("Lock in"));
  if (!btn) throw new Error("Lock in button not found");
  return btn;
}

function slider(): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>('input[type="range"]');
  if (!el) throw new Error("confidence slider not rendered");
  return el;
}

/** React patches the value setter for change tracking — go native. */
function moveSlider(value: number) {
  const el = slider();
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function answer(choice: 0 | 1) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: choice === 0 ? "ArrowLeft" : "ArrowRight", bubbles: true }),
    );
  });
}

function startDeck() {
  act(() => byText("Start the deck").click());
}

function recorded() {
  return events
    .filter((e) => e.verb === "responded")
    .map((e) => e.result as { itemId: string; choice: number; confidence: number; latencyMs: number });
}

describe("T2 confidence must be chosen", () => {
  it("shows the value as unset and disables Lock in until the slider is used", () => {
    mount();
    startDeck();
    answer(1);
    expect(container.textContent).toContain("How sure? not set");
    expect(container.querySelector('[data-testid="confidence-hint"]')).not.toBeNull();
    expect(lockIn().disabled).toBe(true);
    act(() => lockIn().click());
    expect(recorded()).toHaveLength(0);
  });

  it("records the chosen value at the minimum (0 is a real answer, not 'unset')", () => {
    mount();
    startDeck();
    answer(1);
    moveSlider(0);
    expect(container.textContent).toContain("How sure? 0");
    expect(lockIn().disabled).toBe(false);
    act(() => lockIn().click());
    expect(recorded()).toHaveLength(1);
    expect(recorded()[0].confidence).toBe(0);
    expect(recorded()[0].choice).toBe(1);
  });

  it("records the chosen value at the maximum", () => {
    mount();
    startDeck();
    answer(0);
    moveSlider(100);
    act(() => lockIn().click());
    expect(recorded()[0].confidence).toBe(100);
  });

  it("counts a press on the slider as the interaction (50 stays reachable)", () => {
    mount();
    startDeck();
    answer(1);
    act(() => {
      slider().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(container.textContent).toContain("How sure? 50");
    expect(lockIn().disabled).toBe(false);
    act(() => lockIn().click());
    expect(recorded()[0].confidence).toBe(50);
  });

  it("resets to unset for the next item — a value is never carried over", () => {
    mount();
    startDeck();
    answer(1);
    moveSlider(90);
    act(() => lockIn().click());
    expect(container.textContent).toContain("Item 2 / ");
    answer(0);
    expect(container.textContent).toContain("How sure? not set");
    expect(lockIn().disabled).toBe(true);
    moveSlider(20);
    act(() => lockIn().click());
    expect(recorded().map((r) => r.confidence)).toEqual([90, 20]);
  });

  it("keeps the stored response shape: confidence is always a number", () => {
    mount();
    startDeck();
    answer(1);
    moveSlider(35);
    act(() => lockIn().click());
    const last = checkpoints.at(-1) as { responses: Array<Record<string, unknown>> };
    expect(last.responses).toHaveLength(1);
    expect(typeof last.responses[0].confidence).toBe("number");
    expect(last.responses[0].confidence).toBe(35);
  });

  it("resumes from a checkpoint with prior confidences intact and still requires a fresh choice", () => {
    const prior = [{ itemId: items[0].id, choice: items[0].key, confidence: 80, latencyMs: 700 }];
    mount(encodeT2Checkpoint({ phase: "deck", deckIndex: 1, replayIdx: 0, responses: prior }));
    expect(container.textContent).toContain("Item 2 / ");
    answer(1);
    expect(container.textContent).toContain("How sure? not set");
    expect(lockIn().disabled).toBe(true);
    moveSlider(10);
    act(() => lockIn().click());
    const last = checkpoints.at(-1) as { responses: Array<{ confidence: number }> };
    expect(last.responses.map((r) => r.confidence)).toEqual([80, 10]);
  });
});
