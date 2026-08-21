import { describe, expect, it } from "vitest";
import {
  COMMIT_FRACTION,
  FLING_VELOCITY_PX_MS,
  MAX_ROTATION_DEG,
  ROTATION_DEG_PER_PX,
  badgeOpacity,
  choiceForDirection,
  curlIntensity,
  decideRelease,
  directionForChoice,
  estimateVelocity,
  rotationDeg,
  springSettled,
  springStep,
  type SpringState,
} from "../src/swipe/gesture.js";

describe("rotation", () => {
  it("is ~0.08 deg per px around the grab point", () => {
    expect(rotationDeg(100, 0.25)).toBeCloseTo(100 * ROTATION_DEG_PER_PX, 5);
    expect(rotationDeg(-50, 0.25)).toBeCloseTo(-50 * ROTATION_DEG_PER_PX, 5);
  });

  it("flips torque when grabbed below the midpoint", () => {
    expect(rotationDeg(100, 0.9)).toBeCloseTo(-100 * ROTATION_DEG_PER_PX, 5);
  });

  it("clamps to the max rotation", () => {
    expect(rotationDeg(10000, 0.25)).toBe(MAX_ROTATION_DEG);
    expect(rotationDeg(-10000, 0.25)).toBe(-MAX_ROTATION_DEG);
  });
});

describe("badge opacity", () => {
  it("ramps with |xOffset| and saturates at the commit line", () => {
    const w = 400;
    expect(badgeOpacity(0, w)).toBe(0);
    const half = badgeOpacity((w * COMMIT_FRACTION) / 2, w);
    expect(half).toBeCloseTo(0.5, 5);
    expect(badgeOpacity(w * COMMIT_FRACTION, w)).toBe(1);
    expect(badgeOpacity(-w, w)).toBe(1); // sign-agnostic, clamped
  });

  it("is 0 for a degenerate width", () => {
    expect(badgeOpacity(100, 0)).toBe(0);
  });
});

describe("release decision", () => {
  const w = 400;
  const line = w * COMMIT_FRACTION; // 140

  it("springs back below the offset threshold at low velocity", () => {
    expect(decideRelease(line - 1, 0, w)).toBe("spring");
    expect(decideRelease(-(line - 1), 0, w)).toBe("spring");
  });

  it("commits past ~35% of the card width", () => {
    expect(decideRelease(line, 0, w)).toBe("right");
    expect(decideRelease(-line, 0, w)).toBe("left");
  });

  it("commits a fast fling below the offset threshold", () => {
    expect(decideRelease(30, FLING_VELOCITY_PX_MS, w)).toBe("right");
    expect(decideRelease(-30, -FLING_VELOCITY_PX_MS, w)).toBe("left");
  });

  it("does NOT commit a fling opposing the current offset", () => {
    expect(decideRelease(60, -2 * FLING_VELOCITY_PX_MS, w)).toBe("spring");
  });
});

describe("direction ↔ choice mapping (left = options[0], right = options[1])", () => {
  it("is fixed and self-consistent", () => {
    expect(choiceForDirection("left")).toBe(0);
    expect(choiceForDirection("right")).toBe(1);
    expect(directionForChoice(0)).toBe("left");
    expect(directionForChoice(1)).toBe("right");
    expect(choiceForDirection(directionForChoice(0))).toBe(0);
    expect(choiceForDirection(directionForChoice(1))).toBe(1);
  });
});

describe("critically damped spring", () => {
  function settle(s0: SpringState, dtMs = 16, maxSteps = 1000) {
    let s = s0;
    const xs: number[] = [];
    for (let i = 0; i < maxSteps && !springSettled(s); i++) {
      s = springStep(s, dtMs);
      xs.push(s.x);
    }
    return { s, xs };
  }

  it("returns to rest without oscillating (no sign change from pure displacement)", () => {
    const { s, xs } = settle({ x: 180, v: 0 });
    expect(springSettled(s)).toBe(true);
    expect(xs.every((x) => x >= -1e-9)).toBe(true); // critically damped: no overshoot
  });

  it("settles from an initial velocity too", () => {
    const { s } = settle({ x: 120, v: -900 });
    expect(springSettled(s)).toBe(true);
  });

  it("is stable at large dt", () => {
    let s: SpringState = { x: 300, v: 0 };
    s = springStep(s, 5000);
    expect(Math.abs(s.x)).toBeLessThan(1);
  });
});

describe("velocity + curl", () => {
  it("estimates px/ms from trailing samples", () => {
    const samples = [
      { x: 0, t: 0 },
      { x: 40, t: 40 },
      { x: 80, t: 80 },
    ];
    expect(estimateVelocity(samples)).toBeCloseTo(1, 5);
    expect(estimateVelocity([{ x: 0, t: 0 }])).toBe(0);
  });

  it("curl intensity is clamped to [0,1]", () => {
    expect(curlIntensity(0)).toBe(0);
    expect(curlIntensity(100)).toBe(1);
    expect(curlIntensity(-100)).toBe(1);
  });
});
