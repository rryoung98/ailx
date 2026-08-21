import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { decodeT3Checkpoint, encodeT3Checkpoint } from "../src/checkpoint.js";
import type { T3CheckpointState } from "../src/checkpoint.js";
import { plugin } from "../src/plugin.js";
import { Runner } from "../src/Runner.js";
import { config } from "./fixtures.js";

const state: T3CheckpointState = {
  phase: "work",
  transcript: [
    { verb: "prompted", object: "prompt:1", text: "q1", seq: 0, clientTs: "2026-02-01T09:00:00Z" },
    { verb: "assisted", object: "assist:1", text: "a1", claimIds: ["ca-cluster"], seq: 1, clientTs: "2026-02-01T09:00:01Z" },
  ],
  messages: [
    { role: "user", text: "q1", claimIds: [], object: "prompt:1" },
    { role: "assistant", text: "a1", claimIds: ["ca-cluster"], object: "assist:1" },
  ],
  draft: "resumed draft text",
  savedDraft: "resumed draft text",
  stances: { "ca-cluster": "accepted" },
  seq: 2,
  promptSeq: 1,
  draftRev: 0,
};

describe("T3 checkpoint codec (F2)", () => {
  it("round-trips through JSON", () => {
    const decoded = decodeT3Checkpoint(JSON.parse(JSON.stringify(encodeT3Checkpoint(state))));
    expect(decoded).toEqual(state);
  });
  it("rejects malformed checkpoints", () => {
    expect(decodeT3Checkpoint(null)).toBeNull();
    expect(decodeT3Checkpoint({})).toBeNull();
    expect(decodeT3Checkpoint({ ...state, phase: "hacked" })).toBeNull();
    expect(decodeT3Checkpoint({ ...state, seq: -1 })).toBeNull();
    expect(decodeT3Checkpoint({ ...state, transcript: [{ verb: "hacked", object: "x" }] })).toBeNull();
    // Unknown stance values are dropped rather than corrupting state.
    const odd = decodeT3Checkpoint({ ...state, stances: { a: "accepted", b: "weird" } });
    expect(odd?.stances).toEqual({ a: "accepted" });
  });
  it("Runner rehydrates mid-work from props.checkpoint on mount (SSR)", () => {
    const html = renderToStaticMarkup(
      createElement(Runner, {
        attemptId: "a-1",
        locale: "en" as const,
        config,
        onEvent: () => {},
        onComplete: () => {},
        secondsRemaining: 600,
        checkpoint: encodeT3Checkpoint(state),
        onCheckpoint: () => {},
      }),
    );
    // Resumes in the work phase with chat + draft restored, not at the brief.
    expect(html).not.toContain("Begin");
    expect(html).toContain("resumed draft text");
    expect(html).toContain("a1");
  });
});

describe("T3 plugin ui() (F11)", () => {
  it("exposes a lazy ui() loader resolving to the Runner", async () => {
    expect(typeof plugin.ui).toBe("function");
    const mod = await plugin.ui!();
    expect(typeof mod.Runner).toBe("function");
  });
});
