"use client";

/** Landing-page teaser: three real T2 items, playable in place. */

import { useState } from "react";
import Link from "next/link";
import { TEASER_ITEMS } from "./demoItems";

export function Teaser() {
  const items = TEASER_ITEMS;
  const [idx, setIdx] = useState(0);
  const [last, setLast] = useState<{ correct: boolean; tell: string } | null>(null);
  const [score, setScore] = useState(0);
  const done = idx >= items.length;
  const item = items[idx];

  const answer = (verdict: "authentic" | "synthetic") => {
    const correct = verdict === item.key;
    setScore((s) => s + (correct ? 1 : 0));
    setLast({ correct, tell: item.tell });
    setIdx((i) => i + 1);
  };

  if (done) {
    return (
      <div className="hero-play pop-in">
        <div className="eyebrow">round complete</div>
        <p style={{ fontSize: "1.3rem", margin: "0.2rem 0" }}>
          <strong>{score} / {items.length}</strong> — {score === items.length ? "sharp. The real deck is 120 items with confidence scoring." : "in a 2,000-person study, 0.1% got everything right."}
        </p>
        {last && <p className="muted small">{last.tell}</p>}
        <Link className="btn primary" href="/exam">Sit the full exam →</Link>
      </div>
    );
  }

  return (
    <div className="hero-play">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="eyebrow" style={{ marginBottom: 0 }}>real or fake? try it</span>
        <span className="faint small mono">{idx + 1} / {items.length}</span>
      </div>
      {last && (
        <p className={`small fade-in`} style={{ color: last.correct ? "var(--good)" : "var(--bad)", margin: "0.4rem 0" }}>
          {last.correct ? "✓ caught it. " : "✗ missed. "}<span className="muted">{last.tell}</span>
        </p>
      )}
      <div className="swipe-card" key={item.id} style={{ marginTop: "0.6rem" }}>
        {item.svg ? (
          <div className="photo" dangerouslySetInnerHTML={{ __html: item.svg }} />
        ) : (
          <blockquote style={{ margin: 0, fontSize: "0.92rem" }}><strong>{item.title}.</strong> {item.text}</blockquote>
        )}
      </div>
      <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.8rem" }}>
        <button className="btn choice" onClick={() => answer("authentic")}>{item.kind === "media" ? "Real" : "Legit"}</button>
        <button className="btn choice" onClick={() => answer("synthetic")}>{item.kind === "media" ? "Fake" : "Hostile"}</button>
      </div>
    </div>
  );
}
