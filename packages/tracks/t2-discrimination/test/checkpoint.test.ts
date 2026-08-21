import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { decodeT2Checkpoint, encodeT2Checkpoint } from "../src/checkpoint.js";
import type { T2CheckpointState } from "../src/checkpoint.js";
import { Runner } from "../src/Runner.js";
import { config, items } from "./fixtures.js";

const state: T2CheckpointState = {
  phase: "deck",
  deckIndex: 2,
  replayIdx: 0,
  responses: [
    { itemId: items[0].id, choice: 1, confidence: 80, latencyMs: 900 },
    { itemId: items[1].id, choice: 0, confidence: 40, latencyMs: 1400 },
  ],
};

describe("T2 checkpoint codec (F2)", () => {
  it("round-trips through JSON", () => {
    const decoded = decodeT2Checkpoint(JSON.parse(JSON.stringify(encodeT2Checkpoint(state))));
    expect(decoded).toEqual(state);
  });
  it("rejects malformed checkpoints", () => {
    expect(decodeT2Checkpoint(null)).toBeNull();
    expect(decodeT2Checkpoint({})).toBeNull();
    expect(decodeT2Checkpoint({ ...state, phase: "hacked" })).toBeNull();
    expect(decodeT2Checkpoint({ ...state, deckIndex: -1 })).toBeNull();
    expect(decodeT2Checkpoint({ ...state, responses: [{ itemId: 5 }] })).toBeNull();
  });
  it("Runner rehydrates deck position from props.checkpoint on mount (SSR)", () => {
    const html = renderToStaticMarkup(
      createElement(Runner, {
        attemptId: "a-1",
        locale: "en" as const,
        config,
        onEvent: () => {},
        onComplete: () => {},
        secondsRemaining: 300,
        checkpoint: encodeT2Checkpoint(state),
        onCheckpoint: () => {},
      }),
    );
    // Resumes mid-deck at item 3, not at the intro screen.
    expect(html).toContain(`Item 3 / ${config.items.length}`);
    expect(html).not.toContain("Start the deck");
  });
});
