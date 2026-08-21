"use client";

/**
 * Landing-page teaser: a draggable card stack of three REAL items from the
 * committed instrument snapshot — a photo-pair member, an AI-vs-human
 * passage, and a hostile message. Swipe left for authentic, right for
 * synthetic (same mapping as the full T2 deck: ← real · → fake).
 *
 * Idle auto-demo: after AUTO_DEMO_DELAY_MS with no interaction, the top
 * card drags itself toward the correct side (stamp and all), then springs
 * back. It never commits an answer, and it stops forever on first touch.
 * Reduced motion: no auto-demo, instant transitions.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { TEASER_ITEMS, type TeaserItem } from "./demoItems";
import {
  stampOpacity, swipeDir, swipeRotation, transitionFor,
  useSwipeCard, type SwipeDir,
} from "./useSwipeCard";

export const AUTO_DEMO_DELAY_MS = 4000;
export const AUTO_DEMO_REPEAT_MS = 5500;

const LABELS: Record<TeaserItem["kind"], { authentic: string; synthetic: string }> = {
  media: { authentic: "Real photo", synthetic: "AI-generated" },
  text: { authentic: "Human", synthetic: "AI" },
  message: { authentic: "Legit", synthetic: "Hostile" },
};

/** ← authentic · → synthetic, matching the full T2 deck's arrow keys. */
const DIR_VERDICT: Record<SwipeDir, "authentic" | "synthetic"> = {
  left: "authentic",
  right: "synthetic",
};

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}

function CardFace({ item }: { item: TeaserItem }) {
  return item.imgSrc ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="photo" src={item.imgSrc} alt={item.imgAlt ?? "photo"} draggable={false} />
  ) : (
    <blockquote style={{ margin: 0, fontSize: "0.9rem", border: "none", background: "none", padding: 0, color: "inherit" }}>
      <strong>{item.title}.</strong> {item.text}
    </blockquote>
  );
}

export function Teaser() {
  const items = TEASER_ITEMS;
  const [idx, setIdx] = useState(0);
  const [last, setLast] = useState<{ correct: boolean; tell: string } | null>(null);
  const [score, setScore] = useState(0);
  const [interacted, setInteracted] = useState(false);
  const reducedMotion = useMemo(prefersReducedMotion, []);
  const done = idx >= items.length;
  const item = items[idx];
  const itemRef = useRef(item);
  itemRef.current = item;

  const answer = (verdict: "authentic" | "synthetic") => {
    const cur = itemRef.current;
    if (!cur) return;
    const correct = verdict === cur.key;
    setScore((s) => s + (correct ? 1 : 0));
    setLast({ correct, tell: cur.tell });
    setIdx((i) => i + 1);
  };

  const swipe = useSwipeCard({
    enabled: !done,
    reducedMotion,
    onCommit: (dir) => answer(DIR_VERDICT[dir]),
    onInteract: () => setInteracted(true),
  });
  const demoSwipeRef = useRef(swipe.demoSwipe);
  demoSwipeRef.current = swipe.demoSwipe;

  // Idle auto-demo: hint-drags the top card toward its correct side.
  useEffect(() => {
    if (done || interacted || reducedMotion) return;
    let interval: number | undefined;
    const run = () => {
      const cur = itemRef.current;
      if (!cur) return;
      demoSwipeRef.current(cur.key === "authentic" ? "left" : "right");
    };
    const timeout = window.setTimeout(() => {
      run();
      interval = window.setInterval(run, AUTO_DEMO_REPEAT_MS);
    }, AUTO_DEMO_DELAY_MS);
    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [done, interacted, reducedMotion]);

  if (done) {
    const perfect = score === items.length;
    return (
      <div className="hero-play pop-in">
        <div className="eyebrow">round complete</div>
        <p style={{ fontSize: "1.3rem", margin: "0.2rem 0" }}>
          <strong>{score} / {items.length}{perfect ? " 🔥" : ""}</strong>{" "}
          {perfect
            ? "— sharp. The full deck adds a clock and confidence stakes."
            : "— these three come straight from the real item bank. The full deck adds a clock and confidence stakes."}
        </p>
        {last && <p className="muted small">{last.tell}</p>}
        <Link className="btn primary" href="/exam">Play the full deck →</Link>
      </div>
    );
  }

  const rot = swipeRotation(swipe.dx, swipe.width);
  const dir = swipeDir(swipe.dx);
  const stampAlpha = stampOpacity(swipe.dx, swipe.width);
  const labels = LABELS[item.kind];

  return (
    <div
      className="hero-play"
      data-pill-clear=""
      tabIndex={0}
      role="group"
      aria-label="Real-or-fake teaser. Swipe or drag the card, press the buttons, or use the left and right arrow keys. Left means authentic, right means synthetic."
      data-demo={swipe.demoing}
      data-interacted={interacted}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") { e.preventDefault(); swipe.fling("left"); }
        else if (e.key === "ArrowRight") { e.preventDefault(); swipe.fling("right"); }
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="eyebrow" style={{ marginBottom: 0 }}>real or fake? swipe it</span>
        <span className="faint small mono">
          {idx + 1} / {items.length}{score > 0 ? ` · streak ${score}` : ""}
        </span>
      </div>
      {last && (
        <p role="status" className="small fade-in" style={{ color: last.correct ? "var(--good)" : "var(--bad)", margin: "0.4rem 0 0" }}>
          {last.correct ? "✓ caught it. " : "✗ missed. "}<span className="muted">{last.tell}</span>
        </p>
      )}
      <div className="teaser-stack">
        {items.slice(idx, idx + 3).map((it, i) => {
          const top = i === 0;
          return (
            <div
              key={it.id}
              className="teaser-card"
              data-top={top}
              ref={top ? (el) => swipe.cardRef(el) : undefined}
              {...(top ? swipe.handlers : {})}
              style={{
                zIndex: 3 - i,
                touchAction: top ? "pan-y" : undefined,
                cursor: top ? (swipe.phase === "drag" ? "grabbing" : "grab") : undefined,
                transform: top
                  ? `translateX(${swipe.dx}px) rotate(${rot}deg)`
                  : `translateY(${i * 9}px) scale(${1 - i * 0.045})`,
                transition: top
                  ? transitionFor(swipe.phase, reducedMotion)
                  : reducedMotion ? "none" : "transform 320ms cubic-bezier(.2,.9,.3,1.25)",
              }}
            >
              <CardFace item={it} />
              {top && (
                <>
                  <span className="verdict-stamp left" aria-hidden="true" style={{ opacity: dir === "left" ? stampAlpha : 0 }}>
                    {labels.authentic}
                  </span>
                  <span className="verdict-stamp right" aria-hidden="true" style={{ opacity: dir === "right" ? stampAlpha : 0 }}>
                    {labels.synthetic}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.8rem" }}>
        <button className="btn choice" onClick={() => swipe.fling("left")}>← {labels.authentic}</button>
        <button className="btn choice" onClick={() => swipe.fling("right")}>{labels.synthetic} →</button>
      </div>
      <p className="faint small" style={{ margin: "0.6rem 0 0" }}>
        drag the card, tap a button, or hit ← →
      </p>
    </div>
  );
}
