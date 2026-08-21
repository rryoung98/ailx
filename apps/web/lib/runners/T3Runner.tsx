"use client";

/** T3 demo runner — instrumented assistant with planted errors (§T3). */

import { useState } from "react";
import type { TrackUIProps } from "@ailx/core";
import { T3_PROBLEM } from "../demoItems";

type Verdict = "accepted" | "rejected";

export function T3Runner(props: TrackUIProps) {
  const turns = T3_PROBLEM.turns;
  const [shown, setShown] = useState(1);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [analysis, setAnalysis] = useState("");
  const [revealed, setRevealed] = useState(false);

  const decided = Object.keys(verdicts).length;
  const allDecided = decided === turns.length && shown >= turns.length;

  const decide = (id: string, v: Verdict) => {
    if (verdicts[id]) return;
    setVerdicts((m) => ({ ...m, [id]: v }));
    props.onEvent({
      verb: v === "accepted" ? "accepted" : "rejected",
      object: `t3:output:${id}`,
      clientTs: new Date().toISOString(),
    });
  };

  const ask = () => {
    setShown((s) => Math.min(turns.length, s + 1));
    props.onEvent({ verb: "prompted", object: "t3:assistant", clientTs: new Date().toISOString() });
  };

  const planted = turns.filter((t) => t.planted);
  const caught = planted.filter((t) => verdicts[t.id] === "rejected").length;
  const overRejected = turns.filter((t) => !t.planted && verdicts[t.id] === "rejected").length;

  if (revealed) {
    return (
      <div className="fade-in">
        <h3 style={{ marginTop: 0 }}>
          Trap reveal — you caught <span style={{ color: caught === planted.length ? "var(--good)" : "var(--warn)" }}>{caught} of {planted.length}</span> planted errors
        </h3>
        {overRejected > 0 && (
          <p className="muted small">…and rejected {overRejected} correct output{overRejected > 1 ? "s" : ""}. Over-rejection is a failure too (RAIR).</p>
        )}
        <ul className="checklist">
          {turns.map((t) => (
            <li key={t.id}>
              <span className={`badge ${
                t.planted
                  ? verdicts[t.id] === "rejected" ? "pass-check" : "fail-check"
                  : verdicts[t.id] === "accepted" ? "pass-check" : "fail-check"
              }`}>
                {t.planted ? "trap" : "ok"}
              </span>
              <span style={{ flex: 1 }} className="small">
                you {verdicts[t.id]} — <span className="muted">{t.explain}</span>
              </span>
            </li>
          ))}
        </ul>
        <label className="small muted" htmlFor="t3a">Your verdict on the three-year claim (scored by the jury):</label>
        <textarea id="t3a" className="field" rows={3} value={analysis}
          placeholder="On the stated figures…"
          onChange={(e) => setAnalysis(e.target.value)} style={{ margin: "0.4rem 0 1rem" }} />
        <button
          className="btn primary"
          onClick={() => props.onComplete({
            demo: true, trackId: "t3",
            t3: { verdicts, caught, plantedTotal: planted.length, overRejected, analysis },
          })}
        >
          Submit analysis →
        </button>
      </div>
    );
  }

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>{T3_PROBLEM.title}</h3>
      <p className="muted small">{T3_PROBLEM.brief}</p>
      <div className="chat">
        {turns.slice(0, shown).map((t) => (
          <div className="chat-turn fade-in" key={t.id}>
            <div className="chat-bubble">{t.text}</div>
            <div className="chat-actions">
              {verdicts[t.id] ? (
                <span className={`badge ${verdicts[t.id] === "accepted" ? "pass-check" : "fail-check"}`}>{verdicts[t.id]}</span>
              ) : (
                <>
                  <button className="btn small-btn" onClick={() => decide(t.id, "accepted")}>Accept</button>
                  <button className="btn small-btn" onClick={() => decide(t.id, "rejected")}>Reject</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: "0.6rem", marginTop: "1rem" }}>
        {shown < turns.length && (
          <button className="btn" disabled={Object.keys(verdicts).length < shown} onClick={ask}>
            Ask the assistant →
          </button>
        )}
        {allDecided && (
          <button className="btn primary" onClick={() => setRevealed(true)}>See what you caught →</button>
        )}
      </div>
      <p className="faint small" style={{ marginBottom: 0 }}>
        Some outputs are seeded wrong. Accept or reject each — every number it produces is your responsibility.
      </p>
    </div>
  );
}
