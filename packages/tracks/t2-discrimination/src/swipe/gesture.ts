/**
 * Swipe gesture math — pure, DOM-free, unit-testable.
 *
 * Tinder-style card physics (open-source idiom: react-tinder-card /
 * @use-gesture examples, reimplemented without dependencies):
 *  - rotation is proportional to the horizontal offset (~0.08 deg/px) and
 *    flips sign when the card is grabbed below its vertical midpoint
 *    (torque around the grab point);
 *  - verdict badge opacity ramps with |xOffset| toward the commit line;
 *  - a release commits when |xOffset| exceeds ~35% of the card width OR
 *    the fling velocity exceeds a threshold in the same direction;
 *  - otherwise the card springs back, critically damped.
 *
 * Direction mapping is FIXED and shown in the UI: left = options[0],
 * right = options[1].
 */

export const ROTATION_DEG_PER_PX = 0.08;
export const MAX_ROTATION_DEG = 20;
export const COMMIT_FRACTION = 0.35;
/** px/ms; ~600 px/s. */
export const FLING_VELOCITY_PX_MS = 0.6;

export type SwipeDirection = "left" | "right";
export type ReleaseDecision = SwipeDirection | "spring";

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Card rotation in degrees for a horizontal drag offset.
 * @param grabYFraction 0 = grabbed at top edge, 1 = bottom edge. Grabbing
 * below the midpoint flips the torque direction, like a real card.
 */
export function rotationDeg(xOffsetPx: number, grabYFraction = 0.25): number {
  const sign = grabYFraction <= 0.5 ? 1 : -1;
  return clamp(xOffsetPx * ROTATION_DEG_PER_PX * sign, -MAX_ROTATION_DEG, MAX_ROTATION_DEG);
}

/** Verdict badge opacity in [0,1], full at the commit line. */
export function badgeOpacity(xOffsetPx: number, cardWidthPx: number): number {
  if (cardWidthPx <= 0) return 0;
  return clamp(Math.abs(xOffsetPx) / (cardWidthPx * COMMIT_FRACTION), 0, 1);
}

/** Decide what a pointer release does. */
export function decideRelease(
  xOffsetPx: number,
  velocityXPxMs: number,
  cardWidthPx: number,
): ReleaseDecision {
  const pastLine = cardWidthPx > 0 && Math.abs(xOffsetPx) >= cardWidthPx * COMMIT_FRACTION;
  const sameDir =
    xOffsetPx === 0 || velocityXPxMs === 0 || Math.sign(velocityXPxMs) === Math.sign(xOffsetPx);
  const flung = Math.abs(velocityXPxMs) >= FLING_VELOCITY_PX_MS && sameDir;
  if (!pastLine && !flung) return "spring";
  const ref = pastLine ? xOffsetPx : velocityXPxMs;
  return ref < 0 ? "left" : "right";
}

/** left = options[0], right = options[1] — mirrored by directionForChoice. */
export function choiceForDirection(dir: SwipeDirection): 0 | 1 {
  return dir === "left" ? 0 : 1;
}

export function directionForChoice(choice: number): SwipeDirection {
  return choice === 0 ? "left" : "right";
}

// ---------------------------------------------------------------------------
// Critically damped spring toward 0 (analytic step — stable at any dt).
// x(t) = (x0 + (v0 + w*x0) t) e^(-w t)
// ---------------------------------------------------------------------------

export interface SpringState {
  x: number;
  v: number;
}

export const SPRING_OMEGA = 14; // rad/s — snappy but soft landing

export function springStep(s: SpringState, dtMs: number, omega = SPRING_OMEGA): SpringState {
  const dt = Math.max(0, dtMs) / 1000;
  const e = Math.exp(-omega * dt);
  const a = s.v + omega * s.x;
  return {
    x: (s.x + a * dt) * e,
    v: (s.v - omega * a * dt) * e,
  };
}

export function springSettled(s: SpringState, epsX = 0.5, epsV = 0.02): boolean {
  return Math.abs(s.x) < epsX && Math.abs(s.v) < epsV;
}

/** Cloth-curl intensity for the WebGL bend, from drag velocity. */
export function curlIntensity(velocityXPxMs: number): number {
  return clamp(Math.abs(velocityXPxMs) / 1.5, 0, 1);
}

/** Estimate velocity (px/ms) from recent pointer samples. */
export interface PointerSample {
  x: number;
  t: number;
}

export function estimateVelocity(samples: ReadonlyArray<PointerSample>): number {
  if (samples.length < 2) return 0;
  // Use the trailing ~80 ms window for a responsive but stable estimate.
  const last = samples[samples.length - 1];
  let first = samples[0];
  for (let i = samples.length - 2; i >= 0; i--) {
    if (last.t - samples[i].t >= 80) {
      first = samples[i];
      break;
    }
    first = samples[i];
  }
  const dt = last.t - first.t;
  if (dt <= 0) return 0;
  return (last.x - first.x) / dt;
}
