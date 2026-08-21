import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { decodeT1Checkpoint, encodeT1Checkpoint } from "../src/checkpoint.js";
import { Runner } from "../src/Runner.js";
import type { T1CheckpointState } from "../src/checkpoint.js";

const state: T1CheckpointState = {
  html: "<main><h1>Resumed Site</h1></main>",
  promptLog: [
    { kind: "prompted", prompt: "hero", clientTs: "2026-01-01T00:00:00Z" },
    { kind: "revised", clientTs: "2026-01-01T00:01:00Z" },
  ],
  selfReport: "resumed self report",
};

describe("T1 checkpoint codec (F2)", () => {
  it("round-trips through JSON", () => {
    const decoded = decodeT1Checkpoint(JSON.parse(JSON.stringify(encodeT1Checkpoint(state))));
    expect(decoded).toEqual(state);
  });
  it("rejects malformed checkpoints instead of corrupting state", () => {
    expect(decodeT1Checkpoint(null)).toBeNull();
    expect(decodeT1Checkpoint("nope")).toBeNull();
    expect(decodeT1Checkpoint({ html: 42, selfReport: "" })).toBeNull();
    expect(decodeT1Checkpoint({ html: "<p>x</p>", selfReport: "s", promptLog: [{ kind: "hacked" }] }))
      .toEqual({ html: "<p>x</p>", selfReport: "s", promptLog: [] });
  });
  it("Runner rehydrates from props.checkpoint on mount (SSR)", () => {
    const html = renderToStaticMarkup(
      createElement(Runner, {
        attemptId: "a-1",
        locale: "en" as const,
        config: {},
        onEvent: () => {},
        onComplete: () => {},
        secondsRemaining: 60,
        checkpoint: encodeT1Checkpoint(state),
        onCheckpoint: () => {},
      }),
    );
    expect(html).toContain("Resumed Site");
    expect(html).toContain("resumed self report");
  });
});
