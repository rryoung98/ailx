// @vitest-environment jsdom
/**
 * Verification feedback, after F5: "Verify against source" was a track-wide
 * button that emitted `verified/source`, so two presses bought a quarter of
 * the 20-point Process component with no claim involved and no source read,
 * and the counter advertised it. Verification is now attributed to the CLAIM
 * it checked, the tally counts DISTINCT claims, and it says so.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TrackEvent } from "@ailx/core";
import { Runner } from "../src/Runner.js";
import type { T3CheckpointState } from "../src/checkpoint.js";
import { config } from "./fixtures.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const CLAIM = config.plantedErrors[0].id;
const OTHER = config.correctAdvice[0].id;

const workCheckpoint = (transcript: T3CheckpointState["transcript"] = []): T3CheckpointState => ({
  phase: "work",
  transcript,
  messages: [
    { role: "user", text: "what does the source say?", claimIds: [], object: "prompt:1" },
    { role: "assistant", text: "here is my answer", claimIds: [CLAIM, OTHER], object: "assist:1" },
  ],
  draft: "",
  savedDraft: "",
  stances: {},
  seq: 0,
  promptSeq: 1,
  draftRev: 0,
});

let root: Root | null = null;
let host: HTMLElement;
let events: TrackEvent[] = [];

function mount(checkpoint: T3CheckpointState = workCheckpoint()) {
  events = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      createElement(Runner, {
        attemptId: "a-1",
        locale: "en" as const,
        config,
        onEvent: (e: TrackEvent) => void events.push(e),
        onComplete: () => {},
        secondsRemaining: 600,
        checkpoint,
        onCheckpoint: () => {},
      }),
    ),
  );
}

/** The per-claim verification control, found by the claim it describes. */
function checkBtn(claimId: string): HTMLButtonElement {
  const b = [...host.querySelectorAll("button")].find(
    (n) => n.getAttribute("aria-describedby") === `claim-${claimId}` && /Check|Checked/.test(n.textContent ?? ""),
  );
  expect(b, `check-source button for ${claimId}`).toBeTruthy();
  return b as HTMLButtonElement;
}

function click(b: HTMLButtonElement) {
  act(() => b.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

/** The one live region that reports verification. */
function statusText(): string {
  const el = [...host.querySelectorAll('[role="status"]')].find((n) =>
    /Verification|Checked against the source/.test(n.textContent ?? ""),
  );
  expect(el, "verification status region").toBeTruthy();
  return el!.textContent ?? "";
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

describe("T3 verification feedback", () => {
  it("tells the candidate verification is per claim, and that opening the source is not", () => {
    mount();
    expect(statusText()).toContain("per claim");
    expect(statusText()).toContain("Opening the source is not scored");
  });

  it("attributes the emitted event to the claim that was checked", () => {
    mount();
    click(checkBtn(CLAIM));
    expect(events.filter((e) => e.verb === "verified")).toEqual([
      expect.objectContaining({ verb: "verified", object: `claim:${CLAIM}` }),
    ]);
  });

  it("reports the first checked claim in the singular", () => {
    mount();
    click(checkBtn(CLAIM));
    expect(statusText()).toBe(
      "Checked against the source: 1 claim. Re-checking the same claim adds nothing.",
    );
  });

  it("counts DISTINCT claims, not presses", () => {
    mount();
    click(checkBtn(CLAIM));
    click(checkBtn(CLAIM));
    click(checkBtn(CLAIM));
    expect(statusText()).toContain("1 claim.");
    click(checkBtn(OTHER));
    expect(statusText()).toContain("2 claims.");
  });

  it("still records every press, so a re-check is auditable", () => {
    mount();
    click(checkBtn(CLAIM));
    click(checkBtn(CLAIM));
    expect(events.filter((e) => e.verb === "verified")).toHaveLength(2);
  });

  it("marks a checked claim as pressed for a screen reader", () => {
    mount();
    expect(checkBtn(CLAIM).getAttribute("aria-pressed")).toBe("false");
    click(checkBtn(CLAIM));
    expect(checkBtn(CLAIM).getAttribute("aria-pressed")).toBe("true");
    expect(checkBtn(OTHER).getAttribute("aria-pressed")).toBe("false");
  });

  it("restores the tally from the persisted transcript after a reload", () => {
    mount(
      workCheckpoint([
        { seq: 0, verb: "assisted", object: "assist:1", claimIds: [CLAIM], clientTs: "t" },
        { seq: 1, verb: "verified", object: `claim:${CLAIM}`, claimIds: [CLAIM], clientTs: "t" },
      ]),
    );
    expect(statusText()).toContain("1 claim.");
    expect(checkBtn(CLAIM).getAttribute("aria-pressed")).toBe("true");
  });

  it("opening the source emits nothing scored", () => {
    mount();
    const open = [...host.querySelectorAll("button")].find((b) => b.textContent === "Open the source");
    expect(open).toBeTruthy();
    click(open as HTMLButtonElement);
    expect(events.filter((e) => e.verb === "verified")).toHaveLength(0);
  });

  it("is a polite live region, not a bare paragraph", () => {
    mount();
    click(checkBtn(CLAIM));
    const el = [...host.querySelectorAll('[role="status"]')].find((n) =>
      (n.textContent ?? "").startsWith("Checked against the source"),
    );
    expect(el).toBeTruthy();
  });
});
