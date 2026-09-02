"use client";

/**
 * Local tinder-style drag hook for the landing teaser. Deliberately
 * self-contained: no imports from track packages (runner internals stay
 * runner-internal). The math is exported as pure functions so tests can
 * pin the commit threshold and rotation curve without a DOM.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** A drag past this fraction of the card width commits the swipe. */
export const SWIPE_COMMIT_FRACTION = 0.35;
export const MAX_ROTATION_DEG = 18;
/** deg of rotation per full-card-width of drag (before the clamp). */
export const ROTATION_GAIN = 40;
export const FLING_MS = 280;
export const SPRING_MS = 340;
export const DEMO_OUT_MS = 900;
export const DEMO_HOLD_MS = 600;
export const DEMO_RETURN_MS = 420;
/** Used when the card element has no measurable width (jsdom, first paint). */
export const FALLBACK_WIDTH_PX = 320;

export type SwipeDir = "left" | "right";
export type SwipePhase = "idle" | "drag" | "fling" | "spring" | "demo-out" | "demo-return";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Rotation is proportional to dx, clamped to ±MAX_ROTATION_DEG. */
export function swipeRotation(dx: number, width: number): number {
  if (width <= 0) return 0;
  return clamp((dx / width) * ROTATION_GAIN, -MAX_ROTATION_DEG, MAX_ROTATION_DEG);
}

export function commitThresholdPx(width: number): number {
  return width * SWIPE_COMMIT_FRACTION;
}

export function isCommitted(dx: number, width: number): boolean {
  return width > 0 && Math.abs(dx) >= commitThresholdPx(width);
}

/** Verdict-stamp opacity: 0 at rest, 1 at the commit threshold. */
export function stampOpacity(dx: number, width: number): number {
  if (width <= 0) return 0;
  return clamp(Math.abs(dx) / commitThresholdPx(width), 0, 1);
}

export function swipeDir(dx: number): SwipeDir | null {
  if (dx > 0) return "right";
  if (dx < 0) return "left";
  return null;
}

/** CSS transition for the card transform in each phase. */
export function transitionFor(phase: SwipePhase, reducedMotion: boolean): string {
  if (reducedMotion || phase === "drag" || phase === "idle") return "none";
  if (phase === "fling") return `transform ${FLING_MS}ms ease-out`;
  if (phase === "spring") return `transform ${SPRING_MS}ms cubic-bezier(.2,.9,.3,1.25)`;
  if (phase === "demo-out") return `transform ${DEMO_OUT_MS}ms ease-in-out`;
  return `transform ${DEMO_RETURN_MS}ms ease`;
}

export interface SwipeCard {
  dx: number;
  phase: SwipePhase;
  width: number;
  demoing: boolean;
  cardRef: (el: HTMLElement | null) => void;
  handlers: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
  };
  /** Programmatic swipe (buttons / arrow keys): same fling + commit path. */
  fling: (dir: SwipeDir) => void;
  /** Idle auto-demo: drags most of the way to the threshold, then springs back. */
  demoSwipe: (dir: SwipeDir) => void;
  cancelDemo: () => void;
}

export function useSwipeCard(opts: {
  enabled: boolean;
  reducedMotion?: boolean;
  onCommit: (dir: SwipeDir) => void;
  onInteract?: () => void;
}): SwipeCard {
  const { enabled, reducedMotion = false } = opts;
  const [st, setSt] = useState<{ dx: number; phase: SwipePhase }>({ dx: 0, phase: "idle" });
  const elRef = useRef<HTMLElement | null>(null);
  const startX = useRef(0);
  const timers = useRef<number[]>([]);
  const phaseRef = useRef<SwipePhase>("idle");
  phaseRef.current = st.phase;
  const onCommitRef = useRef(opts.onCommit);
  onCommitRef.current = opts.onCommit;
  const onInteractRef = useRef(opts.onInteract);
  onInteractRef.current = opts.onInteract;

  const clearTimers = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const schedule = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, reducedMotion ? 0 : ms));
  }, [reducedMotion]);

  const width = useCallback((): number => {
    const w = elRef.current?.offsetWidth ?? 0;
    return w > 0 ? w : FALLBACK_WIDTH_PX;
  }, []);

  const cardRef = useCallback((el: HTMLElement | null) => { elRef.current = el; }, []);

  const fling = useCallback((dir: SwipeDir) => {
    if (!enabled || phaseRef.current === "fling") return;
    clearTimers();
    onInteractRef.current?.();
    const w = width();
    setSt({ dx: (dir === "right" ? 1 : -1) * w * 1.2, phase: "fling" });
    schedule(() => {
      onCommitRef.current(dir);
      setSt({ dx: 0, phase: "idle" });
    }, FLING_MS);
  }, [enabled, clearTimers, schedule, width]);

  const cancelDemo = useCallback(() => {
    if (phaseRef.current === "demo-out" || phaseRef.current === "demo-return") {
      clearTimers();
      setSt({ dx: 0, phase: "idle" });
    }
  }, [clearTimers]);

  const demoSwipe = useCallback((dir: SwipeDir) => {
    if (!enabled || reducedMotion || phaseRef.current !== "idle") return;
    const w = width();
    setSt({ dx: (dir === "right" ? 1 : -1) * commitThresholdPx(w) * 0.95, phase: "demo-out" });
    schedule(() => {
      setSt({ dx: 0, phase: "demo-return" });
      schedule(() => {
        setSt((s) => (s.phase === "demo-return" ? { dx: 0, phase: "idle" } : s));
      }, DEMO_RETURN_MS);
    }, DEMO_OUT_MS + DEMO_HOLD_MS);
  }, [enabled, reducedMotion, schedule, width]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!enabled || phaseRef.current === "fling") return;
    cancelDemo();
    onInteractRef.current?.();
    startX.current = e.clientX;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setSt({ dx: 0, phase: "drag" });
  }, [enabled, cancelDemo]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (phaseRef.current !== "drag") return;
    setSt({ dx: e.clientX - startX.current, phase: "drag" });
  }, []);

  const settle = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (phaseRef.current !== "drag") return;
    const dx = e.clientX - startX.current;
    const w = width();
    if (isCommitted(dx, w)) {
      const dir = swipeDir(dx)!;
      setSt({ dx: (dir === "right" ? 1 : -1) * w * 1.2, phase: "fling" });
      schedule(() => {
        onCommitRef.current(dir);
        setSt({ dx: 0, phase: "idle" });
      }, FLING_MS);
    } else {
      setSt({ dx: 0, phase: "spring" });
      schedule(() => {
        setSt((s) => (s.phase === "spring" ? { dx: 0, phase: "idle" } : s));
      }, SPRING_MS);
    }
  }, [schedule, width]);

  return {
    dx: st.dx,
    phase: st.phase,
    width: width(),
    demoing: st.phase === "demo-out" || st.phase === "demo-return",
    cardRef,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: settle,
      onPointerCancel: settle,
    },
    fling,
    demoSwipe,
    cancelDemo,
  };
}
