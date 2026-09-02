"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { TrackUIProps } from "@ailx/core";
import { demoAssist } from "./assist.js";
import { buildPreviewSrcdoc, SANDBOX_ATTR } from "./sandbox.js";
import { decodeT1Checkpoint, encodeT1Checkpoint } from "./checkpoint.js";
import {
  buildVibeRequest,
  clearLlmConnection,
  CURATED_MODELS,
  DEFAULT_BASE_URL,
  extractHtmlFence,
  fetchModelIds,
  LLM_BASE_URL_STORAGE,
  normalizeBaseUrl,
  OPENROUTER_KEY_STORAGE,
  OpenRouterError,
  requestVibeCompletion,
} from "./openrouter.js";
import { exchangeCodeForKey } from "./sso.js";
import { claimPkceCallback } from "./pkceClaim.js";
import { t1Plugin } from "./plugin.js";
import { T1_TOTAL_POINTS, T1_WEIGHTS, type PromptLogEntry } from "./types.js";

const STARTER_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My site</title>
  <style>
    body { margin:0; background:#fffdf9; color:#1a1a1a; font-family:system-ui,sans-serif; }
    main { max-width:720px; margin:0 auto; padding:24px; }
  </style>
</head>
<body>
  <main>
    <h1>Your Name</h1>
    <p>What you work on, for whom.</p>
  </main>
</body>
</html>`;

/** How long after the last edit the sandbox re-renders automatically. */
export const AUTO_PREVIEW_DEBOUNCE_MS = 500;

/** Self-contained chat/pane styling (paper palette; standardized button
 *  motion: background/color/border 150ms, transform 120ms; hover fills
 *  with the accent; no dark backgrounds, no purple). */
const T1_CSS = `
.t1-shell { background: var(--bg, #f7f4f2); color: var(--fg, #1a1a1a); font-family: system-ui, sans-serif; }
.t1-shell .t1-btn {
  background: var(--accent, #0b6b47); color: #fff; border: 1px solid var(--accent, #0b6b47);
  border-radius: 7px; padding: 8px 14px; cursor: pointer; font-weight: 600; font: inherit; font-weight: 600;
  transition: background 150ms ease, color 150ms ease, border-color 150ms ease, transform 120ms ease;
}
.t1-shell .t1-btn:hover:not(:disabled) { background: #0e895a; border-color: #0e895a; transform: translateY(-1px); }
.t1-shell .t1-btn:active:not(:disabled) { transform: translateY(0) scale(0.98); }
.t1-shell .t1-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.t1-shell .t1-btn:focus-visible { outline: 2px solid var(--accent, #0b6b47); outline-offset: 2px; }
.t1-shell .t1-btn.ghost { background: var(--card, #fff); color: var(--fg, #1a1a1a); border: 1px solid var(--border-strong, #c9c2b9); }
.t1-shell .t1-btn.ghost:hover:not(:disabled) { background: var(--accent, #0b6b47); color: #fff; border-color: var(--accent, #0b6b47); }
.t1-shell .t1-tab {
  background: transparent; color: var(--muted, #595650); border: none; border-bottom: 2px solid transparent;
  padding: 6px 12px; cursor: pointer; font: inherit; font-weight: 600; font-size: 13px;
  transition: color 150ms ease, border-color 150ms ease;
}
.t1-shell .t1-tab[aria-selected="true"] { color: var(--accent, #0b6b47); border-bottom-color: var(--accent, #0b6b47); }
.t1-shell .t1-tab:focus-visible { outline: 2px solid var(--accent, #0b6b47); outline-offset: 2px; }
.t1-grid { display: grid; grid-template-columns: minmax(300px, 5fr) minmax(0, 7fr); gap: 12px; padding: 12px; align-items: stretch; }
.t1-grid > .t1-pane { min-width: 0; }
/* Pane height caps live in CSS (not inline) so the phone layout can lift
   them: a capped pane with visible overflow lets the submit button escape
   the card and land under the neighbouring pane's tab bar (mobile bug). */
.t1-pane {
  max-height: 78vh; min-height: 480px;
  /* Capped panes must scroll internally — visible overflow let the controls
     spill over the card edge onto the footer (user screenshot, mid-width). */
  overflow-y: auto;
}
@media (max-width: 900px) {
  .t1-grid { grid-template-columns: 1fr; }
  .t1-pane { max-height: none; min-height: 0; }
  /* Chat log keeps an internal scroll on phones instead of stretching the
     page; the pane itself grows so no control can overflow the card. */
  .t1-pane [role="log"] { max-height: 45vh; }
  /* >= 16px stops iOS Safari zoom-jump on focus (inline styles use 13px). */
  .t1-shell textarea, .t1-shell input, .t1-shell select { font-size: 16px !important; }
  /* Phone chat controls stack to full-width lines: the prompt was 197px
     and the model pair ~133px each at a 390px viewport, crushed beside
     their buttons. Scoped here so desktop keeps single rows (the inline
     styles stay flex: 1, basis 0). */
  .t1-shell .t1-row-prompt { flex-wrap: wrap; }
  .t1-shell .t1-row-prompt > textarea,
  .t1-shell .t1-row-model > select,
  .t1-shell .t1-row-model > input { flex-basis: 100% !important; }
}
/* Resizable textareas are clamped so the drag handle can never pull them
   past the card; touch devices get no drag handle at all. */
.t1-shell textarea { max-height: 60vh; }
@media (pointer: coarse) {
  .t1-shell .t1-btn, .t1-shell .t1-tab { min-height: 44px; }
  .t1-shell textarea { resize: none !important; }
}
`;

const panel: CSSProperties = {
  background: "var(--card, #ffffff)",
  border: "1px solid var(--border, #e3ddd6)",
  borderRadius: 10,
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  minHeight: 0,
};

const mono: CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 13,
  background: "var(--bg, #faf8f6)",
  color: "var(--fg)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: 8,
  width: "100%",
  boxSizing: "border-box",
  resize: "vertical",
};

const h2: CSSProperties = { margin: 0, fontSize: 13, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--muted)" };

/** Chat bubble transcript entry (presentation only — the scored prompt log
 *  lives in promptLog / the checkpoint, unchanged). */
interface ChatMsg {
  role: "user" | "assistant";
  text: string;
  code?: string;
}

function chatFromPromptLog(log: readonly PromptLogEntry[]): ChatMsg[] {
  const out: ChatMsg[] = [];
  for (const e of log) {
    if (e.kind === "prompted" && e.prompt) {
      out.push({ role: "user", text: e.prompt });
    } else if (e.kind === "revised" && e.modelId) {
      out.push({ role: "assistant", text: `Document updated by ${e.modelId}.` });
    }
  }
  return out;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/**
 * T1 Runner — Claude-Code-style two-pane build environment (spec §T1, §12, §13).
 * LEFT: the conversation (brief pinned on top, chat bubbles, input at the
 * bottom). RIGHT: the live sandboxed page preview (re-rendered automatically
 * ~500ms after every edit); the code editor sits behind a tab.
 */
export function Runner(props: TrackUIProps) {
  const cfg = useMemo(() => t1Plugin.validateConfig(props.config), [props.config]);
  // Rehydrate from the persisted checkpoint on (re)mount — F2.
  const restored = useMemo(() => decodeT1Checkpoint(props.checkpoint), []);
  const [html, setHtml] = useState(restored?.html ?? STARTER_HTML);
  const [preview, setPreview] = useState<string>(() =>
    buildPreviewSrcdoc(restored?.html ?? STARTER_HTML),
  );
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [chat, setChat] = useState<ChatMsg[]>(() =>
    chatFromPromptLog(restored?.promptLog ?? []),
  );
  const [assistPrompt, setAssistPrompt] = useState("");
  // BYOK OpenRouter vibe coding — key lives ONLY in the candidate's browser.
  const [orKey, setOrKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [model, setModel] = useState<string>(CURATED_MODELS[0]);
  const [customModel, setCustomModel] = useState("");
  const [modelOptions, setModelOptions] = useState<ReadonlyArray<string>>(CURATED_MODELS);
  const [assistBusy, setAssistBusy] = useState(false);
  const [assistError, setAssistError] = useState<string | null>(null);
  // The prompt whose real-model call failed: it stays available so the
  // error offers a way forward (retry, or fall back to the offline demo
  // assist) instead of a dead end.
  const [failedPrompt, setFailedPrompt] = useState<string | null>(null);
  const [selfReport, setSelfReport] = useState(restored?.selfReport ?? "");
  const [submitted, setSubmitted] = useState(false);
  /**
   * The finish step. Reflection ("why did you build it this way") used to
   * sit in the same column as the prompt box, so the candidate was asked to
   * DO the work and REFLECT on it in one visual space during a timed task.
   * It now lives in a step that REPLACES the working controls, entered
   * either to write the rationale early ("notes") or to end the track
   * ("submit"). Both entries show the same panel; only the submit entry
   * raises the alert, because arming a destructive action is the only one
   * of the two that warrants interrupting a screen reader. Leaving the
   * step keeps every character (state + checkpoint are untouched), so this
   * is never a one-way door.
   */
  const [finishStep, setFinishStep] = useState<null | "notes" | "submit">(null);
  const promptLog = useRef<PromptLogEntry[]>(restored?.promptLog ?? []);
  const dirtySinceRun = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const now = () => new Date().toISOString();
  const effectiveModel = customModel.trim() || model;
  const hasKey = orKey.trim().length > 0;
  const effectiveBase = normalizeBaseUrl(baseUrl);
  const customBase = effectiveBase !== DEFAULT_BASE_URL;
  // Real mode: a key (pasted or via SSO), OR a custom local/self-hosted
  // endpoint (key optional for e.g. Ollama/vLLM).
  const realMode = hasKey || customBase;

  // Keep the newest chat bubble in view.
  useEffect(() => {
    chatEndRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [chat.length, assistBusy]);

  // Load persisted key + base URL on mount (browser only — SSR safe).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(OPENROUTER_KEY_STORAGE);
      if (stored) setOrKey(stored);
      const storedBase = window.localStorage.getItem(LLM_BASE_URL_STORAGE);
      if (storedBase) setBaseUrl(storedBase);
    } catch {
      /* storage unavailable (private mode etc.) — BYOK simply not persisted */
    }
  }, []);

  // OAuth PKCE callback: ?code= in the URL + a stored verifier -> exchange
  // for a user-scoped key. `claimPkceCallback` takes both single-use halves
  // out of the browser BEFORE the request, so a StrictMode second pass has
  // nothing to spend and an unmount leaves neither behind (TEN-64).
  useEffect(() => {
    const claimed = claimPkceCallback();
    if (claimed === null) return;
    let cancelled = false;
    exchangeCodeForKey(fetch, claimed.code, claimed.verifier)
      .then((key) => {
        if (cancelled) return;
        updateKey(key);
        setAssistError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setAssistError(
          e instanceof OpenRouterError ? e.message : "OpenRouter sign-in failed.",
        );
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateKey = (value: string) => {
    setOrKey(value);
    setAssistError(null);
    try {
      if (value.trim().length > 0) {
        window.localStorage.setItem(OPENROUTER_KEY_STORAGE, value.trim());
      } else {
        window.localStorage.removeItem(OPENROUTER_KEY_STORAGE);
      }
    } catch {
      /* non-fatal */
    }
  };

  /**
   * Leave real mode for good: clear BOTH stored slots and reset the local
   * state. Clearing only the key left a custom base URL behind, which kept
   * realMode true and every retry failing.
   */
  const disconnect = () => {
    setOrKey("");
    setBaseUrl(DEFAULT_BASE_URL);
    setAssistError(null);
    setFailedPrompt(null);
    try {
      clearLlmConnection(window.localStorage);
    } catch {
      /* non-fatal */
    }
  };

  /**
   * Drop the dead connection and answer the failed prompt offline.
   * `askVibe` already pushed the "you" bubble for this prompt before the
   * call failed, so the offline answer must NOT echo it again — the chat
   * showed the same prompt twice, which reads as a double send on a
   * transcript the candidate is told is a submission artifact.
   */
  const fallbackToDemo = () => {
    const p = failedPrompt;
    disconnect();
    if (p) askDemo(p, { echoUser: false });
  };

  // In real mode, optionally populate the selector from GET /models.
  useEffect(() => {
    if (!realMode) {
      setModelOptions(CURATED_MODELS);
      return;
    }
    let cancelled = false;
    fetchModelIds(fetch, orKey.trim(), effectiveBase).then((ids) => {
      if (cancelled || ids.length === 0) return;
      const merged = [...CURATED_MODELS, ...ids.filter((id) => !CURATED_MODELS.includes(id))];
      setModelOptions(merged);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realMode, orKey, effectiveBase]);

  // Checkpoint every meaningful mutation with explicit next values (state
  // setters have not committed yet when handlers run).
  const checkpoint = (next: Partial<{ html: string; selfReport: string }>) => {
    props.onCheckpoint?.(
      encodeT1Checkpoint({
        html: next.html ?? html,
        promptLog: promptLog.current,
        selfReport: next.selfReport ?? selfReport,
      }),
    );
  };

  /** Commit the current document to the sandbox (used by the automatic
   *  debounce below AND by the manual fallback button). */
  const runPreview = () => {
    setPreview(buildPreviewSrcdoc(html));
    if (dirtySinceRun.current) {
      const entry: PromptLogEntry = { kind: "revised", clientTs: now() };
      promptLog.current = [...promptLog.current, entry];
      props.onEvent({
        verb: "revised",
        object: "t1/artifact",
        context: { bytes: html.length },
        clientTs: entry.clientTs,
      });
      dirtySinceRun.current = false;
    }
    checkpoint({});
  };

  // AUTOMATIC live preview: re-render the sandbox ~500ms after the last
  // hand edit (no button press needed; the button stays as a fallback).
  const runPreviewRef = useRef(runPreview);
  runPreviewRef.current = runPreview;
  useEffect(() => {
    if (!dirtySinceRun.current) return;
    const id = setTimeout(() => runPreviewRef.current(), AUTO_PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [html]);

  const askDemo = (p: string, opts?: { echoUser?: boolean }) => {
    const echoUser = opts?.echoUser !== false;
    const reply = demoAssist(p);
    const entry: PromptLogEntry = { kind: "prompted", prompt: p, modelId: reply.modelId, clientTs: now() };
    promptLog.current = [...promptLog.current, entry];
    props.onEvent({
      verb: "prompted",
      object: "t1/assist",
      result: { modelId: reply.modelId, title: reply.title },
      context: { prompt: p },
      clientTs: entry.clientTs,
    });
    setChat((c) => [
      ...c,
      ...(echoUser ? [{ role: "user" as const, text: p }] : []),
      { role: "assistant" as const, text: `${reply.title} — ${reply.note}`, code: reply.code },
    ]);
    checkpoint({});
  };

  /**
   * Real vibe-coding loop (BYOK): send brief + current document + request to
   * OpenRouter, expect the COMPLETE updated document in one ```html fence,
   * apply it to the editor and refresh the sandboxed preview. The CSP
   * srcdoc wrapper is unchanged — the artifact stays a contained site.
   * Errors surface inline and never crash the runner.
   */
  /** Cohort budget cap: ≤10 real-model calls per run keeps a funded 45-person
      cohort under ~$0.15/run (docs/BUDGET.md); the demo assist is free. */
  const REAL_ASSIST_CAP = 10;
  const realCalls = promptLog.current.filter((e) => e.kind === "prompted" && e.modelId && !String(e.modelId).startsWith("demo")).length;
  const askVibe = async (p: string) => {
    if (realCalls >= REAL_ASSIST_CAP) {
      setAssistError(`Run budget reached (${REAL_ASSIST_CAP} real-model calls) — refine by hand or use shorter prompts.`);
      // Terminal: retrying the same prompt would hit the same cap.
      setFailedPrompt(null);
      return;
    }
    setAssistBusy(true);
    setAssistError(null);
    setFailedPrompt(null);
    setChat((c) => [...c, { role: "user", text: p }]);
    const promptedEntry: PromptLogEntry = {
      kind: "prompted",
      prompt: p,
      modelId: effectiveModel,
      clientTs: now(),
    };
    promptLog.current = [...promptLog.current, promptedEntry];
    props.onEvent({
      verb: "prompted",
      object: "t1/assist",
      result: { modelId: effectiveModel },
      context: { prompt: p },
      clientTs: promptedEntry.clientTs,
    });
    checkpoint({});
    try {
      const payload = buildVibeRequest({
        model: effectiveModel,
        brief: cfg.brief,
        currentHtml: html,
        userPrompt: p,
      });
      const text = await requestVibeCompletion(fetch, orKey.trim(), payload, effectiveBase);
      const nextHtml = extractHtmlFence(text);
      if (nextHtml === null) {
        setAssistError("The model reply contained no ```html document fence. Try rephrasing.");
        setChat((c) => [
          ...c,
          { role: "assistant", text: "The reply contained no ```html document fence — nothing was applied. Try rephrasing." },
        ]);
        return;
      }
      setHtml(nextHtml);
      setPreview(buildPreviewSrcdoc(nextHtml));
      dirtySinceRun.current = false;
      const revisedEntry: PromptLogEntry = {
        kind: "revised",
        modelId: effectiveModel,
        clientTs: now(),
      };
      promptLog.current = [...promptLog.current, revisedEntry];
      props.onEvent({
        verb: "revised",
        object: "t1/artifact",
        result: { modelId: effectiveModel },
        context: { bytes: nextHtml.length, via: "openrouter" },
        clientTs: revisedEntry.clientTs,
      });
      setChat((c) => [
        ...c,
        { role: "assistant", text: `Document updated by ${effectiveModel} — the preview re-rendered.` },
      ]);
      checkpoint({ html: nextHtml });
    } catch (e) {
      setAssistError(
        e instanceof OpenRouterError ? e.message : "Unexpected error calling OpenRouter.",
      );
      setFailedPrompt(p);
    } finally {
      setAssistBusy(false);
    }
  };

  const askAssist = () => {
    const p = assistPrompt.trim();
    if (!p || assistBusy) return;
    setAssistPrompt("");
    if (realMode) {
      void askVibe(p);
    } else {
      askDemo(p);
    }
  };

  const submit = () => {
    if (submitted) return;
    setSubmitted(true);
    setFinishStep(null);
    const artifact = {
      html,
      promptLog: promptLog.current,
      selfReport: selfReport.slice(0, cfg.selfReportMaxChars),
    };
    props.onEvent({ verb: "submitted", object: "t1/artifact", clientTs: now() });
    props.onComplete(artifact);
  };

  return (
    <div className="t1-shell t1-grid" style={{ minHeight: "100%" }}>
      <style>{T1_CSS}</style>

      {/* LEFT — the conversation pane (Claude-Code style). */}
      <section aria-label="Build conversation" className="t1-pane" style={panel}>
        {/* Brief pinned on top as a compact card. */}
        <div
          aria-label="Brief"
          role="note"
          style={{
            background: "var(--bg, #f7f4f2)",
            border: "1px solid var(--border)",
            borderLeft: "3px solid var(--accent, #0b6b47)",
            borderRadius: 8,
            padding: "8px 10px",
          }}
        >
          {/* The clock stays (the page header scrolls out of reach in this
              two-pane layout) but it is NOT part of the heading: a heading
              that rewrites itself every second is announced on every
              heading jump and makes the two clocks look like they
              disagree. */}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
            <h2 style={h2}>Brief</h2>
            <span style={{ ...h2, textTransform: "none", letterSpacing: 0 }}>
              {fmtTime(props.secondsRemaining)} left
            </span>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 14 }}>{cfg.brief}</p>
          <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 12 }}>
            Required elements: {cfg.requiredElements.join(" · ")}
          </p>
        </div>

        {/* Chat transcript. */}
        <div
          role="log"
          aria-label="AI assist conversation"
          style={{ flex: 1, minHeight: 160, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, padding: "4px 0" }}
        >
          {chat.length === 0 && (
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
              {realMode
                ? "Real vibe coding (your key/endpoint, your browser only). Describe a change — the model returns the full updated document and the preview re-renders."
                : "demo simulator — deterministic offline demo: same prompt, same answer. It replies with a SNIPPET and does not edit your document: paste what you want into the Code tab yourself. Every prompt is logged to your submission artifact."}
            </p>
          )}
          {chat.map((m, i) => (
            <div
              key={i}
              style={{
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "88%",
                background: m.role === "user" ? "var(--accent-dim, #bcd9cc)" : "var(--card, #fff)",
                border: "1px solid var(--border)",
                borderRadius: m.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                padding: "8px 10px",
                fontSize: 13.5,
                whiteSpace: "pre-wrap",
              }}
            >
              <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>
                {m.role === "user" ? "you" : realMode ? effectiveModel : "demo assist"}
              </span>
              {m.text}
              {m.code ? (
                <pre style={{ ...mono, marginTop: 6, marginBottom: 0, overflowX: "auto", maxHeight: 180 }}>{m.code}</pre>
              ) : null}
            </div>
          ))}
          {assistBusy && (
            <div style={{ alignSelf: "flex-start", color: "var(--muted)", fontSize: 13 }}>
              {effectiveModel} is thinking…
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {assistError && (
          <div role="alert" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: "var(--bad, #b91c1c)", fontSize: 12 }}>{assistError}</span>
            {failedPrompt !== null && (
              <>
                <button
                  type="button"
                  className="t1-btn ghost"
                  style={{ padding: "4px 10px", fontSize: 12 }}
                  onClick={() => void askVibe(failedPrompt)}
                  disabled={assistBusy}
                >
                  Retry
                </button>
                <button
                  type="button"
                  className="t1-btn ghost"
                  style={{ padding: "4px 10px", fontSize: 12 }}
                  onClick={fallbackToDemo}
                  disabled={assistBusy}
                >
                  Use the offline demo assist
                </button>
              </>
            )}
          </div>
        )}

        {/* Working controls. They are hidden while the finish step is open
            so reflection is a STEP, not a second input competing with the
            prompt box for the same attention. */}
        {finishStep !== null && !submitted ? null : (
        <>
        {/* Model row (kept compact above the input). Phone layout: the CSS
            900px block stacks these controls to full-width lines. */}
        <div className="t1-row-model" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select
            aria-label="Assist model"
            style={{ ...mono, resize: "none", flex: 1, minWidth: 0 }}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={!realMode}
          >
            {modelOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <input
            aria-label="Custom model override"
            style={{ ...mono, resize: "none", flex: 1, minWidth: 0 }}
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            placeholder="custom model id (optional)"
            disabled={!realMode}
          />
          {realMode ? (
            <button type="button" className="t1-btn ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={disconnect}>
              Disconnect
            </button>
          ) : null}
        </div>
        {!realMode && (
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
            {/* This used to read "connect a model on the run start screen" —
                that screen is gone once the track is live, so it named an
                action the candidate could not take. */}
            No model is connected, so the offline demo assist answers here.
            You can still edit the document by hand in the Code tab; a real
            model can be connected again from the run start screen before
            your next run.
          </p>
        )}

        {/* Input pinned at the bottom of the pane. Phone layout: the CSS
            900px block wraps Send below a full-width prompt. */}
        <div className="t1-row-prompt" style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <textarea
            aria-label="Assist prompt"
            style={{ ...mono, minHeight: 44, flex: 1, minWidth: 0 }}
            value={assistPrompt}
            onChange={(e) => setAssistPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                askAssist();
              }
            }}
            placeholder={
              realMode
                ? "e.g. make the hero section bolder and add a project grid"
                : "e.g. give me a responsive project grid"
            }
          />
          <button
            type="button"
            className="t1-btn"
            onClick={askAssist}
            disabled={assistBusy}
          >
            {assistBusy ? "Asking…" : "Send"}
          </button>
        </div>

        </>
        )}

        {/* Finish step. Entered deliberately, and it still takes a SECOND
            deliberate press inside the step to end the track. */}
        {finishStep === null || submitted ? (
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="t1-btn"
              onClick={() => setFinishStep("submit")}
              disabled={submitted}
            >
              {submitted ? "Submitted" : "Submit final artifact"}
            </button>
            {!submitted && (
              <button
                type="button"
                className="t1-btn ghost"
                onClick={() => setFinishStep("notes")}
              >
                Design rationale
              </button>
            )}
          </div>
        ) : (
          <section
            aria-label="Finish T1"
            style={{ borderTop: "1px solid var(--border)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 8 }}
          >
            <h2 style={h2}>Design rationale</h2>
            {/* Honest, checkable numbers only — and READ from the allocation
                table rather than typed here, because a hardcoded "10 of 100"
                is exactly the kind of number that survives a re-weighting and
                lies to the candidate. The judge scores a blank rationale at
                zero; skipping is allowed and quiet, just never free. */}
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
              Worth {T1_WEIGHTS.rationale} of T1&rsquo;s {T1_TOTAL_POINTS} points,
              judged on how well it explains the artifact you built. You can
              leave it blank and submit anyway — that component then scores zero.
              About 200 words.
            </p>
            <textarea
              aria-label="Design rationale"
              style={{ ...mono, minHeight: 90 }}
              maxLength={cfg.selfReportMaxChars}
              value={selfReport}
              onChange={(e) => {
                setSelfReport(e.target.value);
                checkpoint({ selfReport: e.target.value });
              }}
              placeholder="State your intent: audience, message, and the choices that serve them."
            />
            <p
              style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}
              {...(finishStep === "submit" ? { role: "alert" as const } : {})}
            >
              Submitting ends T1 now and forfeits the {fmtTime(props.secondsRemaining)} left
              on the clock. You cannot come back to it.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="t1-btn" onClick={submit}>
                Yes, submit final artifact
              </button>
              <button
                type="button"
                className="t1-btn ghost"
                onClick={() => setFinishStep(null)}
              >
                Keep working
              </button>
            </div>
          </section>
        )}
      </section>

      {/* RIGHT — the live page (preview default; code behind a tab). */}
      <section className="t1-pane" style={panel} aria-label="Live page">
        <div role="tablist" aria-label="Preview or code" style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)" }}>
          <button
            type="button"
            role="tab"
            id="t1-tab-preview"
            aria-selected={tab === "preview"}
            aria-controls="t1-panel-preview"
            className="t1-tab"
            onClick={() => setTab("preview")}
          >
            Preview
          </button>
          <button
            type="button"
            role="tab"
            id="t1-tab-code"
            aria-selected={tab === "code"}
            aria-controls="t1-panel-code"
            className="t1-tab"
            onClick={() => setTab("code")}
          >
            Code
          </button>
          <span style={{ marginLeft: "auto", alignSelf: "center", color: "var(--muted)", fontSize: 11 }}>
            sandboxed · opaque origin · no network · auto re-renders as you edit
          </span>
        </div>
        {/* Both panels stay mounted (state + iframe survive tab switches);
            the inactive one is display:none. */}
        <div
          role="tabpanel"
          id="t1-panel-preview"
          aria-labelledby="t1-tab-preview"
          hidden={tab !== "preview"}
          style={{ display: tab === "preview" ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0 }}
        >
          <iframe
            title="Artifact preview"
            sandbox={SANDBOX_ATTR}
            srcDoc={preview}
            style={{ flex: 1, minHeight: 320, width: "100%", border: "1px solid var(--border)", borderRadius: 6, background: "#fff" }}
          />
        </div>
        <div
          role="tabpanel"
          id="t1-panel-code"
          aria-labelledby="t1-tab-code"
          hidden={tab !== "code"}
          style={{ display: tab === "code" ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0, gap: 8 }}
        >
          <h2 style={h2}>index.html — single self-contained file</h2>
          <textarea
            aria-label="HTML editor"
            spellCheck={false}
            style={{ ...mono, flex: 1, minHeight: 280 }}
            value={html}
            onChange={(e) => {
              setHtml(e.target.value);
              dirtySinceRun.current = true;
              checkpoint({ html: e.target.value });
            }}
          />
          <button type="button" className="t1-btn ghost" style={{ alignSelf: "flex-start" }} onClick={runPreview}>
            Run preview
          </button>
        </div>
      </section>
    </div>
  );
}
