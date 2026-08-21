"use client";
/**
 * T2 Runner — swipe/judgement deck with fixed exposure, confidence slider,
 * then a replay phase teaching each item's rationale + provenance point.
 * Dark exam UI via the app's CSS vars. Client-only; no network.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { TrackUIProps } from "@ailx/core";
import type { T2Config, T2Item, T2Response } from "./types.js";
import { validateT2Config } from "./plugin.js";

type Phase = "intro" | "deck" | "replay" | "done";

const card: CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "1.25rem",
};

const btn: CSSProperties = {
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "0.6rem 1.2rem",
  fontSize: "1rem",
  cursor: "pointer",
};

const ghostBtn: CSSProperties = {
  ...btn,
  background: "transparent",
  color: "var(--fg)",
  border: "1px solid var(--border)",
};

function Material({ item }: { item: T2Item }) {
  if (item.material.startsWith("data:image/")) {
    return (
      <img
        src={item.material}
        alt="exam material"
        style={{ maxWidth: "100%", borderRadius: 8, border: "1px solid var(--border)" }}
      />
    );
  }
  return (
    <div
      style={{
        whiteSpace: "pre-wrap",
        fontFamily: item.type.startsWith("message") ? "ui-monospace, monospace" : "inherit",
        fontSize: "0.95rem",
        lineHeight: 1.5,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "0.9rem",
      }}
    >
      {item.material}
    </div>
  );
}

export function Runner({ locale, config, onEvent, onComplete }: TrackUIProps) {
  const cfg: T2Config = useMemo(() => validateT2Config(config), [config]);
  const [phase, setPhase] = useState<Phase>("intro");
  const [idx, setIdx] = useState(0);
  const [choice, setChoice] = useState<number | null>(null);
  const [confidence, setConfidence] = useState(50);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [responses, setResponses] = useState<T2Response[]>([]);
  const [replayIdx, setReplayIdx] = useState(0);
  const shownAt = useRef(0);
  const completed = useRef(false);

  const item = cfg.items[idx];
  const untimed = !item || item.type === "provenance";
  const exposure = item?.exposureSeconds ?? (untimed ? 0 : 15);

  const record = useCallback(
    (choiceIdx: number, conf: number) => {
      const latencyMs = Math.max(0, Math.round(performance.now() - shownAt.current));
      const r: T2Response = { itemId: item.id, choice: choiceIdx, confidence: conf, latencyMs };
      onEvent({
        verb: "responded",
        object: `item:${item.id}`,
        result: r,
        context: { track: "t2-discrimination", index: idx, type: item.type },
        clientTs: new Date().toISOString(),
      });
      setResponses((prev) => [...prev, r]);
      setChoice(null);
      setConfidence(50);
      if (idx + 1 < cfg.items.length) {
        setIdx(idx + 1);
      } else {
        setPhase("replay");
      }
    },
    [cfg.items.length, idx, item, onEvent],
  );

  // Fixed-exposure countdown per timed item; a lapse is recorded as choice -1.
  useEffect(() => {
    if (phase !== "deck" || !item) return;
    shownAt.current = performance.now();
    if (untimed) {
      setSecondsLeft(null);
      return;
    }
    setSecondsLeft(exposure);
    const startedIdx = idx;
    const t = setInterval(() => {
      setSecondsLeft((s) => (s === null ? null : s - 1));
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, idx]);

  useEffect(() => {
    if (phase === "deck" && secondsLeft !== null && secondsLeft <= 0) {
      record(choice ?? -1, choice === null ? 0 : confidence);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft]);

  const finish = useCallback(() => {
    if (completed.current) return;
    completed.current = true;
    const artifact = { responses };
    onEvent({
      verb: "submitted",
      object: "t2-discrimination:artifact",
      result: { count: responses.length },
      clientTs: new Date().toISOString(),
    });
    onComplete(artifact);
    setPhase("done");
  }, [onComplete, onEvent, responses]);

  if (phase === "intro") {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", display: "grid", gap: "1rem" }}>
        <div style={card}>
          <h2 style={{ marginTop: 0 }}>T2 · Authenticity Discrimination</h2>
          <p style={{ color: "var(--muted)" }}>
            {cfg.items.length} items. Timed items have a fixed exposure — a declared
            measurement decision. For each: make the call, then set how sure you are
            (0–100). Confidence is scored: being confidently wrong costs more than
            being uncertainly wrong. After the deck, a replay teaches each item&apos;s
            rationale. Locale: {locale}.
          </p>
          <button style={btn} onClick={() => setPhase("deck")}>
            Start the deck
          </button>
        </div>
      </div>
    );
  }

  if (phase === "deck" && item) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", display: "grid", gap: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)" }}>
          <span>
            Item {idx + 1} / {cfg.items.length} · {item.type}
          </span>
          <span aria-live="polite">
            {untimed ? "untimed" : `${Math.max(0, secondsLeft ?? exposure)}s`}
          </span>
        </div>
        <div style={card}>
          <p style={{ marginTop: 0, fontWeight: 600 }}>{item.stem}</p>
          <Material item={item} />
          <div style={{ display: "flex", gap: "0.6rem", marginTop: "1rem", flexWrap: "wrap" }}>
            {item.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => setChoice(i)}
                style={{
                  ...ghostBtn,
                  borderColor: choice === i ? "var(--accent)" : "var(--border)",
                  background: choice === i ? "var(--accent)" : "transparent",
                  color: choice === i ? "#fff" : "var(--fg)",
                }}
              >
                {opt}
              </button>
            ))}
          </div>
          <div style={{ marginTop: "1rem" }}>
            <label style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
              How sure? {confidence}
              <input
                type="range"
                min={0}
                max={100}
                value={confidence}
                onChange={(e) => setConfidence(Number(e.target.value))}
                style={{ width: "100%", accentColor: "var(--accent)" }}
              />
            </label>
          </div>
          <button
            style={{ ...btn, marginTop: "0.8rem", opacity: choice === null ? 0.5 : 1 }}
            disabled={choice === null}
            onClick={() => record(choice ?? -1, confidence)}
          >
            Lock in
          </button>
        </div>
      </div>
    );
  }

  if (phase === "replay") {
    const rItem = cfg.items[replayIdx];
    const resp = responses.find((r) => r.itemId === rItem.id);
    const correct = resp?.choice === rItem.key;
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", display: "grid", gap: "1rem" }}>
        <div style={{ color: "var(--muted)" }}>
          Replay {replayIdx + 1} / {cfg.items.length} — how each call should be reasoned
        </div>
        <div style={card}>
          <p style={{ marginTop: 0, fontWeight: 600 }}>{rItem.stem}</p>
          <Material item={rItem} />
          <p style={{ color: correct ? "#4ade80" : "#f87171", marginBottom: "0.3rem" }}>
            {resp && resp.choice >= 0
              ? `Your call: ${rItem.options[resp.choice]} (${resp.confidence} sure) — ${correct ? "correct" : "incorrect"}`
              : "No response (exposure lapsed)"}
          </p>
          <p style={{ marginBottom: "0.3rem" }}>
            <strong>Answer:</strong> {rItem.options[rItem.key]}
          </p>
          <p style={{ color: "var(--muted)" }}>
            <strong style={{ color: "var(--fg)" }}>Why:</strong> {rItem.rationale}
          </p>
          {rItem.teaching && (
            <p style={{ color: "var(--muted)", borderLeft: "3px solid var(--accent)", paddingLeft: "0.7rem" }}>
              <strong style={{ color: "var(--fg)" }}>Provenance point:</strong> {rItem.teaching}
            </p>
          )}
          {replayIdx + 1 < cfg.items.length ? (
            <button style={btn} onClick={() => setReplayIdx(replayIdx + 1)}>
              Next
            </button>
          ) : (
            <button style={btn} onClick={finish}>
              Finish track
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={card}>
        <h2 style={{ marginTop: 0 }}>T2 complete</h2>
        <p style={{ color: "var(--muted)" }}>
          {responses.length} responses recorded. Scoring is deterministic and runs
          from the stored responses only.
        </p>
      </div>
    </div>
  );
}
