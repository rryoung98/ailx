"use client";
/**
 * T3 Runner — instrumented AI-assisted reasoning.
 * Chat with a DETERMINISTIC demo assistant (seeded, planted errors),
 * a revisioned answer draft, a primary-source panel (verification is an
 * instrumented act), and per-claim challenge/accept controls (RSR/RAIR).
 * Every action is emitted as an xAPI-shaped event; the artifact is the
 * full transcript + final answer. Reveal after submission: "you caught
 * X of Y".
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { TrackUIProps } from "@ailx/core";
import { assistantReply, DEMO_ASSISTANT_ID } from "./assistant.js";
import { validateT3Config } from "./plugin.js";
import { decodeT3Checkpoint, encodeT3Checkpoint, type T3ChatMsg } from "./checkpoint.js";
import { revealSummary } from "./reveal.js";
import type { T3Config, T3Turn } from "./types.js";

type Phase = "brief" | "work" | "reveal";

const card: CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "1rem",
};
const btn: CSSProperties = {
  background: "var(--accent)", color: "#fff", border: "none",
  borderRadius: 8, padding: "0.5rem 1rem", cursor: "pointer", fontSize: "0.95rem",
};
const ghost: CSSProperties = {
  ...btn, background: "transparent", color: "var(--fg)", border: "1px solid var(--border)",
};
const tiny: CSSProperties = { fontSize: "0.8rem", padding: "0.25rem 0.6rem" };

type ChatMsg = T3ChatMsg;

export function Runner({ config, onEvent, onComplete, secondsRemaining, checkpoint, onCheckpoint }: TrackUIProps) {
  const cfg: T3Config = useMemo(() => validateT3Config(config), [config]);
  // Rehydrate from the persisted checkpoint on (re)mount — F2.
  const restored = useMemo(() => decodeT3Checkpoint(checkpoint), []);
  const [phase, setPhase] = useState<Phase>(restored?.phase ?? "brief");
  const [messages, setMessages] = useState<ChatMsg[]>(restored?.messages ?? []);
  const [input, setInput] = useState("");
  const [draft, setDraft] = useState(restored?.draft ?? "");
  const [savedDraft, setSavedDraft] = useState(restored?.savedDraft ?? "");
  const [showSource, setShowSource] = useState(false);
  const [stances, setStances] = useState<Record<string, "challenged" | "accepted">>(restored?.stances ?? {});
  const transcript = useRef<T3Turn[]>(restored?.transcript ?? []);
  const seq = useRef(restored?.seq ?? 0);
  const promptSeq = useRef(restored?.promptSeq ?? 0);
  const draftRev = useRef(restored?.draftRev ?? 0);
  const regenNonce = useRef(0);
  const completed = useRef(false);

  // Latest values for checkpointing from inside handlers (state setters
  // have not committed yet when handlers run).
  const latest = useRef({ phase, messages, draft, savedDraft, stances });
  latest.current = { phase, messages, draft, savedDraft, stances };

  const saveCheckpoint = useCallback(
    (next: Partial<typeof latest.current> = {}) => {
      const cur = { ...latest.current, ...next };
      onCheckpoint?.(
        encodeT3Checkpoint({
          phase: cur.phase,
          transcript: transcript.current,
          messages: cur.messages,
          draft: cur.draft,
          savedDraft: cur.savedDraft,
          stances: cur.stances,
          seq: seq.current,
          promptSeq: promptSeq.current,
          draftRev: draftRev.current,
        }),
      );
    },
    [onCheckpoint],
  );

  const claimText = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of cfg.plantedErrors) m.set(e.id, e.claim);
    for (const a of cfg.correctAdvice) m.set(a.id, a.claim);
    return m;
  }, [cfg]);

  const surfaced = useMemo(() => {
    const s: string[] = [];
    for (const m of messages) for (const id of m.claimIds) if (!s.includes(id)) s.push(id);
    return s;
  }, [messages]);

  const emit = useCallback(
    (turn: Omit<T3Turn, "seq" | "clientTs">) => {
      const full: T3Turn = { ...turn, seq: seq.current++, clientTs: new Date().toISOString() };
      transcript.current.push(full);
      onEvent({
        verb: full.verb,
        object: full.object,
        result: { text: full.text, claimIds: full.claimIds },
        context: {
          track: "t3-reasoning",
          revision_of: full.revisionOf,
          assistant: DEMO_ASSISTANT_ID,
        },
        clientTs: full.clientTs,
      });
      return full;
    },
    [onEvent],
  );

  const surfacedSet = () => {
    const s = new Set<string>();
    for (const t of transcript.current) {
      if (t.verb === "assisted" && t.claimIds) for (const id of t.claimIds) s.add(id);
    }
    return s;
  };

  const send = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    promptSeq.current += 1;
    regenNonce.current = 0;
    const pObj = `prompt:${promptSeq.current}`;
    emit({ verb: "prompted", object: pObj, text });
    const reply = assistantReply(cfg, text, promptSeq.current, surfacedSet(), 0);
    emit({ verb: "assisted", object: `assist:${promptSeq.current}`, text: reply.text, claimIds: reply.claimIds });
    const nextMessages: ChatMsg[] = [
      ...messages,
      { role: "user", text, claimIds: [], object: pObj },
      { role: "assistant", text: reply.text, claimIds: [...reply.claimIds], object: `assist:${promptSeq.current}` },
    ];
    setMessages(nextMessages);
    setInput("");
    saveCheckpoint({ messages: nextMessages });
  }, [cfg, emit, input, messages, saveCheckpoint]);

  const regenerate = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    regenNonce.current += 1;
    const prior = `assist:${promptSeq.current}`;
    const reply = assistantReply(cfg, lastUser.text, promptSeq.current, surfacedSet(), regenNonce.current);
    emit({
      verb: "regenerated",
      object: `assist:${promptSeq.current}#${regenNonce.current}`,
      text: reply.text,
      claimIds: reply.claimIds,
      revisionOf: prior,
    });
    const out = [...messages];
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].role === "assistant") {
        out[i] = { ...out[i], text: reply.text, claimIds: [...reply.claimIds] };
        break;
      }
    }
    setMessages(out);
    saveCheckpoint({ messages: out });
  }, [cfg, emit, messages, saveCheckpoint]);

  const saveDraft = useCallback(() => {
    if (draft === savedDraft) return;
    const prev = draftRev.current;
    draftRev.current += 1;
    emit({
      verb: "revised",
      object: `draft:rev-${draftRev.current}`,
      text: draft,
      revisionOf: prev > 0 ? `draft:rev-${prev}` : undefined,
    });
    setSavedDraft(draft);
    saveCheckpoint({ savedDraft: draft });
  }, [draft, emit, savedDraft, saveCheckpoint]);

  const checkSource = useCallback(() => {
    setShowSource((v) => {
      if (!v) emit({ verb: "verified", object: "source" });
      return !v;
    });
  }, [emit]);

  const setStance = useCallback(
    (id: string, verb: "challenged" | "accepted") => {
      emit({ verb, object: `claim:${id}` });
      const next = { ...latest.current.stances, [id]: verb };
      setStances(next);
      saveCheckpoint({ stances: next });
    },
    [emit, saveCheckpoint],
  );

  // Submit shows the reveal interstitial FIRST; onComplete fires only when
  // the candidate continues (or, on timeout, the exam rebuilds the same
  // artifact from the checkpoint saved here). Events and the artifact shape
  // are unchanged — the reveal is presentation over already-captured data.
  const submit = useCallback(() => {
    if (phase === "reveal") return;
    if (draft !== savedDraft) {
      const prev = draftRev.current;
      draftRev.current += 1;
      emit({
        verb: "revised",
        object: `draft:rev-${draftRev.current}`,
        text: draft,
        revisionOf: prev > 0 ? `draft:rev-${prev}` : undefined,
      });
    }
    emit({ verb: "submitted", object: "t3-reasoning:final", text: draft });
    setSavedDraft(draft);
    setPhase("reveal");
    saveCheckpoint({ phase: "reveal", savedDraft: draft });
  }, [draft, emit, phase, savedDraft, saveCheckpoint]);

  /** Reveal → exam. Called exactly once, from the reveal's continue button. */
  const finish = useCallback(() => {
    if (completed.current) return;
    completed.current = true;
    onComplete({ transcript: transcript.current, finalAnswer: latest.current.savedDraft });
  }, [onComplete]);

  const words = draft.trim() ? draft.trim().split(/\s+/).length : 0;

  if (phase === "brief") {
    return (
      <div style={{ maxWidth: 760, margin: "0 auto", display: "grid", gap: "1rem" }}>
        <div style={card}>
          <h2 style={{ marginTop: 0 }}>T3 · AI-Assisted Reasoning</h2>
          <p style={{ fontWeight: 600 }}>{cfg.title}</p>
          <p>{cfg.brief}</p>
          <p style={{ color: "var(--muted)" }}>
            Work the brief with the assistant. Every prompt, revision, regeneration
            and verification is recorded. The assistant is a{" "}
            <strong>deterministic demo simulator</strong> — and, per the exam design,
            some of what it tells you is wrong. Challenge what you doubt; accept what
            you verify. Target {cfg.minWords} words.
          </p>
          <button
            style={btn}
            onClick={() => {
              setPhase("work");
              saveCheckpoint({ phase: "work" });
            }}
          >
            Begin
          </button>
        </div>
      </div>
    );
  }

  if (phase === "reveal") {
    const summary = revealSummary(cfg, surfaced, stances);
    const stanceColor: Record<string, string> = {
      challenged: "#4ade80", accepted: "#f87171", ignored: "var(--muted)",
    };
    const stanceLabel: Record<string, string> = {
      challenged: "✓ challenged", accepted: "✗ accepted", ignored: "— ignored",
    };
    return (
      <div style={{ maxWidth: 760, margin: "0 auto", display: "grid", gap: "1rem" }}>
        <div
          style={{
            ...card,
            ...(summary.perfect
              ? { border: "1px solid #4ade80", boxShadow: "0 0 24px rgba(74,222,128,0.25)" }
              : {}),
          }}
        >
          <h2 style={{ marginTop: 0, ...(summary.perfect ? { color: "#4ade80" } : {}) }}>
            {summary.perfect ? "🎉 " : ""}You caught {summary.caught} of {summary.total} planted errors
          </h2>
          {summary.perfect && (
            <p style={{ color: "#4ade80", fontWeight: 600 }}>
              Clean sweep — you challenged every planted error the assistant tried on you.
            </p>
          )}
          <p style={{ color: "var(--muted)" }}>
            The assistant&apos;s environment was seeded with known-incorrect outputs.
            Here is what was planted:
          </p>
          {summary.rows.map((r) => (
            <div key={r.id} style={{ borderLeft: `3px solid ${r.stance === "challenged" ? "#4ade80" : "var(--border)"}`, paddingLeft: "0.8rem", marginBottom: "0.8rem" }}>
              <p style={{ margin: 0 }}>
                <span style={{ color: stanceColor[r.stance] }}>{stanceLabel[r.stance]}</span>
                {!r.surfaced && (
                  <span style={{ color: "var(--muted)" }}> (never surfaced in your chat)</span>
                )}{" "}
                <em>&ldquo;{r.claim}&rdquo;</em>
              </p>
              <p style={{ margin: 0, color: "var(--muted)" }}>Source says: {r.truth}</p>
            </div>
          ))}
          <p style={{ color: "var(--muted)" }}>
            Transcript stored: {transcript.current.length} events. Scoring runs from
            the stored transcript and stored jury judgments only — this reveal is
            presentation, not scoring.
          </p>
          <button style={btn} onClick={finish}>
            Continue →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
      <div style={{ display: "grid", gap: "0.8rem", alignContent: "start" }}>
        <div style={{ ...card, maxHeight: 380, overflowY: "auto" }}>
          <div style={{ color: "var(--muted)", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
            Assistant · {DEMO_ASSISTANT_ID} · {Math.max(0, Math.floor(secondsRemaining / 60))}m left
          </div>
          {messages.length === 0 && (
            <p style={{ color: "var(--muted)" }}>Ask the assistant about the source or the brief.</p>
          )}
          {messages.map((m, i) => (
            <div key={i} style={{ marginBottom: "0.7rem" }}>
              <div style={{ fontSize: "0.75rem", color: m.role === "user" ? "var(--accent)" : "var(--muted)" }}>
                {m.role === "user" ? "you" : "assistant"}
              </div>
              <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Prompt the assistant…"
            style={{
              flex: 1, background: "var(--bg)", color: "var(--fg)",
              border: "1px solid var(--border)", borderRadius: 8, padding: "0.55rem 0.8rem",
            }}
          />
          <button style={btn} onClick={send}>Send</button>
          <button style={ghost} onClick={regenerate} disabled={messages.length === 0}>
            Regenerate
          </button>
        </div>
        {surfaced.length > 0 && (
          <div style={card}>
            <div style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "0.5rem" }}>
              Assistant claims — challenge what you doubt, accept what you verify
            </div>
            {surfaced.map((id) => (
              <div key={id} style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.45rem" }}>
                <span style={{ flex: 1, fontSize: "0.85rem" }}>{claimText.get(id)}</span>
                <button
                  style={{ ...ghost, ...tiny, borderColor: stances[id] === "challenged" ? "#f87171" : "var(--border)", color: stances[id] === "challenged" ? "#f87171" : "var(--fg)" }}
                  onClick={() => setStance(id, "challenged")}
                >
                  Challenge
                </button>
                <button
                  style={{ ...ghost, ...tiny, borderColor: stances[id] === "accepted" ? "#4ade80" : "var(--border)", color: stances[id] === "accepted" ? "#4ade80" : "var(--fg)" }}
                  onClick={() => setStance(id, "accepted")}
                >
                  Accept
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gap: "0.8rem", alignContent: "start" }}>
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>Your analysis</strong>
            <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
              {words} / {cfg.minWords} words · rev {draftRev.current}
            </span>
          </div>
          <textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              saveCheckpoint({ draft: e.target.value });
            }}
            rows={14}
            placeholder="Take and defend a position the stakeholder can act on…"
            style={{
              width: "100%", marginTop: "0.6rem", background: "var(--bg)", color: "var(--fg)",
              border: "1px solid var(--border)", borderRadius: 8, padding: "0.7rem",
              fontFamily: "inherit", fontSize: "0.95rem", resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem" }}>
            <button style={ghost} onClick={saveDraft} disabled={draft === savedDraft}>
              Save revision
            </button>
            <button style={ghost} onClick={checkSource}>
              {showSource ? "Hide source" : "Check source"}
            </button>
            <button style={btn} onClick={submit} disabled={words === 0}>
              Submit final
            </button>
          </div>
        </div>
        {showSource && (
          <div style={{ ...card, maxHeight: 300, overflowY: "auto" }}>
            <strong>{cfg.sourceTitle}</strong>
            <p style={{ whiteSpace: "pre-wrap", color: "var(--muted)", fontSize: "0.9rem" }}>
              {cfg.sourceExcerpt}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
