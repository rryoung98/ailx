"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { TrackUIProps } from "@ailx/core";
import { demoAssist } from "./assist.js";
import type { AssistReply } from "./assist.js";
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
  buildAuthUrl,
  cleanCallbackUrl,
  computeCodeChallenge,
  exchangeCodeForKey,
  extractCallbackCode,
  generateCodeVerifier,
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
    body { margin:0; background:#0b0b10; color:#e8e8ef; font-family:system-ui,sans-serif; }
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

const vars: CSSProperties = {
  ["--bg" as string]: "#0b0d12",
  ["--fg" as string]: "#e6e9f0",
  ["--muted" as string]: "#8b93a7",
  ["--accent" as string]: "#6b46f2", /* AA: 5.55:1 under white button text (was #7c5cff at 4.35:1) */
  ["--card" as string]: "#121622",
  ["--border" as string]: "#232a3d",
};

const panel: CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  minHeight: 0,
};

const mono: CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 13,
  background: "#0a0c11",
  color: "var(--fg)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: 8,
  width: "100%",
  boxSizing: "border-box",
  resize: "vertical",
};

const btn: CSSProperties = {
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "8px 14px",
  cursor: "pointer",
  fontWeight: 600,
};

const h2: CSSProperties = { margin: 0, fontSize: 14, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--muted)" };

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/**
 * T1 Runner — split-pane build environment (spec §T1, §12, §13).
 * Left: brief + demo AI assist + self report. Right: editor + sandboxed preview.
 */
export function Runner(props: TrackUIProps) {
  const cfg = useMemo(() => t1Plugin.validateConfig(props.config), [props.config]);
  // Rehydrate from the persisted checkpoint on (re)mount — F2.
  const restored = useMemo(() => decodeT1Checkpoint(props.checkpoint), []);
  const [html, setHtml] = useState(restored?.html ?? STARTER_HTML);
  const [preview, setPreview] = useState<string>(() =>
    buildPreviewSrcdoc(restored?.html ?? STARTER_HTML),
  );
  const [assistPrompt, setAssistPrompt] = useState("");
  const [assistReply, setAssistReply] = useState<AssistReply | null>(null);
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
  const [submitted, setSubmitted] = useState(false);
  const promptLog = useRef<PromptLogEntry[]>(restored?.promptLog ?? []);
  const dirtySinceRun = useRef(false);

  const now = () => new Date().toISOString();
  const effectiveModel = customModel.trim() || model;
  const hasKey = orKey.trim().length > 0;
  const effectiveBase = normalizeBaseUrl(baseUrl);
  const customBase = effectiveBase !== DEFAULT_BASE_URL;
  // Real mode: a key (pasted or via SSO), OR a custom local/self-hosted
  // endpoint (key optional for e.g. Ollama/vLLM).
  const realMode = hasKey || customBase;

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

  /** 'Connect OpenRouter' — start the PKCE round-trip. */
  const connectOpenRouter = async () => {
    if (ssoBusy) return;
    setSsoBusy(true);
    setAssistError(null);
    try {
      const verifier = generateCodeVerifier((a) => window.crypto.getRandomValues(a));
      window.localStorage.setItem(PKCE_VERIFIER_STORAGE, verifier);
      const challenge = await computeCodeChallenge(verifier, window.crypto.subtle);
      window.location.href = buildAuthUrl(cleanCallbackUrl(window.location.href), challenge);
    } catch {
      setSsoBusy(false);
      setAssistError("Could not start OpenRouter sign-in in this browser.");
    }
  };

  const updateBaseUrl = (value: string) => {
    setBaseUrl(value);
    setAssistError(null);
    try {
      if (normalizeBaseUrl(value) !== DEFAULT_BASE_URL) {
        window.localStorage.setItem(LLM_BASE_URL_STORAGE, value.trim());
      } else {
        window.localStorage.removeItem(LLM_BASE_URL_STORAGE);
      }
    } catch {
      /* non-fatal */
    }
  };

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

  const askDemo = (p: string) => {
    const reply = demoAssist(p);
    setAssistReply(reply);
    const entry: PromptLogEntry = { kind: "prompted", prompt: p, modelId: reply.modelId, clientTs: now() };
    promptLog.current = [...promptLog.current, entry];
    props.onEvent({
      verb: "prompted",
      object: "t1/assist",
      result: { modelId: reply.modelId, title: reply.title },
      context: { prompt: p },
      clientTs: entry.clientTs,
    });
    checkpoint({});
  };

  /**
   * Real vibe-coding loop (BYOK): send brief + current document + request to
   * OpenRouter, expect the COMPLETE updated document in one ```html fence,
   * apply it to the editor and refresh the sandboxed preview. The CSP
   * srcdoc wrapper is unchanged — the artifact stays a contained site.
   * Errors surface inline and never crash the runner.
   */
  const askVibe = async (p: string) => {
    setAssistBusy(true);
    setAssistError(null);
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
      setAssistReply({
        title: `Document updated by ${effectiveModel}`,
        code: "",
        note: "The full updated document was applied to the editor and preview.",
        modelId: effectiveModel,
      });
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
    <div
      style={{
        ...vars,
        background: "var(--bg)",
        color: "var(--fg)",
        minHeight: "100%",
        display: "grid",
        gridTemplateColumns: "minmax(280px, 1fr) minmax(0, 2fr)",
        gap: 12,
        padding: 12,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <section style={panel} aria-label="Brief">
          <h2 style={h2}>Brief · {fmtTime(props.secondsRemaining)} left</h2>
          <p style={{ margin: 0 }}>{cfg.brief}</p>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
            Required elements: {cfg.requiredElements.join(" · ")}
          </p>
        </section>

        <section style={panel} aria-label="AI assist">
          <h2 style={h2}>
            AI assist · {realMode ? effectiveModel : "demo simulator"}
          </h2>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
            {realMode
              ? "Real vibe coding (your key/endpoint, your browser only). The " +
                "model returns the full updated document; every prompt is " +
                "logged to your submission artefact with the model id."
              : "demo simulator — connect OpenRouter or paste a key for a real " +
                "model. Deterministic offline demo: same prompt, same answer. " +
                "Every prompt is logged to your submission artefact."}
          </p>
          {hasKey ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#4ade80" }}>
                ● Connected — key stored only in this browser
              </span>
              <button
                type="button"
                style={{ ...btn, background: "transparent", color: "var(--fg)", border: "1px solid var(--border)", padding: "4px 10px", fontSize: 12 }}
                onClick={() => updateKey("")}
              >
                Disconnect
              </button>
            </div>
          ) : (
            !customBase && (
              <button
                type="button"
                style={{ ...btn, opacity: ssoBusy ? 0.5 : 1 }}
                onClick={() => void connectOpenRouter()}
                disabled={ssoBusy}
              >
                {ssoBusy ? "Connecting…" : "Connect OpenRouter (quick SSO)"}
              </button>
            )
          )}
          <input
            aria-label="OpenRouter API key"
            type="password"
            autoComplete="off"
            style={{ ...mono, resize: "none" }}
            value={orKey}
            onChange={(e) => updateKey(e.target.value)}
            placeholder="…or paste an OpenRouter API key (stored only in this browser)"
          />
          <input
            aria-label="API base URL"
            style={{ ...mono, resize: "none" }}
            value={baseUrl}
            onChange={(e) => updateBaseUrl(e.target.value)}
            placeholder={DEFAULT_BASE_URL}
            title="Any OpenAI-compatible endpoint — e.g. http://localhost:11434/v1 for Ollama (key optional for local servers)"
          />
          <div style={{ display: "flex", gap: 8 }}>
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
          </div>
          <textarea
            aria-label="Assist prompt"
            style={{ ...mono, minHeight: 56 }}
            value={assistPrompt}
            onChange={(e) => setAssistPrompt(e.target.value)}
            placeholder={
              realMode
                ? "e.g. make the hero section bolder and add a project grid"
                : "e.g. give me a responsive project grid"
            }
          />
          <button
            type="button"
            style={{ ...btn, opacity: assistBusy ? 0.5 : 1 }}
            onClick={askAssist}
            disabled={assistBusy}
          >
            {assistBusy ? "Asking…" : "Ask (logged)"}
          </button>
          {assistError && (
            <p role="alert" style={{ margin: 0, color: "#f87171", fontSize: 12 }}>
              {assistError}
            </p>
          )}
          {assistReply && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <strong style={{ fontSize: 13 }}>{assistReply.title}</strong>
              <textarea
                aria-label="Assist code suggestion"
                readOnly
                style={{ ...mono, minHeight: 120 }}
                value={assistReply.code}
              />
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>{assistReply.note}</p>
            </div>
          )}
        </section>

        <section style={panel} aria-label="Design rationale">
          <h2 style={h2}>Design rationale (~200 words)</h2>
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
          <button type="button" style={{ ...btn, opacity: submitted ? 0.5 : 1 }} onClick={submit} disabled={submitted}>
            {submitted ? "Submitted" : "Submit final artefact"}
          </button>
        </section>
      </div>

      <div style={{ display: "grid", gridTemplateRows: "1fr 1fr", gap: 12, minWidth: 0 }}>
        <section style={panel} aria-label="Editor">
          <h2 style={h2}>index.html — single self-contained file</h2>
          <textarea
            aria-label="HTML editor"
            spellCheck={false}
            style={{ ...mono, flex: 1, minHeight: 220 }}
            value={html}
            onChange={(e) => {
              setHtml(e.target.value);
              dirtySinceRun.current = true;
              checkpoint({ html: e.target.value });
            }}
          />
          <button type="button" style={btn} onClick={runPreview}>
            Run preview
          </button>
        </section>
        <section style={panel} aria-label="Preview">
          <h2 style={h2}>Preview · sandboxed, opaque origin, no network</h2>
          <iframe
            title="Artifact preview"
            sandbox={SANDBOX_ATTR}
            srcDoc={preview}
            style={{ flex: 1, minHeight: 220, width: "100%", border: "1px solid var(--border)", borderRadius: 6, background: "#fff" }}
          />
        </section>
      </div>
    </div>
  );
}
