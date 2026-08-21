"use client";
/**
 * useSwipeCard — the ONE gesture engine for every T2 card (DOM text cards
 * and WebGL image cards read the same motion state). Pointer-events only,
 * no gesture libraries.
 *
 * Commit semantics are SYNCHRONOUS: the choice is reported the instant the
 * release decision (or keyboard fling) is made; the fly-off animation is
 * purely cosmetic. This keeps response latency anchored at the moment of
 * the decision and makes tests deterministic.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  badgeOpacity,
  choiceForDirection,
  curlIntensity,
  decideRelease,
  directionForChoice,
  estimateVelocity,
  rotationDeg,
  springSettled,
  springStep,
  type PointerSample,
  type SpringState,
  type SwipeDirection,
} from "./gesture.js";

export interface CardMotion {
  /** px offsets from rest. */
  x: number;
  y: number;
  /** degrees. */
  rot: number;
  /** px/ms horizontal velocity (drag or animation). */
  vx: number;
  /** 0..1 cloth-curl intensity for the WebGL bend. */
  curl: number;
  /** badge opacity 0..1 (sign of x picks which badge). */
  badge: number;
  dragging: boolean;
  /** non-null once a commit decision was made (card flying off). */
  exiting: SwipeDirection | null;
  /** true once the exit animation has fully left the deck. */
  exited: boolean;
}

const REST: CardMotion = {
  x: 0, y: 0, rot: 0, vx: 0, curl: 0, badge: 0,
  dragging: false, exiting: null, exited: false,
};

export interface UseSwipeCardOptions {
  /** identity of the card — motion resets when it changes. */
  cardKey: string;
  enabled: boolean;
  /** left = 0, right = 1 (options index). */
  onCommit: (choice: 0 | 1, direction: SwipeDirection) => void;
}

interface DragCtx {
  pointerId: number;
  startX: number;
  startY: number;
  grabYFraction: number;
  width: number;
  samples: PointerSample[];
}

const now = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

function raf(cb: (t: number) => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(cb);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(() => cb(now()), 16);
  return () => clearTimeout(id);
}

export interface SwipeCardBind {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
}

export function useSwipeCard({ cardKey, enabled, onCommit }: UseSwipeCardOptions): {
  /** live motion — safe to read every frame (stable ref identity). */
  motion: React.MutableRefObject<CardMotion>;
  bind: SwipeCardBind;
  /** programmatic swipe (keyboard / option buttons) — same physics. */
  fling: (direction: SwipeDirection) => void;
  flingForChoice: (choice: number) => void;
} {
  const motion = useRef<CardMotion>({ ...REST });
  const drag = useRef<DragCtx | null>(null);
  const cancelAnim = useRef<(() => void) | null>(null);
  const [, bump] = useReducer((c: number) => c + 1, 0);
  const committed = useRef(false);

  const stopAnim = useCallback(() => {
    cancelAnim.current?.();
    cancelAnim.current = null;
  }, []);

  // Reset when the card identity changes; stop loops on unmount.
  useEffect(() => {
    motion.current = { ...REST };
    committed.current = false;
    drag.current = null;
    bump();
    return stopAnim;
  }, [cardKey, stopAnim]);

  const runSpringBack = useCallback(() => {
    stopAnim();
    let sx: SpringState = { x: motion.current.x, v: motion.current.vx * 1000 };
    let sy: SpringState = { x: motion.current.y, v: 0 };
    let last = now();
    const tick = (t: number) => {
      const dt = Math.min(64, t - last);
      last = t;
      sx = springStep(sx, dt);
      sy = springStep(sy, dt);
      const m = motion.current;
      m.x = sx.x;
      m.y = sy.x;
      m.vx = sx.v / 1000;
      m.rot = rotationDeg(sx.x, drag.current?.grabYFraction ?? 0.25);
      m.curl = Math.max(0, m.curl - dt / 220);
      m.badge = badgeOpacity(m.x, drag.current?.width ?? 320);
      if (springSettled(sx) && springSettled(sy)) {
        motion.current = { ...REST };
        cancelAnim.current = null;
        bump();
        return;
      }
      bump();
      cancelAnim.current = raf(tick);
    };
    cancelAnim.current = raf(tick);
  }, [stopAnim]);

  const runExit = useCallback((direction: SwipeDirection, width: number) => {
    stopAnim();
    const m = motion.current;
    m.exiting = direction;
    m.dragging = false;
    m.badge = 1;
    const sign = direction === "left" ? -1 : 1;
    let vx = sign * Math.max(Math.abs(m.vx), 1.4); // px/ms
    let last = now();
    const limit = Math.max(width, 320) * 1.7;
    const tick = (t: number) => {
      const dt = Math.min(64, t - last);
      last = t;
      vx += sign * 0.004 * dt; // gentle acceleration off-screen
      m.x += vx * dt;
      m.y += 0.12 * dt;
      m.vx = vx;
      m.rot = rotationDeg(m.x, 0.25);
      m.curl = Math.min(1, m.curl + dt / 160);
      if (Math.abs(m.x) >= limit) {
        m.exited = true;
        cancelAnim.current = null;
        bump();
        return;
      }
      bump();
      cancelAnim.current = raf(tick);
    };
    cancelAnim.current = raf(tick);
  }, [stopAnim]);

  const commit = useCallback(
    (direction: SwipeDirection, width: number) => {
      if (committed.current) return;
      committed.current = true;
      runExit(direction, width);
      onCommit(choiceForDirection(direction), direction);
    },
    [onCommit, runExit],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || committed.current) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      stopAnim();
      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      drag.current = {
        pointerId: e.pointerId,
        startX: e.clientX - motion.current.x,
        startY: e.clientY - motion.current.y,
        grabYFraction: rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.25,
        width: rect.width || 320,
        samples: [{ x: e.clientX, t: now() }],
      };
      motion.current.dragging = true;
      el.setPointerCapture?.(e.pointerId);
      bump();
    },
    [enabled, stopAnim],
  );

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId || committed.current) return;
    const m = motion.current;
    m.x = e.clientX - d.startX;
    m.y = (e.clientY - d.startY) * 0.35; // vertical follow is damped
    d.samples.push({ x: e.clientX, t: now() });
    if (d.samples.length > 24) d.samples.splice(0, d.samples.length - 24);
    m.vx = estimateVelocity(d.samples);
    m.rot = rotationDeg(m.x, d.grabYFraction);
    m.curl = curlIntensity(m.vx);
    m.badge = badgeOpacity(m.x, d.width);
    bump();
  }, []);

  const endDrag = useCallback(
    (e: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
      const d = drag.current;
      if (!d || d.pointerId !== e.pointerId) return;
      motion.current.dragging = false;
      const decision = cancelled
        ? "spring"
        : decideRelease(motion.current.x, motion.current.vx, d.width);
      if (decision === "spring") {
        runSpringBack();
      } else {
        commit(decision, d.width);
      }
      drag.current = null;
    },
    [commit, runSpringBack],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => endDrag(e, false),
    [endDrag],
  );
  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => endDrag(e, true),
    [endDrag],
  );

  const fling = useCallback(
    (direction: SwipeDirection) => {
      if (!enabled || committed.current) return;
      commit(direction, drag.current?.width ?? 360);
    },
    [commit, enabled],
  );

  const flingForChoice = useCallback(
    (choice: number) => fling(directionForChoice(choice)),
    [fling],
  );

  const bind = useMemo(
    () => ({ onPointerDown, onPointerMove, onPointerUp, onPointerCancel }),
    [onPointerCancel, onPointerDown, onPointerMove, onPointerUp],
  );

  return { motion, bind, fling, flingForChoice };
}
