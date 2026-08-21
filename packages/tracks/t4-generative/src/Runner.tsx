"use client";
import { useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { TrackUIProps } from "@ailx/core";
import { generateImage, simulateVideo, svgDataUrl, IMAGE_MODEL_ID, VIDEO_MODEL_ID } from "./imageModel.js";
import { t4Plugin } from "./plugin.js";
import { decodeT4Checkpoint, encodeT4Checkpoint, type T4CheckpointState } from "./checkpoint.js";
import type { T4Draft, T4Final, T4Finals } from "./types.js";

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

const tinyBtn: CSSProperties = {
  ...btn,
  padding: "4px 8px",
  fontSize: 12,
  fontWeight: 500,
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
 * T4 Runner — spec §T4 deliverable structure: UNLIMITED drafts on the fast
 * demo model, then a hard final quota (3 final images + 1 video, the video
 * simulated as an animated SVG). Promote drafts to finals to consume quota;
 * pick the chosen set, toggle disclosure, write the note.
 */
export function Runner(props: TrackUIProps) {
  const cfg = useMemo(() => t4Plugin.validateConfig(props.config), [props.config]);
  // Rehydrate from the persisted checkpoint on (re)mount — F2.
  const restored = useMemo(() => decodeT4Checkpoint(props.checkpoint), []);
  const [prompt, setPrompt] = useState("");
  const [drafts, setDrafts] = useState<T4Draft[]>(restored?.drafts ?? []);
  const [finals, setFinals] = useState<T4Finals>(restored?.finals ?? { images: [] });
  const [chosenSet, setChosenSet] = useState<number[]>(restored?.chosenSet ?? []);
  const [note, setNote] = useState(restored?.note ?? "");
  const [disclosed, setDisclosed] = useState(restored?.disclosed ?? false);
  const [submitted, setSubmitted] = useState(false);
  const latest = useRef<T4CheckpointState>({ drafts, finals, chosenSet, note, disclosed });
  latest.current = { drafts, finals, chosenSet, note, disclosed };

  const now = () => new Date().toISOString();
  const imagesLeft = cfg.finalImageQuota - finals.images.length;
  const videoLeft = cfg.finalVideoQuota - (finals.video ? 1 : 0);

  const saveCheckpoint = (next: Partial<T4CheckpointState>) => {
    props.onCheckpoint?.(encodeT4Checkpoint({ ...latest.current, ...next }));
  };

  const generateDraft = () => {
    const p = prompt.trim();
    if (!p || submitted) return;
    const d: T4Draft = {
      index: drafts.length,
      prompt: p,
      svg: generateImage(p),
      clientTs: now(),
    };
    const nextDrafts = [...drafts, d];
    setDrafts(nextDrafts);
    props.onEvent({
      verb: d.index === 0 ? "prompted" : "regenerated",
      object: "t4/draft",
      result: { index: d.index, modelId: IMAGE_MODEL_ID },
      context: { prompt: p },
      clientTs: d.clientTs,
    });
    saveCheckpoint({ drafts: nextDrafts });
  };

  const promote = (draft: T4Draft, kind: "image" | "video") => {
    if (submitted) return;
    if (kind === "image" && imagesLeft <= 0) return;
    if (kind === "video" && videoLeft <= 0) return;
    const f: T4Final = {
      kind,
      fromDraftIndex: draft.index,
      prompt: draft.prompt,
      asset: kind === "video" ? simulateVideo(draft.svg) : draft.svg,
      clientTs: now(),
    };
    let nextFinals: T4Finals;
    let nextChosen = chosenSet;
    if (kind === "image") {
      nextFinals = { ...finals, images: [...finals.images, f] };
      nextChosen = [...chosenSet, nextFinals.images.length - 1];
      setChosenSet(nextChosen);
    } else {
      nextFinals = { ...finals, video: f };
    }
    setFinals(nextFinals);
    props.onEvent({
      verb: "promoted",
      object: `t4/final-${kind}`,
      result: {
        fromDraftIndex: draft.index,
        modelId: kind === "video" ? VIDEO_MODEL_ID : IMAGE_MODEL_ID,
        remainingAfter: kind === "image" ? imagesLeft - 1 : videoLeft - 1,
      },
      context: { prompt: draft.prompt },
      clientTs: f.clientTs,
    });
    saveCheckpoint({ finals: nextFinals, chosenSet: nextChosen });
  };

  const toggleChosen = (i: number) => {
    if (submitted) return;
    const next = chosenSet.includes(i)
      ? chosenSet.filter((x) => x !== i)
      : [...chosenSet, i];
    setChosenSet(next);
    saveCheckpoint({ chosenSet: next });
  };

  const submit = () => {
    if (submitted || finals.images.length === 0) return;
    setSubmitted(true);
    const artifact = {
      drafts,
      finals,
      chosenSet: chosenSet.length > 0 ? chosenSet : finals.images.map((_, i) => i),
      note: note.slice(0, cfg.noteMaxChars),
      disclosed,
    };
    props.onEvent({
      verb: "submitted",
      object: "t4/artifact",
      result: {
        drafts: drafts.length,
        finalImages: finals.images.length,
        finalVideo: finals.video ? 1 : 0,
        disclosed,
      },
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
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
            Deliverable: {cfg.finalImageQuota} final images + {cfg.finalVideoQuota} final
            video. Drafts are unlimited; finals are the hard quota.
          </p>
        </section>

        <section style={panel} aria-label="Prompt">
          <h2 style={h2}>Draft with the model · demo simulator · unlimited drafts</h2>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
            Deterministic offline demo — same prompt, same image. Name colors,
            objects and composition to steer it. Every draft is logged. Promote
            your best drafts to consume the final quota.
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
            style={{ ...btn, opacity: submitted ? 0.5 : 1 }}
            onClick={generateDraft}
            disabled={submitted}
          >
            Generate draft (unlimited)
          </button>
        </section>

        <section style={panel} aria-label="Direction note">
          <h2 style={h2}>Direction note</h2>
          <textarea
            aria-label="Direction note"
            style={{ ...mono, minHeight: 90 }}
            maxLength={cfg.noteMaxChars}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              saveCheckpoint({ note: e.target.value });
            }}
            placeholder="What should the viewer understand? Which revisions were diagnostic, and why is the chosen set the right one?"
          />
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={disclosed}
              onChange={(e) => {
                setDisclosed(e.target.checked);
                saveCheckpoint({ disclosed: e.target.checked });
              }}
              disabled={submitted}
            />
            Attach AI-generation disclosure statement to the delivered set
          </label>
          <button
            type="button"
            style={{ ...btn, opacity: submitted || finals.images.length === 0 ? 0.5 : 1 }}
            onClick={submit}
            disabled={submitted || finals.images.length === 0}
          >
            {submitted ? "Submitted" : "Submit final set + note"}
          </button>
        </section>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <section style={{ ...panel, minWidth: 0 }} aria-label="Finals">
          <h2 style={h2}>
            Finals · {imagesLeft} of {cfg.finalImageQuota} image renders left ·{" "}
            {videoLeft} of {cfg.finalVideoQuota} video renders left
          </h2>
          {finals.images.length === 0 && !finals.video && (
            <p style={{ margin: 0, color: "var(--muted)" }}>
              No finals yet. Promote a draft to spend quota.
            </p>
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
              gap: 10,
            }}
          >
            {finals.images.map((f, i) => (
              <button
                key={i}
                type="button"
                onClick={() => toggleChosen(i)}
                aria-pressed={chosenSet.includes(i)}
                style={{
                  background: "transparent",
                  border: chosenSet.includes(i)
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
                  src={svgDataUrl(f.asset)}
                  alt={`Final image ${i + 1}: ${f.prompt}`}
                  style={{ width: "100%", display: "block", borderRadius: 4 }}
                />
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  FINAL IMG #{i + 1}
                  {chosenSet.includes(i) ? " · IN CHOSEN SET" : ""}
                </span>
              </button>
            ))}
            {finals.video && (
              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 6,
                }}
              >
                <img
                  src={svgDataUrl(finals.video.asset)}
                  alt={`Final video (simulated): ${finals.video.prompt}`}
                  style={{ width: "100%", display: "block", borderRadius: 4 }}
                />
                <span style={{ fontSize: 12, color: "var(--muted)" }}>FINAL VIDEO · simulated</span>
              </div>
            )}
          </div>
        </section>

        <section style={{ ...panel, minWidth: 0, flex: 1 }} aria-label="Drafts">
          <h2 style={h2}>Drafts — unlimited; promote the good ones</h2>
          {drafts.length === 0 && (
            <p style={{ margin: 0, color: "var(--muted)" }}>
              No drafts yet. Read the brief, then direct the model.
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
            {drafts.map((d) => (
              <div
                key={d.index}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 6,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <img
                  src={svgDataUrl(d.svg)}
                  alt={`Draft ${d.index + 1}: ${d.prompt}`}
                  style={{ width: "100%", display: "block", borderRadius: 4 }}
                />
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  #{d.index + 1} · {d.prompt.slice(0, 48)}
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    style={{ ...tinyBtn, opacity: imagesLeft <= 0 || submitted ? 0.4 : 1 }}
                    onClick={() => promote(d, "image")}
                    disabled={imagesLeft <= 0 || submitted}
                  >
                    → Final image
                  </button>
                  <button
                    type="button"
                    style={{ ...tinyBtn, opacity: videoLeft <= 0 || submitted ? 0.4 : 1 }}
                    onClick={() => promote(d, "video")}
                    disabled={videoLeft <= 0 || submitted}
                  >
                    → Final video
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
