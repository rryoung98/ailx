"use client";

/**
 * HeroCanvas — dependency-free 2D-canvas particle drift behind the landing
 * hero. Deliberately cheap: ~1 particle per 9000 px², dot-only rendering,
 * capped DPR, one rAF loop that
 *   - never starts under prefers-reduced-motion (a single static frame is
 *     drawn instead, and reduced-motion flips live via matchMedia change),
 *   - pauses when the canvas leaves the viewport (IntersectionObserver) or
 *     the tab is hidden (visibilitychange).
 * Purely decorative: aria-hidden, pointer-events none, sits behind content.
 */

import * as React from "react";
import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  a: number;
  phase: number;
}

function makeParticles(w: number, h: number): Particle[] {
  const count = Math.max(24, Math.min(90, Math.round((w * h) / 9000)));
  const ps: Particle[] = [];
  for (let i = 0; i < count; i++) {
    ps.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.12,
      vy: (Math.random() - 0.5) * 0.08 - 0.02,
      r: 0.6 + Math.random() * 1.6,
      a: 0.12 + Math.random() * 0.3,
      phase: Math.random() * Math.PI * 2,
    });
  }
  return ps;
}

export function HeroCanvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // jsdom / unsupported: stay a blank decorative element

    let particles: Particle[] = [];
    let w = 0;
    let h = 0;
    let raf = 0;
    let running = false;
    let visible = true;
    let reduced = false;
    let t = 0;

    const dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles = makeParticles(w, h);
      drawFrame();
    };

    const drawFrame = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        const twinkle = reduced ? 1 : 0.75 + 0.25 * Math.sin(t * 0.008 + p.phase);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(122, 162, 255, ${(p.a * twinkle).toFixed(3)})`;
        ctx.fill();
      }
    };

    const step = () => {
      raf = 0;
      if (!running) return;
      t += 16;
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -4) p.x = w + 4;
        if (p.x > w + 4) p.x = -4;
        if (p.y < -4) p.y = h + 4;
        if (p.y > h + 4) p.y = -4;
      }
      drawFrame();
      raf = requestAnimationFrame(step);
    };

    const sync = () => {
      const shouldRun = visible && !reduced && !document.hidden;
      if (shouldRun && !running) {
        running = true;
        raf = requestAnimationFrame(step);
      } else if (!shouldRun && running) {
        running = false;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      }
      if (reduced) drawFrame(); // keep the calm static frame current
    };

    // prefers-reduced-motion: never animate, honour live changes.
    const mq =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    reduced = mq?.matches ?? false;
    const onMq = () => {
      reduced = mq?.matches ?? false;
      sync();
    };
    mq?.addEventListener?.("change", onMq);

    // Pause offscreen.
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === "function") {
      io = new IntersectionObserver((entries) => {
        visible = entries[0]?.isIntersecting ?? true;
        sync();
      });
      io.observe(canvas);
    }

    const onVis = () => sync();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("resize", resize);

    resize();
    sync();

    return () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      mq?.removeEventListener?.("change", onMq);
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} className="hero-canvas" aria-hidden="true" data-testid="hero-canvas" />;
}
