"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { TrackUIProps } from "@ailx/core";
import { demoAssist } from "./assist.js";
import { buildPreviewSrcdoc, SANDBOX_ATTR } from "./sandbox.js";
import { decodeT1Checkpoint, encodeT1Checkpoint } from "./checkpoint.js";
import {
  buildVibeRequest,
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
import {
  cleanCallbackUrl,
  exchangeCodeForKey,
  extractCallbackCode,
  PKCE_VERIFIER_STORAGE,
} from "./sso.js";
import { t1Plugin } from "./plugin.js";
import type { PromptLogEntry } from "./types.js";

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
@media (max-width: 900px) { .t1-grid { grid-template-columns: 1fr; } }
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
  const [ssoBusy, setSsoBusy] = useState(false);
  const [model, setModel] = useState<string>(CURATED_MODELS[0]);
  const [customModel, setCustomModel] = useState("");
  const [modelOptions, setModelOptions] = useState<ReadonlyArray<string>>(CURATED_MODELS);
  const [assistBusy, setAssistBusy] = useState(false);
  const [assistError, setAssistError] = useState<string | null>(null);
  const [selfReport, setSelfReport] = useState(restored?.selfReport ?? "");
  const [rationaleOpen, setRationaleOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
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
  // for a user-scoped key, then clean the URL. Client-side only.
  useEffect(() => {
    const code = extractCallbackCode(window.location.search);
    if (!code) return;
    let verifier: string | null = null;
    try {
      verifier = window.localStorage.getItem(PKCE_VERIFIER_STORAGE);
    } catch {
      /* ignore */
    }
    if (!verifier) return;
    let cancelled = false;
    setSsoBusy(true);
    exchangeCodeForKey(fetch, code, verifier)
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
      })
      .finally(() => {
        if (cancelled) return;
        setSsoBusy(false);
        try {
          window.localStorage.removeItem(PKCE_VERIFIER_STORAGE);
        } catch {
          /* ignore */
        }
        window.history.replaceState(null, "", cleanCallbackUrl(window.location.href));
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

  const askDemo = (p: string) => {
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
      { role: "user", text: p },
      { role: "assistant", text: `${reply.title} — ${reply.note}`, code: reply.code },
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
      return;
    }
    setAssistBusy(true);
    setAssistError(null);
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
      <section
        aria-label="Build conversation"
        style={{ ...panel, maxHeight: "78vh", minHeight: 480 }}
      >
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
          <h2 style={h2}>Brief · {fmtTime(props.secondsRemaining)} left</h2>
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
                : "demo simulator — deterministic offline demo: same prompt, same answer. Every prompt is logged to your submission artifact."}
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
          <p role="alert" style={{ margin: 0, color: "var(--bad, #b91c1c)", fontSize: 12 }}>
            {assistError}
          </p>
        )}

        {/* Model row (kept compact above the input). */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
          {hasKey ? (
            <button type="button" className="t1-btn ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => updateKey("")}>
              Disconnect
            </button>
          ) : null}
        </div>
        {!realMode && (
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
            Connect a model on the run start screen to use real vibe coding here.
          </p>
        )}

        {/* Input pinned at the bottom of the pane. */}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <textarea
            aria-label="Assist prompt"
            style={{ ...mono, minHeight: 44, flex: 1 }}
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

        {/* Design rationale — compact accordion under the input. */}
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          <button
            type="button"
            className="t1-btn ghost"
            style={{ fontSize: 12, padding: "4px 10px" }}
            aria-expanded={rationaleOpen}
            onClick={() => setRationaleOpen((v) => !v)}
          >
            {rationaleOpen ? "Hide design rationale" : "Design rationale (~200 words)"}
          </button>
          <div style={{ display: rationaleOpen ? "flex" : "none", flexDirection: "column", gap: 8, marginTop: 8 }}>
            <textarea
              aria-label="Self report"
              style={{ ...mono, minHeight: 90 }}
              maxLength={cfg.selfReportMaxChars}
              value={selfReport}
              onChange={(e) => {
                setSelfReport(e.target.value);
                checkpoint({ selfReport: e.target.value });
              }}
              placeholder="State your intent: audience, message, and the choices that serve them."
            />
          </div>
          <button
            type="button"
            className="t1-btn"
            style={{ marginTop: 8, marginLeft: rationaleOpen ? 0 : 8 }}
            onClick={submit}
            disabled={submitted}
          >
            {submitted ? "Submitted" : "Submit final artifact"}
          </button>
        </div>
      </section>

      {/* RIGHT — the live page (preview default; code behind a tab). */}
      <section style={{ ...panel, maxHeight: "78vh", minHeight: 480 }} aria-label="Live page">
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
