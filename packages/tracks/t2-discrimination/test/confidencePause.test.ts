// @vitest-environment jsdom
/**
 * The per-item exposure clock freezes while the confidence sheet is up:
 * choosing a verdict stops the countdown (reflection is untimed), so users
 * can set confidence without timing out. Latency is anchored at the swipe.
 */
import { describe, expect, it, vi } from "vitest";

// The countdown tick logic: mirrors Runner's interval guard.
function tick(secondsLeft: number | null, choice: number | null): number | null {
  if (choice !== null) return secondsLeft; // frozen during confidence
  return secondsLeft === null ? null : secondsLeft - 1;
}

describe("t2 confidence pause", () => {
  it("counts down only while no verdict is cast", () => {
    let s: number | null = 10;
    s = tick(s, null); // 9
    s = tick(s, null); // 8
    s = tick(s, 1); // frozen
    s = tick(s, 1); // frozen
    expect(s).toBe(8);
    s = tick(s, null); // resumed (e.g. undo)
    expect(s).toBe(7);
  });
});
