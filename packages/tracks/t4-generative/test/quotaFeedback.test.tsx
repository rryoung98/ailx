// @vitest-environment jsdom
/**
 * Promoting a draft spends a HARD, irreversible final-render quota. The only
 * feedback used to be a number inside an <h2>, which no screen reader
 * announces and which is easy to miss with a clock running — so the spend is
 * reported in a polite live region, and the disclosure checkbox (the control
 * that decides whether the delivered set is labelled AI-generated) is no
 * longer squashed to an unhittable 9px by its flex label.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Runner } from "../src/Runner.js";
import { encodeT4Checkpoint, type T4CheckpointState } from "../src/checkpoint.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const twoDrafts: T4CheckpointState = {
  drafts: [
    { index: 0, prompt: "a boat", svg: "<svg>d0</svg>", clientTs: "t0" },
    { index: 1, prompt: "three boats on a wave", svg: "<svg>d1</svg>", clientTs: "t1" },
  ],
  finals: { images: [] },
  chosenSet: [],
  note: "",
  disclosed: false,
  submitted: false,
};

let root: Root | null = null;
let host: HTMLElement;

function mount(cp: T4CheckpointState = twoDrafts) {
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
        onComplete: () => {},
        secondsRemaining: 480,
        checkpoint: encodeT4Checkpoint(cp),
      }),
    ),
  );
}

/** Every "→ Final image" / "→ Final video" button. The drafts grid renders
 *  NEWEST FIRST, so index 0 is the last draft generated (draft 2 here). */
function promoteButtons(label: string): HTMLButtonElement[] {
  return [...host.querySelectorAll("button")].filter(
    (b) => b.textContent === label,
  ) as HTMLButtonElement[];
}

function promote(label: string, draftIndex = 0) {
  const btn = promoteButtons(label)[draftIndex];
  expect(btn, `${label} on draft ${draftIndex}`).toBeTruthy();
  act(() => btn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function notice(): string {
  const regions = [...host.querySelectorAll('[role="status"]')].map((n) => n.textContent ?? "");
  return regions.find((t) => t.includes("promoted")) ?? "";
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

describe("T4 quota-spend announcement", () => {
  it("announces the first image promotion and the quota left", () => {
    mount();
    promote("→ Final image");
    expect(notice()).toBe("Final image 1 promoted from draft 2. 2 image renders left.");
  });

  it("uses the singular when one render is left", () => {
    mount();
    promote("→ Final image");
    promote("→ Final image");
    expect(notice()).toBe("Final image 2 promoted from draft 2. 1 image render left.");
  });

  it("reports the exhausted quota rather than going quiet", () => {
    mount();
    promote("→ Final image");
    promote("→ Final image");
    promote("→ Final image");
    expect(notice()).toBe("Final image 3 promoted from draft 2. 0 image renders left.");
    expect(promoteButtons("→ Final image").every((b) => b.disabled)).toBe(true);
  });

  it("names the draft that was spent, so a repeat promotion is visible", () => {
    mount();
    promote("→ Final image", 1);
    expect(notice()).toContain("from draft 1");
  });

  it("announces the video quota separately", () => {
    mount();
    promote("→ Final video");
    expect(notice()).toBe("Final video promoted from draft 2. 0 video renders left.");
  });

  it("carries the announcement in a polite live region", () => {
    mount();
    promote("→ Final image");
    const live = [...host.querySelectorAll('[role="status"]')].some((n) =>
      (n.textContent ?? "").includes("promoted"),
    );
    expect(live).toBe(true);
  });

  it("says nothing before any quota is spent", () => {
    mount();
    expect(notice()).toBe("");
  });
});

/** The disclosure checkbox lives in the finish step, beside the note it
 *  belongs to. Open the step before reaching for it. */
function openFinishStep() {
  const entry = [...host.querySelectorAll("button")].find((b) => b.textContent === "Direction note");
  expect(entry, "Direction note entry").toBeTruthy();
  act(() => entry!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

describe("T4 disclosure checkbox", () => {
  it("cannot be squashed by its flex label", () => {
    mount();
    openFinishStep();
    const box = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(box).toBeTruthy();
    expect(box.style.flexShrink).toBe("0");
    expect(parseInt(box.style.width, 10)).toBeGreaterThanOrEqual(18);
    expect(parseInt(box.style.height, 10)).toBeGreaterThanOrEqual(18);
  });

  it("stays inside a label, so the text is part of the target", () => {
    mount();
    openFinishStep();
    const box = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(box.closest("label")).toBeTruthy();
  });
});

describe("T4 brief heading", () => {
  it("keeps the countdown out of the heading but on screen", () => {
    mount();
    const h2 = [...host.querySelectorAll("h2")].find((h) => h.textContent === "Target brief");
    expect(h2, "a stable Target brief heading").toBeTruthy();
    expect(host.textContent).toContain("8:00 left");
  });
});
