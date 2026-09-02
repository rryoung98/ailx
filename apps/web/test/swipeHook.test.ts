/**
 * Pure-math regression tests for the teaser swipe hook: rotation curve,
 * commit threshold (35% of card width), stamp opacity ramp, direction,
 * and per-phase transitions (reduced motion → none).
 */
import { describe, expect, it } from "vitest";
import {
  FALLBACK_WIDTH_PX, MAX_ROTATION_DEG, ROTATION_GAIN, SWIPE_COMMIT_FRACTION,
  commitThresholdPx, isCommitted, stampOpacity, swipeDir, swipeRotation,
  transitionFor,
} from "../features/landing/useSwipeCard";

describe("swipe math", () => {
  it("commit threshold is 35% of the card width", () => {
    expect(SWIPE_COMMIT_FRACTION).toBe(0.35);
    expect(commitThresholdPx(320)).toBeCloseTo(112);
    expect(isCommitted(111, 320)).toBe(false);
    expect(isCommitted(112, 320)).toBe(true);
    expect(isCommitted(-112, 320)).toBe(true);
    expect(isCommitted(500, 0)).toBe(false); // zero width never commits
  });

  it("rotation is proportional to dx and clamped", () => {
    expect(swipeRotation(0, 320)).toBe(0);
    expect(swipeRotation(80, 320)).toBeCloseTo((80 / 320) * ROTATION_GAIN);
    expect(swipeRotation(-80, 320)).toBeCloseTo(-(80 / 320) * ROTATION_GAIN);
    expect(swipeRotation(10_000, 320)).toBe(MAX_ROTATION_DEG);
    expect(swipeRotation(-10_000, 320)).toBe(-MAX_ROTATION_DEG);
    expect(swipeRotation(50, 0)).toBe(0);
  });

  it("stamp opacity ramps 0 → 1 at the commit threshold and clamps", () => {
    expect(stampOpacity(0, 320)).toBe(0);
    expect(stampOpacity(56, 320)).toBeCloseTo(0.5);
    expect(stampOpacity(-56, 320)).toBeCloseTo(0.5);
    expect(stampOpacity(112, 320)).toBe(1);
    expect(stampOpacity(400, 320)).toBe(1);
    expect(stampOpacity(50, 0)).toBe(0);
  });

  it("direction follows the sign of dx", () => {
    expect(swipeDir(12)).toBe("right");
    expect(swipeDir(-12)).toBe("left");
    expect(swipeDir(0)).toBeNull();
  });

  it("reduced motion and drag phases get no transition", () => {
    expect(transitionFor("drag", false)).toBe("none");
    expect(transitionFor("idle", false)).toBe("none");
    for (const p of ["fling", "spring", "demo-out", "demo-return"] as const) {
      expect(transitionFor(p, true)).toBe("none");
      expect(transitionFor(p, false)).toMatch(/^transform \d+ms/);
    }
  });

  it("jsdom fallback width keeps the math usable", () => {
    expect(FALLBACK_WIDTH_PX).toBeGreaterThan(0);
  });
});
