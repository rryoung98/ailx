import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { decodeT4Checkpoint, encodeT4Checkpoint } from "../src/checkpoint.js";
import type { T4CheckpointState } from "../src/checkpoint.js";
import { Runner } from "../src/Runner.js";

const state: T4CheckpointState = {
  drafts: [
    { index: 0, prompt: "a boat", svg: "<svg/>", clientTs: "t0" },
    { index: 1, prompt: "three boats", svg: "<svg/>", clientTs: "t1" },
  ],
  finals: {
    images: [
      { kind: "image", fromDraftIndex: 1, prompt: "three boats", asset: "<svg/>", clientTs: "t2" },
    ],
    video: { kind: "video", fromDraftIndex: 1, prompt: "three boats", asset: "<svg>v</svg>", clientTs: "t3" },
  },
  chosenSet: [0],
  note: "resumed direction note",
  disclosed: true,
  submitted: false,
};

describe("T4 checkpoint codec (F2)", () => {
  it("round-trips through JSON", () => {
    const decoded = decodeT4Checkpoint(JSON.parse(JSON.stringify(encodeT4Checkpoint(state))));
    expect(decoded).toEqual(state);
  });
  it("rejects malformed checkpoints", () => {
    expect(decodeT4Checkpoint(null)).toBeNull();
    expect(decodeT4Checkpoint({})).toBeNull();
    expect(decodeT4Checkpoint({ ...state, drafts: [{ nope: 1 }] })).toBeNull();
    expect(decodeT4Checkpoint({ ...state, finals: { images: [{ kind: "weird" }] } })).toBeNull();
    // Out-of-range chosenSet entries are dropped.
    const odd = decodeT4Checkpoint({ ...state, chosenSet: [0, 7] });
    expect(odd?.chosenSet).toEqual([0]);
  });
  it("Runner rehydrates drafts, finals and note from props.checkpoint (SSR)", () => {
    const html = renderToStaticMarkup(
      createElement(Runner, {
        attemptId: "a-1",
        locale: "en" as const,
        config: {},
        onEvent: () => {},
        onComplete: () => {},
        secondsRemaining: 600,
        checkpoint: encodeT4Checkpoint(state),
        onCheckpoint: () => {},
      }),
    );
    expect(html).not.toContain("No drafts yet");
    expect(html).toContain("FINAL IMG #1");
    expect(html).toContain("FINAL VIDEO");
    // The note now lives behind the finish step, so only its entry point
    // is in the first paint; the restored VALUE is asserted in the DOM
    // test "reopening the finish step after a resume shows the restored
    // note" (noteStep.test.tsx).
    expect(html).not.toContain("resumed direction note");
    expect(html).toContain("Direction note");
    // Quota counters reflect the restored finals: 2 image slots, 0 video left.
    expect(html).toContain("2 of 3 image renders left");
    expect(html).toContain("0 of 1 video renders left");
  });
});
