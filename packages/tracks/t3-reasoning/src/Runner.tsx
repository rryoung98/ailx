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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  // Paper design: white text on the app accent green (#0b6b47) = 6.4:1.
  background: "var(--accent)", color: "#ffffff", border: "none",
  borderRadius: 8, padding: "0.5rem 1rem", cursor: "pointer", fontSize: "0.95rem",
};
const ghost: CSSProperties = {
  ...btn, background: "transparent", color: "var(--fg)", border: "1px solid var(--border)",
};
const tiny: CSSProperties = { fontSize: "0.8rem", padding: "0.25rem 0.6rem" };

/** Mobile containment (same bug class as the T1 submit-button escape):
 *  cards may never leak controls, rows must wrap, grid children must be
 *  shrinkable, and inputs render >= 16px so iOS Safari does not zoom-jump. */
const T3_CSS = `
.t3-shell { min-width: 0; }
.t3-shell * { box-sizing: border-box; }
.t3-shell textarea, .t3-shell input { max-width: 100%; min-width: 0; }
@media (max-width: 900px) {
  .t3-shell textarea, .t3-shell input, .t3-shell select { font-size: 16px !important; }
}
/* 700px matches where the app's runner-frame forces this grid single-column
   (globals.css): only there does the analysis sit BELOW the chat. */
@media (max-width: 700px) {
  /* Full-width prompt line: the buttons wrap below instead of sharing the
     row with the input. Inline styles keep the desktop row (flex 1 1 160px). */
  .t3-shell .t3-row-prompt > input { flex-basis: 100% !important; }
  /* The 14-row analysis draft dominates a phone screen and pushes the
     assistant chat out of reach. Cap it only while it is still EMPTY
     (:placeholder-shown): once the player starts writing, the full rows
     height returns. Coarse pointers have no resize handle, so a permanent
     cap would box a long draft into a 6-line scroll window. */
  .t3-shell .t3-analysis:placeholder-shown { height: 200px; }
}
.t3-shell textarea { max-height: 60vh; }
@media (pointer: coarse) {
  .t3-shell button { min-height: 44px; }
  .t3-shell textarea { resize: none !important; }
}
`;

type ChatMsg = T3ChatMsg;

type Stance = "challenged" | "accepted";

/**
 * Per-claim stance toggle. The selected state must survive both a screen
 * reader (aria-pressed) and a glance (filled tone + check glyph, never a
 * colour-only cue) — a border tint alone was invisible to both.
 */
function StanceButton({
  claimId,
  stance,
  label,
  tone,
  selected,
  onSelect,
}: {
  claimId: string;
  stance: Stance;
  label: string;
  tone: string;
  selected: boolean;
  onSelect: (id: string, stance: Stance) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-describedby={`claim-${claimId}`}
      data-testid={`stance-${stance}-${claimId}`}
      style={{
        ...ghost,
        ...tiny,
        borderColor: selected ? tone : "var(--border)",
        background: selected ? tone : "transparent",
        color: selected ? "#ffffff" : "var(--fg)",
        fontWeight: selected ? 700 : 400,
      }}
      onClick={() => onSelect(claimId, stance)}
    >
      {selected ? `✓ ${label}` : label}
    </button>
  );
}

export function Runner({ config, onEvent, onComplete, secondsRemaining, checkpoint, onCheckpoint }: TrackUIProps) {
  const cfg: T3Config = useMemo(() => validateT3Config(config), [config]);
  // Rehydrate from the persisted checkpoint on (re)mount — F2.
  const restored = useMemo(() => decodeT3Checkpoint(checkpoint), []);
  const [phase, setPhase] = useState<Phase>(restored?.phase ?? "brief");
  const [messages, setMessages] = useState<ChatMsg[]>(restored?.messages ?? []);
  const [input, setInput] = useState("");
  const [draft, setDraft] = useState(restored?.draft ?? "");
  const [savedDraft, setSavedDraft] = useState(restored?.savedDraft ?? "");
  // Bug fix: the source document is the reading material for the whole
  // track — it renders VISIBLY (open by default), collapsible for small
  // screens. "Verify against source" stays the instrumented act.
  const [sourceOpen, setSourceOpen] = useState(true);
  /** Presentation-only tally so "Verify against source" has a visible,
   *  announced effect; the scored record stays the emitted event. */
  const [verifyCount, setVerifyCount] = useState(0);
  const sourceRef = useRef<HTMLElement>(null);
  const [stances, setStances] = useState<Record<string, "challenged" | "accepted">>(restored?.stances ?? {});
  const transcript = useRef<T3Turn[]>(restored?.transcript ?? []);
  const seq = useRef(restored?.seq ?? 0);
  const promptSeq = useRef(restored?.promptSeq ?? 0);
  const draftRev = useRef(restored?.draftRev ?? 0);
  const regenNonce = useRef(0);
  const completed = useRef(false);
  const revealHeadingRef = useRef<HTMLHeadingElement>(null);

  // A11y: on submit the whole view is replaced by the reveal — move focus
  // to its heading so keyboard/AT users land on the outcome, not a void.
  useEffect(() => {
    if (phase === "reveal") revealHeadingRef.current?.focus();
  }, [phase]);

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

  /**
   * Verification is a scored, instrumented act — and it used to be an
   * INVISIBLE one: with the source panel already on screen,
   * `block: "nearest"` scrolls nothing, so pressing the button produced no
   * change at all and read as a broken control. The count below is
   * presentation over the same emitted event; nothing scored moves.
   */
  const checkSource = useCallback(() => {
    emit({ verb: "verified", object: "source" });
    setSourceOpen(true);
    setVerifyCount((n) => n + 1);
    sourceRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
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
      challenged: "var(--good, #15803d)", accepted: "var(--bad, #b91c1c)", ignored: "var(--muted)",
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
              ? { border: `1px solid var(--good, #15803d)`, boxShadow: "0 0 24px rgba(11,107,71,0.18)" }
              : {}),
          }}
        >
          <h2
            ref={revealHeadingRef}
            tabIndex={-1}
            style={{ marginTop: 0, outline: "none", ...(summary.perfect ? { color: "var(--good, #15803d)" } : {}) }}
          >
            {summary.perfect ? "🎉 " : ""}You caught {summary.caught} of {summary.total} planted errors
          </h2>
          {summary.perfect && (
            <p style={{ color: "var(--good, #15803d)", fontWeight: 600 }}>
              Clean sweep — you challenged every planted error the assistant tried on you.
            </p>
          )}
          <p style={{ color: "var(--muted)" }}>
            The assistant&apos;s environment was seeded with known-incorrect outputs.
            Here is what was planted:
          </p>
          {summary.rows.map((r) => (
            <div key={r.id} style={{ borderLeft: `3px solid ${r.stance === "challenged" ? "var(--good, #15803d)" : "var(--border)"}`, paddingLeft: "0.8rem", marginBottom: "0.8rem" }}>
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
    <div className="t3-shell" style={{ maxWidth: 1080, margin: "0 auto", display: "grid", gap: "1rem" }}>
      <style>{T3_CSS}</style>
      {/* Task brief — ALWAYS visible while working (user report: "the brief
          is not visible" — it used to exist only on the pre-Begin screen,
          so it vanished the moment work started). */}
      <section
        aria-label="Task brief"
        style={{ ...card, borderLeft: "3px solid var(--accent, #0b6b47)" }}
      >
        <strong>{cfg.title}</strong>
        <p style={{ margin: "0.35rem 0 0", fontSize: "0.92rem" }}>{cfg.brief}</p>
        <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
          Challenge what you doubt; accept what you verify. Target {cfg.minWords} words.
        </p>
      </section>
      {/* Source document — ALWAYS in the layout (the reading material the
          planted errors are checked against), scrollable, collapsible on
          small screens. */}
      <section ref={sourceRef} aria-label="Source document" style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.6rem", flexWrap: "wrap" }}>
          <strong>{cfg.sourceTitle}</strong>
          <button
            style={{ ...ghost, ...tiny }}
            aria-expanded={sourceOpen}
            onClick={() => setSourceOpen((v) => !v)}
          >
            {sourceOpen ? "Collapse" : "Expand source"}
          </button>
        </div>
        {sourceOpen && (
          <div style={{ maxHeight: 260, overflowY: "auto", marginTop: "0.5rem" }}>
            <p style={{ whiteSpace: "pre-wrap", color: "var(--fg)", fontSize: "0.92rem", lineHeight: 1.55, margin: 0 }}>
              {cfg.sourceExcerpt}
            </p>
          </div>
        )}
      </section>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1rem" }}>
      <div style={{ display: "grid", gap: "0.8rem", alignContent: "start" }}>
        <div role="log" aria-label="Assistant conversation" style={{ ...card, maxHeight: 380, overflowY: "auto" }}>
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
        {/* flexWrap + minWidth: 0 keep this row from forcing the page wider
            than the phone viewport (min-content of input + two buttons was
            403px at a 390px viewport — horizontal-scroll bug). */}
        <div className="t3-row-prompt" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input
            aria-label="Prompt the assistant"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Prompt the assistant…"
            style={{
              flex: "1 1 160px", minWidth: 0, boxSizing: "border-box",
              background: "var(--bg)", color: "var(--fg)",
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
                <span id={`claim-${id}`} style={{ flex: 1, fontSize: "0.85rem" }}>{claimText.get(id)}</span>
                <StanceButton
                  claimId={id}
                  stance="challenged"
                  label="Challenge"
                  tone="var(--bad, #b91c1c)"
                  selected={stances[id] === "challenged"}
                  onSelect={setStance}
                />
                <StanceButton
                  claimId={id}
                  stance="accepted"
                  label="Accept"
                  tone="var(--good, #15803d)"
                  selected={stances[id] === "accepted"}
                  onSelect={setStance}
                />
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
            aria-label="Your analysis draft"
            className="t3-analysis"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              saveCheckpoint({ draft: e.target.value });
            }}
            rows={14}
            placeholder="Take and defend a position the stakeholder can act on…"
            style={{
              width: "100%", maxWidth: "100%", boxSizing: "border-box", minWidth: 0,
              marginTop: "0.6rem", background: "var(--bg)", color: "var(--fg)",
              border: "1px solid var(--border)", borderRadius: 8, padding: "0.7rem",
              fontFamily: "inherit", fontSize: "0.95rem", resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem", flexWrap: "wrap" }}>
            <button style={ghost} onClick={saveDraft} disabled={draft === savedDraft}>
              Save revision
            </button>
            <button style={ghost} onClick={checkSource}>
              Verify against source
            </button>
            <button style={btn} onClick={submit} disabled={words === 0}>
              Submit final
            </button>
          </div>
          <p role="status" style={{ margin: "0.4rem 0 0", color: "var(--muted)", fontSize: "0.8rem" }}>
            {verifyCount === 0
              ? "Checking a claim against the source is recorded — press Verify against source when you look."
              : `Verification recorded ${verifyCount} time${verifyCount === 1 ? "" : "s"}.`}
          </p>
        </div>
      </div>
      </div>
    </div>
  );
}
