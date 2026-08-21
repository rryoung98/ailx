"use client";
import { useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { TrackUIProps } from "@ailx/core";
import { generateImage, svgDataUrl, IMAGE_MODEL_ID } from "./imageModel.js";
import { t4Plugin } from "./plugin.js";
import type { T4Generation } from "./types.js";

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

const h2: CSSProperties = {
  margin: 0,
  fontSize: 14,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  color: "var(--muted)",
};

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/**
 * T4 Runner — iterative prompt-direction loop against a deterministic demo
 * image model (spec §T4, §13). Unlimited thinking, quota-limited renders:
 * up to cfg.maxGenerations generations, pick your best, write the note.
 */
export function Runner(props: TrackUIProps) {
  const cfg = useMemo(() => t4Plugin.validateConfig(props.config), [props.config]);
  const [prompt, setPrompt] = useState("");
  const [generations, setGenerations] = useState<T4Generation[]>([]);
  const [chosenIndex, setChosenIndex] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const genRef = useRef<T4Generation[]>([]);

  const now = () => new Date().toISOString();
  const remaining = cfg.maxGenerations - generations.length;

  const generate = () => {
    const p = prompt.trim();
    if (!p || remaining <= 0 || submitted) return;
    const svg = generateImage(p);
    const g: T4Generation = {
      index: genRef.current.length,
      prompt: p,
      svg,
      clientTs: now(),
    };
    genRef.current = [...genRef.current, g];
    setGenerations(genRef.current);
    setChosenIndex((prev) => (prev === null ? g.index : prev));
    props.onEvent({
      verb: g.index === 0 ? "prompted" : "regenerated",
      object: "t4/generation",
      result: { index: g.index, modelId: IMAGE_MODEL_ID },
      context: { prompt: p, remainingAfter: remaining - 1 },
      clientTs: g.clientTs,
    });
  };

  const submit = () => {
    if (submitted || generations.length === 0 || chosenIndex === null) return;
    setSubmitted(true);
    const artifact = {
      generations: genRef.current,
      chosenIndex,
      note: note.slice(0, cfg.noteMaxChars),
    };
    props.onEvent({
      verb: "submitted",
      object: "t4/artifact",
      result: { chosenIndex, generations: genRef.current.length },
      clientTs: now(),
    });
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
          <h2 style={h2}>Target brief · {fmtTime(props.secondsRemaining)} left</h2>
          <p style={{ margin: 0 }}>{cfg.brief}</p>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
            Audience: {cfg.audience}
          </p>
        </section>

        <section style={panel} aria-label="Prompt">
          <h2 style={h2}>
            Direct the model · demo simulator ·{" "}
            {remaining} of {cfg.maxGenerations} renders left
          </h2>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
            Deterministic offline demo — same prompt, same image. Name colors,
            objects and composition to steer it. Every render is logged.
          </p>
          <textarea
            aria-label="Image prompt"
            style={{ ...mono, minHeight: 72 }}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. three boats on a storm wave under a gold star, centered"
          />
          <button
            type="button"
            style={{ ...btn, opacity: remaining <= 0 || submitted ? 0.5 : 1 }}
            onClick={generate}
            disabled={remaining <= 0 || submitted}
          >
            {remaining > 0 ? "Generate (uses 1 render)" : "Quota exhausted"}
          </button>
        </section>

        <section style={panel} aria-label="Direction note">
          <h2 style={h2}>Direction note</h2>
          <textarea
            aria-label="Direction note"
            style={{ ...mono, minHeight: 90 }}
            maxLength={cfg.noteMaxChars}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What should the viewer understand? Which revisions were diagnostic, and why is the chosen output the right one?"
          />
          <button
            type="button"
            style={{ ...btn, opacity: submitted || chosenIndex === null ? 0.5 : 1 }}
            onClick={submit}
            disabled={submitted || chosenIndex === null}
          >
            {submitted ? "Submitted" : "Submit chosen output + note"}
          </button>
        </section>
      </div>

      <section style={{ ...panel, minWidth: 0 }} aria-label="Generations">
        <h2 style={h2}>Generations — click one to choose it</h2>
        {generations.length === 0 && (
          <p style={{ margin: 0, color: "var(--muted)" }}>
            No renders yet. Read the brief, then direct the model.
          </p>
        )}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 10,
            overflowY: "auto",
          }}
        >
          {generations.map((g) => (
            <button
              key={g.index}
              type="button"
              onClick={() => !submitted && setChosenIndex(g.index)}
              aria-pressed={chosenIndex === g.index}
              style={{
                background: "transparent",
                border:
                  chosenIndex === g.index
                    ? "2px solid var(--accent)"
                    : "1px solid var(--border)",
                borderRadius: 8,
                padding: 6,
                cursor: "pointer",
                textAlign: "left",
                color: "var(--fg)",
              }}
            >
              <img
                src={svgDataUrl(g.svg)}
                alt={`Generation ${g.index + 1}: ${g.prompt}`}
                style={{ width: "100%", display: "block", borderRadius: 4 }}
              />
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                #{g.index + 1} · {g.prompt.slice(0, 60)}
                {chosenIndex === g.index ? " · CHOSEN" : ""}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
