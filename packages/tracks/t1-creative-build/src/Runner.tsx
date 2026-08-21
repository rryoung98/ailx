"use client";
import { useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { TrackUIProps } from "@ailx/core";
import { demoAssist } from "./assist.js";
import type { AssistReply } from "./assist.js";
import { buildPreviewSrcdoc, SANDBOX_ATTR } from "./sandbox.js";
import { decodeT1Checkpoint, encodeT1Checkpoint } from "./checkpoint.js";
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
  ["--accent" as string]: "#7c5cff",
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
  const [selfReport, setSelfReport] = useState(restored?.selfReport ?? "");
  const [submitted, setSubmitted] = useState(false);
  const promptLog = useRef<PromptLogEntry[]>(restored?.promptLog ?? []);
  const dirtySinceRun = useRef(false);

  const now = () => new Date().toISOString();

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

  const askAssist = () => {
    const p = assistPrompt.trim();
    if (!p) return;
    const reply = demoAssist(p);
    setAssistReply(reply);
    const entry: PromptLogEntry = { kind: "prompted", prompt: p, clientTs: now() };
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

        <section style={panel} aria-label="AI assist (demo)">
          <h2 style={h2}>AI assist · demo simulator</h2>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
            Deterministic offline demo — same prompt, same answer. Every prompt
            is logged to your submission artefact.
          </p>
          <textarea
            aria-label="Assist prompt"
            style={{ ...mono, minHeight: 56 }}
            value={assistPrompt}
            onChange={(e) => setAssistPrompt(e.target.value)}
            placeholder="e.g. give me a responsive project grid"
          />
          <button type="button" style={btn} onClick={askAssist}>
            Ask (logged)
          </button>
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
