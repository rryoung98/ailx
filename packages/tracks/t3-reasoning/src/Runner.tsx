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
import { validateT3PresentationConfig } from "./plugin.js";
import { decodeT3Checkpoint, encodeT3Checkpoint, type T3ChatMsg } from "./checkpoint.js";
import { revealSummary, revealSummaryFromPlants, type RevealSummary } from "./reveal.js";
import { verifiedClaimIds } from "./scoring.js";
import type { T3Config, T3PresentationConfig, T3Turn } from "./types.js";

type Phase = "brief" | "work" | "reveal";

/**
 * HOSTED mode identifies its assistant honestly: the replies are computed by
 * the exam service over the OPERATIONAL scenario, because deciding which
 * claim surfaces requires the planted-error list — the one thing a browser
 * sitting this track may never hold (docs/ARCHITECTURE.md §4).
 */
const HOSTED_ASSISTANT_ID = "ailx-instrumented-assistant@1 (served by the exam service)";

/** What the end-of-track reveal can say, and when. */
type RevealState =
  | { state: "loading" }
  /** The attempt is still open: the server reveals nothing, and neither do we. */
  | { state: "withheld" }
  | { state: "ready"; summary: RevealSummary }
  | { state: "error"; message: string };

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

export function Runner({ config, onEvent, onComplete, onPresentation, secondsRemaining, checkpoint, onCheckpoint }: TrackUIProps) {
  /**
   * PRESENTATION config. Hosted mode is handed the redacted sitting form —
   * title, brief, source, minWords and the hosted seam — and nothing else;
   * static mode is handed the released-practice scenario, plant list and all.
   * The validator is the same one either way (see `validate` in plugin.ts).
   */
  const cfg: T3PresentationConfig = useMemo(() => validateT3PresentationConfig(config), [config]);
  /** Present exactly when the SERVER owns this sitting's scenario. */
  const hosted = cfg.hosted;
  const assistantId = hosted ? HOSTED_ASSISTANT_ID : DEMO_ASSISTANT_ID;
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
  /**
   * Claims checked against the source, DERIVED from the persisted transcript
   * so the tally survives a reload and can never disagree with what scoring
   * counts (`verifiedClaimIds`). Presentation over the emitted events.
   */
  const [verifiedClaims, setVerifiedClaims] = useState<string[]>(
    () => [...verifiedClaimIds(restored?.transcript ?? [])],
  );
  const sourceRef = useRef<HTMLElement>(null);
  const [stances, setStances] = useState<Record<string, "challenged" | "accepted">>(restored?.stances ?? {});
  const transcript = useRef<T3Turn[]>(restored?.transcript ?? []);
  const seq = useRef(restored?.seq ?? 0);
  const promptSeq = useRef(restored?.promptSeq ?? 0);
  const draftRev = useRef(restored?.draftRev ?? 0);
  const regenNonce = useRef(0);
  const completed = useRef(false);
  /** Hosted only: a reply is in flight, or the last request failed. */
  const [awaitingReply, setAwaitingReply] = useState(false);
  const [assistError, setAssistError] = useState<string | null>(null);
  const pendingAssist = useRef<
    { prompt: string; nonce: number; replace: boolean; seq: number } | null
  >(null);
  const [hostedReveal, setHostedReveal] = useState<RevealState>({ state: "loading" });
  const revealHeadingRef = useRef<HTMLHeadingElement>(null);

  // A11y: on submit the whole view is replaced by the reveal — move focus
  // to its heading so keyboard/AT users land on the outcome, not a void.
  useEffect(() => {
    if (phase === "reveal") revealHeadingRef.current?.focus();
  }, [phase]);

  /**
   * HOSTED reveal. What was planted is the answer key, so it is the SERVER
   * that decides whether this attempt may see it, from `finalized_at` alone.
   * Submitting T3 does not finalize the attempt — the run continues — so the
   * honest answer mid-run is "not yet", and that is what renders. Nothing
   * here can turn a sitting view into a reveal: there is no plant list in
   * this tab to fall back on.
   */
  useEffect(() => {
    if (phase !== "reveal" || !hosted) return;
    let cancelled = false;
    setHostedReveal({ state: "loading" });
    hosted
      .reveal()
      .then((plants) => {
        if (cancelled) return;
        setHostedReveal(
          plants === null
            ? { state: "withheld" }
            : { state: "ready", summary: revealSummaryFromPlants(plants) },
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setHostedReveal({
          state: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [hosted, phase]);

  /**
   * P0 fairness: the reveal says of itself that it is "presentation, not
   * scoring" — the transcript and stances behind it are already stored. The
   * session engine holds the track clock (and its watchdog) while it is up.
   */
  useEffect(() => {
    onPresentation?.(phase === "reveal" ? "t3-reveal" : null);
  }, [onPresentation, phase]);

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

  /**
   * Label for each claim the assistant surfaced.
   *
   * STATIC: the released-practice scenario publishes every claim's text, so
   * the row shows it. HOSTED: the server names a claim by an OPAQUE per-
   * attempt ref and puts its text inside the reply, on purpose — a per-claim
   * text endpoint would be a list of "the claims that matter", and the point
   * of the ref is that a plant and a piece of correct advice are
   * indistinguishable here. So the row points back at the reply instead.
   */
  const claimText = useMemo(() => {
    const m = new Map<string, string>();
    if (!hosted) {
      for (const e of cfg.plantedErrors ?? []) m.set(e.id, e.claim);
      for (const a of cfg.correctAdvice ?? []) m.set(a.id, a.claim);
      return m;
    }
    let reply = 0;
    for (const msg of messages) {
      if (msg.role !== "assistant") continue;
      reply += 1;
      msg.claimIds.forEach((ref, i) => {
        if (!m.has(ref)) m.set(ref, `Claim ${i + 1} in the assistant's reply ${reply}`);
      });
    }
    return m;
  }, [cfg, hosted, messages]);

  const surfaced = useMemo(() => {
    const s: string[] = [];
    for (const m of messages) for (const id of m.claimIds) if (!s.includes(id)) s.push(id);
    return s;
  }, [messages]);

  /**
   * Append one turn. `seq` may be RESERVED by the caller: a hosted assistant
   * reply is numbered before its request leaves, so a stance click while the
   * reply is in flight cannot take the number the reply is stored under (the
   * server's transcript is keyed by seq, and a collision would silently drop
   * one of the two turns).
   *
   * In hosted mode every CLIENT-authored turn is also mirrored to the
   * append-only server transcript, which is what the server's score reads.
   * `assisted` is never mirrored — the server wrote that row itself, and it
   * refuses a client that claims one.
   */
  const emit = useCallback(
    (turn: Omit<T3Turn, "seq" | "clientTs"> & { seq?: number }) => {
      const full: T3Turn = {
        ...turn,
        seq: turn.seq ?? seq.current++,
        clientTs: new Date().toISOString(),
      };
      transcript.current.push(full);
      onEvent({
        verb: full.verb,
        object: full.object,
        result: { text: full.text, claimIds: full.claimIds },
        context: {
          track: "t3-reasoning",
          revision_of: full.revisionOf,
          assistant: assistantId,
        },
        clientTs: full.clientTs,
      });
      if (hosted && full.verb !== "assisted") hosted.record(full);
      return full;
    },
    [assistantId, hosted, onEvent],
  );

  /**
   * One place that moves the chat forward: state, the checkpoint, and the
   * ref an in-flight reply reads when it lands (a hosted reply resolves
   * before React has re-rendered, so the closure's `messages` is stale).
   */
  const commitMessages = useCallback(
    (next: ChatMsg[]) => {
      latest.current = { ...latest.current, messages: next };
      setMessages(next);
      saveCheckpoint({ messages: next });
    },
    [saveCheckpoint],
  );

  const surfacedSet = () => {
    const s = new Set<string>();
    for (const t of transcript.current) {
      if (t.verb === "assisted" && t.claimIds) for (const id of t.claimIds) s.add(id);
    }
    return s;
  };

  /** Record a landed reply — same shape whoever computed it. */
  const applyReply = useCallback(
    (reply: { text: string; claimIds: string[] }, nonce: number, replace: boolean, assistSeq: number) => {
      const object = `assist:${promptSeq.current}`;
      if (replace) {
        emit({
          seq: assistSeq,
          verb: "regenerated",
          object: `${object}#${nonce}`,
          text: reply.text,
          claimIds: reply.claimIds,
          revisionOf: object,
        });
        const out = [...latest.current.messages];
        for (let i = out.length - 1; i >= 0; i--) {
          if (out[i].role === "assistant") {
            out[i] = { ...out[i], text: reply.text, claimIds: [...reply.claimIds] };
            break;
          }
        }
        commitMessages(out);
        return;
      }
      emit({ seq: assistSeq, verb: "assisted", object, text: reply.text, claimIds: reply.claimIds });
      commitMessages([
        ...latest.current.messages,
        { role: "assistant", text: reply.text, claimIds: [...reply.claimIds], object },
      ]);
    },
    [commitMessages, emit],
  );

  /**
   * Ask for one assistant reply.
   *
   * HOSTED: `POST /v1/attempts/:id/t3/assist`, and NOTHING ELSE. There is
   * deliberately no fallback to `assistantReply` here: the local simulator
   * needs the planted-error list to decide what surfaces, so a fallback
   * would mean shipping the answer key to every hosted candidate — the exact
   * leak this seam closes. A failure is shown, and retried against the same
   * (prompt, promptSeq, regenNonce), which the server replays rather than
   * re-runs.
   *
   * STATIC: the released-practice scenario is in this bundle on purpose, so
   * the deterministic simulator runs in the tab, unchanged.
   */
  const requestAssist = useCallback(
    async (prompt: string, nonce: number, replace: boolean, assistSeq: number): Promise<void> => {
      if (!hosted) {
        if (!cfg.plantedErrors) return;   // Unreachable: the validator demands one.
        applyReply(
          assistantReply(cfg as T3Config, prompt, promptSeq.current, surfacedSet(), nonce),
          nonce,
          replace,
          assistSeq,
        );
        return;
      }
      pendingAssist.current = { prompt, nonce, replace, seq: assistSeq };
      setAssistError(null);
      setAwaitingReply(true);
      try {
        const reply = await hosted.assist({
          prompt,
          promptSeq: promptSeq.current,
          regenNonce: nonce,
          seq: assistSeq,
        });
        pendingAssist.current = null;
        applyReply({ text: reply.text, claimIds: [...reply.claimRefs] }, nonce, replace, assistSeq);
      } catch (err) {
        setAssistError(
          `the assistant could not be reached: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setAwaitingReply(false);
      }
    },
    [applyReply, cfg, hosted],
  );

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || awaitingReply) return;
    promptSeq.current += 1;
    regenNonce.current = 0;
    const pObj = `prompt:${promptSeq.current}`;
    emit({ verb: "prompted", object: pObj, text });
    // Reserved BEFORE the await: see emit().
    const assistSeq = seq.current++;
    commitMessages([...latest.current.messages, { role: "user", text, claimIds: [], object: pObj }]);
    setInput("");
    void requestAssist(text, 0, false, assistSeq);
  }, [awaitingReply, commitMessages, emit, input, requestAssist]);

  const regenerate = useCallback(() => {
    const lastUser = [...latest.current.messages].reverse().find((m) => m.role === "user");
    if (!lastUser || awaitingReply) return;
    regenNonce.current += 1;
    void requestAssist(lastUser.text, regenNonce.current, true, seq.current++);
  }, [awaitingReply, requestAssist]);

  /** Retry the request that failed, verbatim — the server replays its reply. */
  const retryAssist = useCallback(() => {
    const p = pendingAssist.current;
    if (p) void requestAssist(p.prompt, p.nonce, p.replace, p.seq);
  }, [requestAssist]);

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

  /** Open/scroll to the source. Reading is not a scored act on its own. */
  const openSource = useCallback(() => {
    setSourceOpen(true);
    sourceRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, []);

  /**
   * Verification is a scored, instrumented act, and it is now attributed to
   * the CLAIM it checked (F5). The old track-wide button emitted
   * `verified/source`, so two presses bought a quarter of the Process
   * component with no claim involved; scoring counts distinct verified
   * claims, and repeat presses on one claim are recorded but add nothing.
   */
  const verifyClaim = useCallback(
    (id: string) => {
      emit({ verb: "verified", object: `claim:${id}`, claimIds: [id] });
      setVerifiedClaims((prev) => (prev.includes(id) ? prev : [...prev, id]));
      openSource();
    },
    [emit, openSource],
  );

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
          <h2 style={{ marginTop: 0 }}>T3 · Calibrated Reliance</h2>
          <p style={{ fontWeight: 600 }}>{cfg.title}</p>
          <p>{cfg.brief}</p>
          <p style={{ color: "var(--muted)" }}>
            Work the brief with the assistant. Every prompt, revision, regeneration
            and verification is recorded. The assistant is{" "}
            <strong>
              {hosted ? "instrumented by the exam service" : "a deterministic demo simulator"}
            </strong>{" "}
            — and, per the exam design, some of what it tells you is wrong. Challenge
            what you doubt; accept what you verify. Target {cfg.minWords} words.
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
    /**
     * The summary, from whoever is entitled to produce it: static mode
     * derives it from the released-practice plant list in this bundle;
     * hosted mode has only what the SERVER returned, and null until the
     * attempt is finalized. There is no third path.
     */
    const summary = hosted
      ? hostedReveal.state === "ready"
        ? hostedReveal.summary
        : null
      : revealSummary({ plantedErrors: cfg.plantedErrors ?? [] }, surfaced, stances);
    const stanceColor: Record<string, string> = {
      challenged: "var(--good, #15803d)", accepted: "var(--bad, #b91c1c)", ignored: "var(--muted)",
    };
    const stanceLabel: Record<string, string> = {
      challenged: "✓ challenged", accepted: "✗ accepted", ignored: "— ignored",
    };
    if (summary === null) {
      return (
        <div style={{ maxWidth: 760, margin: "0 auto", display: "grid", gap: "1rem" }}>
          <div style={card} data-testid="t3-reveal-withheld">
            <h2 ref={revealHeadingRef} tabIndex={-1} style={{ marginTop: 0, outline: "none" }}>
              Your analysis is recorded
            </h2>
            <p style={{ color: "var(--muted)" }}>
              {hostedReveal.state === "error"
                ? `The reveal could not be loaded: ${hostedReveal.message}`
                : hostedReveal.state === "loading"
                  ? "Loading your reveal…"
                  : "What the assistant was seeded with stays with the exam service until your run is finalized — it is the marking scheme of this track, and it is the same for the candidate sitting next to you. Your diagnostic report shows it once the run is over."}
            </p>
            <p style={{ color: "var(--muted)" }}>
              Transcript stored: {transcript.current.length} events. Scoring runs on the
              server from the stored transcript and stored jury judgments only.
            </p>
            <button style={btn} onClick={finish}>
              Continue →
            </button>
          </div>
        </div>
      );
    }
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
            Assistant · {assistantId} · {Math.max(0, Math.floor(secondsRemaining / 60))}m left
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
          {awaitingReply && (
            <p role="status" data-testid="assist-pending" style={{ color: "var(--muted)" }}>
              The assistant is answering…
            </p>
          )}
          {/* A failed reply is SHOWN. It is never quietly replaced by a
              locally computed one: this tab has no scenario to compute from,
              and giving it one would hand over the answer key. */}
          {assistError && (
            <p role="alert" data-testid="assist-error" style={{ color: "var(--bad, #b91c1c)" }}>
              {assistError}{" "}
              <button style={{ ...ghost, ...tiny }} onClick={retryAssist}>
                Retry
              </button>
            </p>
          )}
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
          <button style={btn} onClick={send} disabled={awaitingReply}>Send</button>
          <button style={ghost} onClick={regenerate} disabled={messages.length === 0 || awaitingReply}>
            Regenerate
          </button>
        </div>
        {surfaced.length > 0 && (
          <div style={card}>
            <div style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "0.5rem" }}>
              Assistant claims — check one against the source, challenge what you doubt,
              accept what you verify
            </div>
            {surfaced.map((id) => (
              <div key={id} style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.45rem" }}>
                <span id={`claim-${id}`} style={{ flex: 1, fontSize: "0.85rem" }}>{claimText.get(id)}</span>
                <button
                  style={ghost}
                  onClick={() => verifyClaim(id)}
                  aria-describedby={`claim-${id}`}
                  aria-pressed={verifiedClaims.includes(id)}
                >
                  {verifiedClaims.includes(id) ? "Checked ✓" : "Check source"}
                </button>
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
            <button style={ghost} onClick={openSource}>
              Open the source
            </button>
            <button style={btn} onClick={submit} disabled={words === 0}>
              Submit final
            </button>
          </div>
          <p role="status" style={{ margin: "0.4rem 0 0", color: "var(--muted)", fontSize: "0.8rem" }}>
            {verifiedClaims.length === 0
              ? "Verification is scored per claim: press Check source next to an assistant claim when you check it. Opening the source is not scored on its own."
              : `Checked against the source: ${verifiedClaims.length} claim${verifiedClaims.length === 1 ? "" : "s"}. Re-checking the same claim adds nothing.`}
          </p>
        </div>
      </div>
      </div>
    </div>
  );
}
