// @vitest-environment jsdom
/**
 * T2 keyboard + focus integrity (audit P0-2 / P1-3).
 *
 * decisionLatency is a SCORED input, so every second a keyboard or screen
 * reader user spends hunting for focus is a measurement error, not a
 * papercut. These tests pin the whole keyboard path of one item:
 *
 *  - answering never leaves focus on <body> and never on a `disabled`
 *    control (the answer buttons are aria-disabled, so they stay focusable);
 *  - the confidence sheet takes focus when it opens and TRAPS Tab;
 *  - closing the sheet returns focus to the deck (or, on the last item, to
 *    the replay control) so the next item is answerable immediately;
 *  - arrow keys only answer from INSIDE the deck: browse-mode arrowing,
 *    typing in a field, and modified arrows (browser back) never fire an
 *    irreversible scored answer, and never call preventDefault.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TrackEvent } from "@ailx/core";
import { Runner } from "../src/Runner.js";
import { items } from "./fixtures.js";
import { T2_DEFAULT_WEIGHTS } from "../src/types.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** Two binary items, so "the last item" is two answers away. */
const twoItemConfig = {
  items: items.filter((i) => i.options.length === 2).slice(0, 2),
  weights: T2_DEFAULT_WEIGHTS,
};

let container: HTMLElement;
let root: Root;
let events: TrackEvent[];

beforeEach(() => {
  events = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(config: unknown = twoItemConfig) {
  act(() => {
    root.render(
      createElement(Runner, {
        attemptId: "att-focus",
        locale: "en" as const,
        config,
        onEvent: (e: TrackEvent) => events.push(e),
        onComplete: () => {},
        secondsRemaining: 600,
        checkpoint: undefined,
        onCheckpoint: () => {},
      }),
    );
  });
}

function buttons(): HTMLButtonElement[] {
  return [...container.querySelectorAll("button")];
}

function byText(text: string): HTMLButtonElement {
  const b = buttons().find((x) => (x.textContent ?? "").trim() === text);
  if (!b) throw new Error(`button "${text}" not found`);
  return b;
}

function answerButtons(): HTMLButtonElement[] {
  return buttons().filter((b) => b.className.includes("t2-answer-btn"));
}

function deck(): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-testid="swipe-deck"]');
  if (!el) throw new Error("deck not rendered");
  return el;
}

function sheet(): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-testid="confidence-sheet"]');
  if (!el) throw new Error("confidence sheet not rendered");
  return el;
}

function slider(): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>('input[type="range"]');
  if (!el) throw new Error("confidence slider not rendered");
  return el;
}

function lockIn(): HTMLButtonElement {
  const b = buttons().find((x) => (x.textContent ?? "").includes("Lock in"));
  if (!b) throw new Error("Lock in not found");
  return b;
}

/** Dispatch a keydown the way a real key press does: from the focused node. */
function press(
  target: Element,
  key: string,
  init: Partial<KeyboardEventInit> = {},
): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(ev);
  });
  return ev;
}

function setConfidence(value: number) {
  const el = slider();
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function startDeck() {
  act(() => byText("Start the deck").click());
}

function active(): Element | null {
  return document.activeElement;
}

describe("T2 keyboard answering never strands focus", () => {
  it("keeps focus off <body> and off any disabled control through a whole item", () => {
    mount();
    startDeck();

    // 1. Tab lands on an answer button (the documented primary path).
    const left = answerButtons()[0];
    act(() => left.focus());
    expect(active()).toBe(left);

    // 2. Answering from that button opens the sheet and MOVES focus into it.
    press(left, "ArrowLeft");
    expect(sheet().textContent).toContain(`Your call: ${twoItemConfig.items[0].options[0]}`);
    expect(active()).not.toBe(document.body);
    expect(active()).toBe(slider());
    expect((active() as HTMLInputElement).disabled).toBe(false);

    // 3. The button that was just pressed is inert but STILL FOCUSABLE —
    //    a `disabled` attribute here is what dropped focus to <body>.
    for (const b of answerButtons()) {
      expect(b.disabled).toBe(false);
      expect(b.getAttribute("aria-disabled")).toBe("true");
    }
    expect(sheet().getAttribute("role")).toBe("dialog");
    expect(sheet().getAttribute("aria-modal")).toBe("true");
    expect(sheet().getAttribute("aria-hidden")).toBe("false");

    // 4. Lock in with the keyboard; focus returns to the deck for item 2.
    setConfidence(80);
    expect(lockIn().disabled).toBe(false);
    act(() => lockIn().click());
    expect(container.textContent).toContain("Item 2 / 2");
    expect(active()).not.toBe(document.body);
    expect(active()).toBe(answerButtons()[0]);
    expect((active() as HTMLButtonElement).getAttribute("aria-disabled")).toBe("false");

    // 5. The second (last) item answers the same way, with no mouse.
    press(answerButtons()[0], "ArrowRight");
    expect(active()).toBe(slider());
    setConfidence(40);
    act(() => lockIn().click());

    // The whole deck was answered from the keyboard.
    const responses = events.filter((e) => e.verb === "responded");
    expect(responses).toHaveLength(2);
    expect((responses[0].result as { choice: number }).choice).toBe(0);
    expect((responses[1].result as { choice: number }).choice).toBe(1);
  });

  it("lands focus on the replay control when the last item closes the deck", () => {
    mount();
    startDeck();
    press(answerButtons()[0], "ArrowLeft");
    setConfidence(60);
    act(() => lockIn().click());
    press(answerButtons()[0], "ArrowRight");
    setConfidence(60);
    act(() => lockIn().click());

    // Deck is gone; focus must not fall back to <body>.
    expect(container.textContent).toContain("Replay 1 / 2");
    expect(active()).not.toBe(document.body);
    expect((active() as HTMLElement).textContent).toBe("Next");
  });

  it("traps Tab inside the confidence sheet while it is open", () => {
    mount();
    startDeck();
    press(answerButtons()[0], "ArrowLeft");
    // 50 is the SHOWN default, so a change event to 50 is a no-op — the
    // deck deliberately treats an untouched slider as "not set".
    setConfidence(70);
    expect(lockIn().disabled).toBe(false);

    // Forward from the last control wraps to the first.
    act(() => lockIn().focus());
    const fwd = press(lockIn(), "Tab");
    expect(fwd.defaultPrevented).toBe(true);
    expect(active()).toBe(slider());

    // Backward from the first control wraps to the last.
    const back = press(slider(), "Tab", { shiftKey: true });
    expect(back.defaultPrevented).toBe(true);
    expect(active()).toBe(lockIn());
  });

  it("locks in on Enter from the slider, not only from the button", () => {
    mount();
    startDeck();
    press(answerButtons()[0], "ArrowLeft");
    setConfidence(70);
    // Enter is the first thing a keyboard user tries after arrowing to a
    // value; a range input does not submit, so it used to do nothing.
    const ev = press(slider(), "Enter");
    expect(ev.defaultPrevented).toBe(true);
    const responses = events.filter((e) => e.verb === "responded");
    expect(responses).toHaveLength(1);
    expect((responses[0].result as { confidence: number }).confidence).toBe(70);
    expect(container.textContent).toContain("Item 2 / 2");
  });

  it("ignores Enter until a confidence has actually been set", () => {
    mount();
    startDeck();
    press(answerButtons()[0], "ArrowLeft");
    const ev = press(slider(), "Enter");
    expect(ev.defaultPrevented).toBe(false);
    expect(events.filter((e) => e.verb === "responded")).toHaveLength(0);
    expect(container.textContent).toContain("Item 1 / 2");
  });

  it("leaves modified Enter to the browser", () => {
    mount();
    startDeck();
    press(answerButtons()[0], "ArrowLeft");
    setConfidence(70);
    for (const mod of [{ altKey: true }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }]) {
      const ev = press(slider(), "Enter", mod);
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(events.filter((e) => e.verb === "responded")).toHaveLength(0);
  });

  it("makes the closed sheet inert so its slider is not a stray tab stop", () => {
    mount();
    startDeck();
    expect(sheet().getAttribute("aria-hidden")).toBe("true");
    expect(sheet().hasAttribute("inert")).toBe(true);
  });
});

describe("arrow keys only answer from inside the deck (audit P1-3)", () => {
  it("ignores browse-mode arrowing on the document and never preventDefaults it", () => {
    mount();
    startDeck();
    const ev = press(document.body, "ArrowRight");
    expect(events.filter((e) => e.verb === "responded")).toHaveLength(0);
    expect(container.textContent).toContain("Your call: —");
    expect(ev.defaultPrevented).toBe(false);
  });

  it("ignores arrows typed in a text field and never preventDefaults them", () => {
    mount();
    startDeck();
    // A field inside the deck subtree: caret movement must survive.
    const input = document.createElement("input");
    input.type = "text";
    deck().appendChild(input);
    input.focus();
    const ev = press(input, "ArrowLeft");
    expect(events.filter((e) => e.verb === "responded")).toHaveLength(0);
    expect(ev.defaultPrevented).toBe(false);
    input.remove();
  });

  it("leaves modified arrows to the browser (Alt/Cmd+Arrow is back/forward)", () => {
    mount();
    startDeck();
    for (const mod of [{ altKey: true }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }]) {
      const ev = press(answerButtons()[0], "ArrowLeft", mod);
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(container.textContent).toContain("Your call: —");
    expect(events.filter((e) => e.verb === "responded")).toHaveLength(0);
  });

  it("ignores an arrow that is already handled or mid-IME-composition", () => {
    mount();
    startDeck();
    const composing = press(answerButtons()[0], "ArrowRight", { isComposing: true } as Partial<KeyboardEventInit>);
    expect(composing.defaultPrevented).toBe(false);
    expect(container.textContent).toContain("Your call: —");
  });

  it("still answers, and preventDefaults, from a focused answer button", () => {
    mount();
    startDeck();
    const ev = press(answerButtons()[1], "ArrowRight");
    expect(ev.defaultPrevented).toBe(true);
    expect(sheet().textContent).toContain(`Your call: ${twoItemConfig.items[0].options[1]}`);
  });
});
