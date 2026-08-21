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
import { decodeT2Checkpoint, encodeT2Checkpoint, type T2Phase } from "./checkpoint.js";
import { SwipeDeck, isImageMaterial } from "./SwipeDeck.js";

type Phase = T2Phase;

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
  if (item.material.startsWith("data:image/") || /^(https?:)?\/[^\s]+\.(jpe?g|png|webp|gif)$/i.test(item.material)) {
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

export function Runner({ locale, config, onEvent, onComplete, checkpoint, onCheckpoint }: TrackUIProps) {
  const cfg: T2Config = useMemo(() => validateT2Config(config), [config]);
  // Rehydrate from the persisted checkpoint on (re)mount — F2.
  const restored = useMemo(() => decodeT2Checkpoint(checkpoint), []);
  const [phase, setPhase] = useState<Phase>(restored?.phase ?? "intro");
  const [idx, setIdx] = useState(restored?.deckIndex ?? 0);
  const [choice, setChoice] = useState<number | null>(null);
  const [confidence, setConfidence] = useState(50);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [responses, setResponses] = useState<T2Response[]>(restored?.responses ?? []);
  const [replayIdx, setReplayIdx] = useState(restored?.replayIdx ?? 0);
  const shownAt = useRef(0);
  const decisionLatency = useRef<number | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const completed = useRef(false);

  // Checkpoint every meaningful mutation with explicit next values (state
  // setters have not committed yet inside handlers).
  const saveCheckpoint = useCallback(
    (next: Partial<{ phase: Phase; deckIndex: number; replayIdx: number; responses: T2Response[] }>) => {
      onCheckpoint?.(
        encodeT2Checkpoint({
          phase: next.phase ?? phase,
          deckIndex: next.deckIndex ?? idx,
          replayIdx: next.replayIdx ?? replayIdx,
          responses: next.responses ?? responses,
        }),
      );
    },
    [idx, onCheckpoint, phase, replayIdx, responses],
  );

  // Bring the confidence sheet into view when it slides up.
  useEffect(() => {
    if (choice !== null && typeof sheetRef.current?.scrollIntoView === "function") {
      sheetRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [choice]);

  const item = cfg.items[idx];
  const deckHasImages = useMemo(
    () => cfg.items.some((i) => isImageMaterial(i.material)),
    [cfg.items],
  );
  const untimed = !item || item.type === "provenance";
  const exposure = item?.exposureSeconds ?? (untimed ? 0 : 15);

  const record = useCallback(
    (choiceIdx: number, conf: number) => {
      // Latency is anchored at card reveal and captured at the moment of the
      // swipe decision (not at confidence lock-in); a lapse falls back to
      // the full exposure elapsed.
      const latencyMs =
        decisionLatency.current ?? Math.max(0, Math.round(performance.now() - shownAt.current));
      decisionLatency.current = null;
      const r: T2Response = { itemId: item.id, choice: choiceIdx, confidence: conf, latencyMs };
      onEvent({
        verb: "responded",
        object: `item:${item.id}`,
        result: r,
        context: { track: "t2-discrimination", index: idx, type: item.type },
        clientTs: new Date().toISOString(),
      });
      const nextResponses = [...responses, r];
      setResponses(nextResponses);
      setChoice(null);
      setConfidence(50);
      if (idx + 1 < cfg.items.length) {
        setIdx(idx + 1);
        saveCheckpoint({ responses: nextResponses, deckIndex: idx + 1 });
      } else {
        setPhase("replay");
        saveCheckpoint({ responses: nextResponses, phase: "replay" });
      }
    },
    [cfg.items.length, idx, item, onEvent, responses, saveCheckpoint],
  );

  // Fixed-exposure countdown per timed item; a lapse is recorded as choice -1.
  useEffect(() => {
    if (phase !== "deck" || !item) return;
    shownAt.current = performance.now();
    decisionLatency.current = null;
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
    saveCheckpoint({ phase: "done" });
  }, [onComplete, onEvent, responses, saveCheckpoint]);

  if (phase === "intro") {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", display: "grid", gap: "1rem" }}>
        <div style={card}>
          <h2 style={{ marginTop: 0 }}>T2 · Authenticity Discrimination</h2>
          <p style={{ color: "var(--muted)" }}>
            {cfg.items.length} items. Swipe the card (or use ← / →, or the labeled
            buttons) to make the call. Timed items have a fixed exposure — a declared
            measurement decision. For each: make the call, then set how sure you are
            (0–100). Confidence is scored: being confidently wrong costs more than
            being uncertainly wrong. After the deck, a replay teaches each item&apos;s
            rationale. Locale: {locale}.
          </p>
          <button
            style={btn}
            onClick={() => {
              setPhase("deck");
              saveCheckpoint({ phase: "deck" });
            }}
          >
            Start the deck
          </button>
        </div>
      </div>
    );
  }

  if (phase === "deck" && item) {
    const sheetOpen = choice !== null;
    return (
      <div style={{ maxWidth: 560, margin: "0 auto", display: "grid", gap: "0.8rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)" }}>
          <span>
            Item {idx + 1} / {cfg.items.length} · {item.type}
          </span>
          <span aria-live="polite">
            {untimed ? "untimed" : `${Math.max(0, secondsLeft ?? exposure)}s`}
          </span>
        </div>
        <SwipeDeck
          item={item}
          nextItems={cfg.items.slice(idx + 1, idx + 3)}
          deckHasImages={deckHasImages}
          enabled={!sheetOpen}
          onChoose={(i) => {
            if (choice !== null) return;
            decisionLatency.current = Math.max(0, Math.round(performance.now() - shownAt.current));
            setChoice(i);
          }}
        />
        {/* Confidence sheet — slides up under the deck after each swipe. */}
        <div
          ref={sheetRef}
          data-testid="confidence-sheet"
          aria-hidden={!sheetOpen}
          style={{
            ...card,
            transform: sheetOpen ? "translateY(0)" : "translateY(115%)",
            opacity: sheetOpen ? 1 : 0,
            transition: "transform 260ms cubic-bezier(0.2, 1.2, 0.4, 1), opacity 200ms ease",
            pointerEvents: sheetOpen ? "auto" : "none",
          }}
        >
          <p style={{ margin: "0 0 0.4rem", fontWeight: 600 }}>
            Your call: {choice !== null ? item.options[choice] : "—"}
          </p>
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
          <button
            style={{ ...btn, marginTop: "0.8rem", opacity: sheetOpen ? 1 : 0.5 }}
            disabled={!sheetOpen}
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
            <button
              style={btn}
              onClick={() => {
                setReplayIdx(replayIdx + 1);
                saveCheckpoint({ replayIdx: replayIdx + 1 });
              }}
            >
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
