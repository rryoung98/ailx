// @vitest-environment jsdom
/**
 * The direction note used to sit permanently beside the prompt box, so the
 * candidate was asked to DO the work and REFLECT on it in one visual space
 * during a timed, scored task. It is now a step entered after the work.
 *
 * The asymmetry with T1 matters and is pinned here: this note IS scored
 * (score.ts weights 'direction-note' at 30% of the 20-point craft
 * component = 6 of T4's 100 points), so skipping is allowed but never
 * silent — the cost is stated at the moment of skipping, with the real
 * weights and no invented number.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Runner } from "../src/Runner.js";
import { encodeT4Checkpoint, type T4CheckpointState } from "../src/checkpoint.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** One promoted final, so delivery is possible. */
const ready: T4CheckpointState = {
  drafts: [{ index: 0, prompt: "three boats", svg: "<svg>d0</svg>", clientTs: "t0" }],
  finals: {
    images: [{ kind: "image", fromDraftIndex: 0, prompt: "three boats", asset: "<svg>f0</svg>", clientTs: "t1" }],
  },
  chosenSet: [0],
  note: "",
  disclosed: false,
  submitted: false,
};

let root: Root | null = null;
let host: HTMLElement;
let completed: unknown[];
let checkpoints: unknown[];

function mount(cp: T4CheckpointState = ready) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      createElement(Runner, {
        attemptId: "a-1",
        locale: "en" as const,
        config: {},
        onEvent: () => {},
        onComplete: (a: unknown) => void completed.push(a),
        secondsRemaining: 480,
        checkpoint: encodeT4Checkpoint(cp),
        onCheckpoint: (c: unknown) => void checkpoints.push(c),
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

function noteBox(): HTMLTextAreaElement | null {
  return host.querySelector('textarea[aria-label="Direction note"]');
}

function typeNote(text: string) {
  const el = noteBox()!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => { completed = []; checkpoints = []; });

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

describe("T4 direction note is a step, not a second input", () => {
  it("is not beside the prompt box at rest", () => {
    mount();
    expect(noteBox()).toBeNull();
    expect(host.querySelector('textarea[aria-label="Image prompt"]')).toBeTruthy();
  });

  it("opens from its own entry, before any submit intent", () => {
    mount();
    click("Direction note");
    expect(noteBox()).toBeTruthy();
    expect(completed).toHaveLength(0);
  });

  it("replaces the generation controls while it is open", () => {
    mount();
    click("Direction note");
    expect(host.querySelector('textarea[aria-label="Image prompt"]')).toBeNull();
    expect(button("Generate draft (unlimited)")).toBeUndefined();
  });

  it("keeps what was typed when the candidate goes back to work", () => {
    mount();
    click("Direction note");
    typeNote("The wave carries the cooperation read.");
    click("Keep working");
    expect(host.querySelector('textarea[aria-label="Image prompt"]')).toBeTruthy();
    click("Direction note");
    expect(noteBox()!.value).toBe("The wave carries the cooperation read.");
  });

  it("checkpoints every keystroke, so a reload cannot lose it", () => {
    mount();
    click("Direction note");
    typeNote("Diagnostic revision: the star.");
    expect(checkpoints.at(-1)).toMatchObject({ note: "Diagnostic revision: the star." });
  });

  it("reopening the finish step after a resume shows the restored note", () => {
    mount({ ...ready, note: "resumed direction note" });
    expect(noteBox()).toBeNull();
    click("Direction note");
    expect(noteBox()!.value).toBe("resumed direction note");
  });

  it("cannot be entered for delivery before a final exists", () => {
    mount({ ...ready, finals: { images: [] }, chosenSet: [] });
    expect(button("Submit final set + note")!.disabled).toBe(true);
    expect(host.textContent).toContain("Promote at least one draft");
  });
});

describe("T4 skipping the note states its price", () => {
  it("names the real weights up front, not a made-up number", () => {
    mount();
    click("Direction note");
    expect(host.textContent).toContain("30% of the 20-point");
    expect(host.textContent).toContain("6 of T4");
  });

  it("does not deliver on the first submit when the note is empty", () => {
    mount();
    click("Submit final set + note");
    click("Submit final set + note");
    expect(completed).toHaveLength(0);
    expect(host.textContent).toContain("The direction note is empty");
  });

  it("raises the skip warning as an alert, and scopes the loss honestly", () => {
    mount();
    click("Direction note");
    click("Submit final set + note");
    const alert = host.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert!.textContent).toContain("forfeits the");
    expect(alert!.textContent).toContain("images and video are unaffected");
  });

  it("lets the candidate skip anyway — it is their trade-off", () => {
    mount();
    click("Direction note");
    click("Submit final set + note");
    click("Deliver without the note");
    expect(host.textContent).toContain("Final set");
    click("Deliver final set →");
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ note: "" });
  });

  it("Write the note backs out of the skip without delivering", () => {
    mount();
    click("Direction note");
    click("Submit final set + note");
    click("Write the note");
    expect(completed).toHaveLength(0);
    expect(noteBox()).toBeTruthy();
    expect(button("Deliver without the note")).toBeUndefined();
  });

  it("typing a note clears an armed skip warning", () => {
    mount();
    click("Direction note");
    click("Submit final set + note");
    expect(host.textContent).toContain("The direction note is empty");
    typeNote("Now written.");
    expect(host.textContent).not.toContain("The direction note is empty");
  });

  it("a written note submits straight through, with no skip warning", () => {
    mount();
    click("Direction note");
    typeNote("Three vessels, one storm, no caption needed.");
    click("Submit final set + note");
    expect(host.textContent).toContain("Final set");
    click("Deliver final set →");
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ note: "Three vessels, one storm, no caption needed." });
  });

  it("treats a whitespace-only note as empty", () => {
    mount();
    click("Direction note");
    typeNote("   \n  ");
    click("Submit final set + note");
    expect(host.textContent).toContain("The direction note is empty");
  });
});
