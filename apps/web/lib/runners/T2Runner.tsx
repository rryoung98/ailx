"use client";

/** T2 demo runner — the swipe deck (§13: where the interaction budget goes). */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { TrackUIProps } from "@ailx/core";
import { T2_ITEMS, type T2Item } from "../demoItems";

export interface T2Response {
  itemId: string;
  verdict: "authentic" | "synthetic";
  confident: boolean;
  correct: boolean;
}

export function T2Runner(props: TrackUIProps) {
  const items = T2_ITEMS;
  const [idx, setIdx] = useState(0);
  const [confident, setConfident] = useState(true);
  const [responses, setResponses] = useState<T2Response[]>([]);
  const [flash, setFlash] = useState<"left" | "right" | null>(null);
  const done = idx >= items.length;
  const item: T2Item | undefined = items[idx];

  const answer = useCallback((verdict: "authentic" | "synthetic") => {
    if (!item) return;
    const r: T2Response = { itemId: item.id, verdict, confident, correct: verdict === item.key };
    setResponses((rs) => [...rs, r]);
    props.onEvent({
      verb: "responded",
      object: `t2:item:${item.id.slice(0, 12)}`,
      result: { verdict, confident },
      clientTs: new Date().toISOString(),
    });
    setFlash(verdict === "authentic" ? "left" : "right");
    window.setTimeout(() => setFlash(null), 180);
    setIdx((i) => i + 1);
    setConfident(true);
  }, [item, confident, props]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (done) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); answer("authentic"); }
      if (e.key === "ArrowRight") { e.preventDefault(); answer("synthetic"); }
      if (e.key === "ArrowDown" || e.key === " ") { e.preventDefault(); setConfident((c) => !c); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [answer, done]);

  if (done) {
    const nCorrect = responses.filter((r) => r.correct).length;
    return (
      <div className="fade-in">
        <h3 style={{ marginTop: 0 }}>Replay reveal — {nCorrect} / {items.length}</h3>
        <p className="muted small">Scoring uses d′, not percent correct — being confidently wrong costs more than being uncertainly wrong.</p>
        <ul className="checklist">
          {responses.map((r, i) => (
            <li key={r.itemId}>
              <span className={`badge ${r.correct ? "pass-check" : "fail-check"}`}>{r.correct ? "hit" : "miss"}</span>
              <span style={{ flex: 1 }}>
                <strong>{items[i].title}</strong>
                <span className="muted small"> — was {items[i].key}. {items[i].tell}</span>
              </span>
              <span className="faint small mono">{r.confident ? "sure" : "unsure"} · {r.itemId.slice(0, 8)}</span>
            </li>
          ))}
        </ul>
        <button
          className="btn primary" style={{ marginTop: "1rem" }}
          onClick={() => props.onComplete({ demo: true, trackId: "t2", t2: { responses } })}
        >
          Bank it →
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.8rem" }}>
        <div className="deck-dots">
          {items.map((_, i) => (
            <span key={i} className={i < idx ? "dot done" : i === idx ? "dot now" : "dot"} />
          ))}
        </div>
        <span className="faint small mono">{idx + 1} / {items.length}</span>
      </div>

      <div className={`swipe-card${flash === "left" ? " tilt-left" : flash === "right" ? " tilt-right" : ""}`} key={item.id}>
        <div className="faint small mono" style={{ marginBottom: "0.5rem" }}>
          {item.kind === "media" ? "fixed exposure · look fast" : "hostile or legit?"} · item {item.id.slice(0, 8)}
        </div>
        {item.svg ? (
          <div className="photo" dangerouslySetInnerHTML={{ __html: item.svg }} />
        ) : (
          <blockquote style={{ margin: 0 }}><strong>{item.title}.</strong> {item.text}</blockquote>
        )}
      </div>

      <div style={{ display: "flex", gap: "0.6rem", marginTop: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn choice" onClick={() => answer("authentic")}>← {item.kind === "media" ? "Authentic" : "Legit"}</button>
        <button className="btn choice" onClick={() => answer("synthetic")}>{item.kind === "media" ? "Synthetic" : "Hostile"} →</button>
        <button className={`btn small-btn${confident ? " armed" : ""}`} onClick={() => setConfident((c) => !c)}>
          {confident ? "confident" : "unsure"} <span className="faint">(space)</span>
        </button>
      </div>
      <p className="faint small" style={{ marginBottom: 0 }}>arrow keys work · confidence is scored (Brier), not decoration</p>
    </div>
  );
}
