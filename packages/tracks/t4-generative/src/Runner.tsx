"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { TrackUIProps } from "@ailx/core";
import {
  generateImage,
  simulateVideo,
  simulateVideoFromImage,
  draftImageSrc,
  finalImageSrc,
  IMAGE_MODEL_ID,
  VIDEO_MODEL_ID,
} from "./imageModel.js";
import {
  OPENROUTER_KEY_STORAGE,
  LLM_BASE_URL_STORAGE,
  CURATED_IMAGE_MODELS,
  buildImageRequest,
  requestImage,
  draftNeedsRecompress,
  chooseDraftAsset,
  DRAFT_MAX_BYTES,
  ImageGenError,
} from "./imagegen.js";
import { recompressDataUri } from "./recompress.js";
import { t4Plugin } from "./plugin.js";
import { decodeT4Checkpoint, encodeT4Checkpoint, type T4CheckpointState } from "./checkpoint.js";
import type { T4Draft, T4Final, T4Finals } from "./types.js";


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
  background: "var(--bg, #faf8f6)",
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

/** Self-contained chat styling (paper palette; standardized button motion:
 *  background/color/border 150ms, transform 120ms; hover fills accent). */
const T4_CSS = `
.t4-shell .t4-btn {
  background: var(--accent, #0b6b47); color: #fff; border: 1px solid var(--accent, #0b6b47);
  border-radius: 7px; padding: 8px 14px; cursor: pointer; font: inherit; font-weight: 600;
  transition: background 150ms ease, color 150ms ease, border-color 150ms ease, transform 120ms ease;
}
.t4-shell .t4-btn:hover:not(:disabled) { background: #0e895a; border-color: #0e895a; transform: translateY(-1px); }
.t4-shell .t4-btn:active:not(:disabled) { transform: translateY(0) scale(0.98); }
.t4-shell .t4-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.t4-shell .t4-btn:focus-visible { outline: 2px solid var(--accent, #0b6b47); outline-offset: 2px; }
.t4-shell .t4-btn.ghost { background: var(--card, #fff); color: var(--fg, #1a1a1a); border: 1px solid var(--border-strong, #c9c2b9); }
.t4-shell .t4-btn.ghost:hover:not(:disabled) { background: var(--accent, #0b6b47); color: #fff; border-color: var(--accent, #0b6b47); }
.t4-grid { display: grid; grid-template-columns: minmax(300px, 5fr) minmax(0, 7fr); gap: 12px; padding: 12px; }
.t4-grid > div { min-width: 0; }
/* Pane height caps live in CSS (not inline) so the phone layout can lift
   them: a capped pane with visible overflow lets buttons escape their card
   (same bug class as the T1 submit-button escape). */
.t4-pane {
  max-height: 78vh; min-height: 480px;
  /* Capped panes must scroll internally — visible overflow let the controls
     spill over the card edge onto the footer (user screenshot, mid-width). */
  overflow-y: auto;
}
@media (max-width: 900px) {
  .t4-grid { grid-template-columns: 1fr; }
  .t4-pane { max-height: none; min-height: 0; }
  /* >= 16px stops iOS Safari zoom-jump on focus (inline styles use 13px). */
  .t4-shell textarea, .t4-shell input, .t4-shell select { font-size: 16px !important; }
  /* Phone: the model select/override stack to full-width lines. */
  .t4-shell .t4-row-model > select,
  .t4-shell .t4-row-model > input { flex-basis: 100% !important; }
}
/* Prompt row wraps at EVERY width, unlike T1: the t4-grid is capped at
   960px, so this pane never exceeds ~380px of content and the wide
   "Generate draft (unlimited)" button crushed the prompt to ~99-120px on
   any desktop (38px on phones). Full-width prompt, button below. */
.t4-shell .t4-row-prompt { flex-wrap: wrap; }
.t4-shell .t4-row-prompt > textarea { flex-basis: 100% !important; }
/* Resizable textareas are clamped so the drag handle can never pull them
   past the card (user report: the prompt box dragged over the Direction
   note); touch devices get no drag handle at all. */
.t4-shell textarea { max-height: 60vh; }
@media (pointer: coarse) {
  .t4-shell .t4-btn { min-height: 44px; }
  .t4-shell textarea { resize: none !important; }
}
`;

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
  const [submitted, setSubmitted] = useState(restored?.submitted ?? false);
  // BYOK OpenRouter image generation — SAME key slot as T1's assist panel;
  // the key lives only in the candidate's browser.
  const [orKey, setOrKey] = useState("");
  const [baseUrl, setBaseUrl] = useState<string | undefined>(undefined);
  const [model, setModel] = useState<string>(CURATED_IMAGE_MODELS[0]);
  const [customModel, setCustomModel] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  // Full-resolution originals per draft index (session only, never stored
  // in checkpoints — drafts persist a ≤200KB copy; finals promote these).
  const fullRes = useRef<Map<number, string>>(new Map());
  const completed = useRef(false);
  const latest = useRef<T4CheckpointState>({ drafts, finals, chosenSet, note, disclosed, submitted });
  latest.current = { drafts, finals, chosenSet, note, disclosed, submitted };
  const galleryHeadingRef = useRef<HTMLHeadingElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Keep the newest generation in view in the chat column.
  useEffect(() => {
    chatEndRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [drafts.length, genBusy]);

  // A11y: submit replaces the workspace with the finals gallery — move
  // focus to its heading so keyboard/AT users land on the outcome.
  useEffect(() => {
    if (submitted) galleryHeadingRef.current?.focus();
  }, [submitted]);

  // Load the shared BYOK key/base on mount (browser only — SSR safe).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(OPENROUTER_KEY_STORAGE);
      if (stored) setOrKey(stored);
      const storedBase = window.localStorage.getItem(LLM_BASE_URL_STORAGE);
      if (storedBase) setBaseUrl(storedBase);
    } catch {
      /* storage unavailable (private mode etc.) — demo mode stays on */
    }
  }, []);

  const updateKey = (value: string) => {
    setOrKey(value);
    setGenError(null);
    try {
      // Same slot T1 writes — connecting here connects the whole exam.
      if (value.trim().length > 0) {
        window.localStorage.setItem(OPENROUTER_KEY_STORAGE, value.trim());
      } else {
        window.localStorage.removeItem(OPENROUTER_KEY_STORAGE);
      }
    } catch {
      /* non-fatal */
    }
  };

  const hasKey = orKey.trim().length > 0;
  const effectiveModel = customModel.trim() || model;

  const now = () => new Date().toISOString();
  const imagesLeft = cfg.finalImageQuota - finals.images.length;
  const videoLeft = cfg.finalVideoQuota - (finals.video ? 1 : 0);

  const saveCheckpoint = (next: Partial<T4CheckpointState>) => {
    props.onCheckpoint?.(encodeT4Checkpoint({ ...latest.current, ...next }));
  };

  /** Append a draft, log the generation with the ACTUAL model id, save. */
  const commitDraft = (d: T4Draft) => {
    const nextDrafts = [...latest.current.drafts, d];
    setDrafts(nextDrafts);
    props.onEvent({
      verb: d.index === 0 ? "prompted" : "regenerated",
      object: "t4/draft",
      result: { index: d.index, modelId: d.modelId ?? IMAGE_MODEL_ID },
      context: { prompt: d.prompt },
      clientTs: d.clientTs,
    });
    saveCheckpoint({ drafts: nextDrafts });
  };

  const generateDraft = async () => {
    const p = prompt.trim();
    if (!p || submitted || genBusy) return;
    if (!hasKey) {
      // No key → deterministic offline demo, labeled as such. Repeating the
      // same prompt gets a fresh VARIATION (like a real model's sampling):
      // the nonce is how many drafts already used this exact prompt.
      const priorSamePrompt = latest.current.drafts.filter(
        (d) => d.prompt.trim().toLowerCase() === p.toLowerCase(),
      ).length;
      commitDraft({
        index: latest.current.drafts.length,
        prompt: p,
        svg: generateImage(p, priorSamePrompt),
        modelId: IMAGE_MODEL_ID,
        clientTs: now(),
      });
      return;
    }
    // Real OpenRouter image generation — cohort budget cap: ≤12 real images
    // per run keeps a funded 45-person cohort under ~$0.15/run (docs/BUDGET.md).
    const REAL_DRAFT_CAP = 12;
    const realDrafts = latest.current.drafts.filter((d) => d.dataUri).length;
    if (realDrafts >= REAL_DRAFT_CAP) {
      setGenError(`Run budget reached (${REAL_DRAFT_CAP} real generations) — promote your best drafts or refine with the demo model.`);
      return;
    }
    setGenBusy(true);
    setGenError(null);
    try {
      const { dataUri, modelId } = await requestImage(
        fetch,
        orKey.trim(),
        buildImageRequest(p, effectiveModel),
        baseUrl,
      );
      // Drafts persist a downscaled ≤200KB copy; the full-res original is
      // kept in memory for final promotion. If recompression fails we keep
      // the original — never lose the image over a size optimization.
      let stored = dataUri;
      if (draftNeedsRecompress(dataUri)) {
        const rec = await recompressDataUri(dataUri, DRAFT_MAX_BYTES);
        stored = chooseDraftAsset(dataUri, rec);
      }
      const index = latest.current.drafts.length;
      fullRes.current.set(index, dataUri);
      commitDraft({ index, prompt: p, dataUri: stored, modelId, clientTs: now() });
    } catch (e) {
      setGenError(
        e instanceof ImageGenError ? e.message : "Image generation failed.",
      );
    } finally {
      setGenBusy(false);
    }
  };

  const promote = (draft: T4Draft, kind: "image" | "video") => {
    if (submitted) return;
    if (kind === "image" && imagesLeft <= 0) return;
    if (kind === "video" && videoLeft <= 0) return;
    // Finals promote the FULL-RESOLUTION real image when we still hold it
    // (drafts persist a recompressed copy); demo drafts promote their SVG.
    const real = draft.dataUri !== undefined;
    const fullImage = real
      ? fullRes.current.get(draft.index) ?? draft.dataUri ?? ""
      : "";
    const f: T4Final = {
      kind,
      fromDraftIndex: draft.index,
      prompt: draft.prompt,
      ...(real
        ? kind === "video"
          ? { asset: simulateVideoFromImage(fullImage) }
          : { dataUri: fullImage }
        : { asset: kind === "video" ? simulateVideo(draft.svg ?? "") : draft.svg ?? "" }),
      modelId:
        kind === "video"
          ? real
            ? `${VIDEO_MODEL_ID} (from ${draft.modelId ?? IMAGE_MODEL_ID})`
            : VIDEO_MODEL_ID
          : draft.modelId ?? IMAGE_MODEL_ID,
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
        modelId: f.modelId,
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

  /** The exact artifact shape submit() has always produced — unchanged. */
  const buildArtifact = () => {
    const s = latest.current;
    return {
      drafts: s.drafts,
      finals: s.finals,
      chosenSet: s.chosenSet.length > 0 ? s.chosenSet : s.finals.images.map((_, i) => i),
      note: s.note.slice(0, cfg.noteMaxChars),
      disclosed: s.disclosed,
    };
  };

  // Submit opens the finals GALLERY first (presentation over already-
  // captured data); onComplete fires when the candidate delivers. On
  // timeout the exam rebuilds the identical artifact from the checkpoint.
  const submit = () => {
    if (submitted || finals.images.length === 0) return;
    setSubmitted(true);
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
    saveCheckpoint({ submitted: true });
  };

  /** Gallery → exam. Called exactly once, from the gallery's deliver button. */
  const deliver = () => {
    if (completed.current) return;
    completed.current = true;
    props.onComplete(buildArtifact());
  };

  if (submitted) {
    const chosen =
      chosenSet.length > 0 ? chosenSet : finals.images.map((_, i) => i);
    const chosenImages = chosen
      .filter((i) => i >= 0 && i < finals.images.length)
      .map((i) => ({ f: finals.images[i], i }));
    return (
      <div
        style={{
          background: "var(--bg)",
          color: "var(--fg)",
          minHeight: "100%",
          padding: 16,
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          maxWidth: 960,
          margin: "0 auto",
        }}
      >
        <section style={panel} aria-label="Final set">
          <h2 ref={galleryHeadingRef} tabIndex={-1} style={{ ...h2, outline: "none" }}>
            Final set · delivered to {cfg.audience}
          </h2>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: 0.5,
                borderRadius: 999,
                padding: "4px 10px",
                border: disclosed ? `1px solid var(--good, #15803d)` : "1px solid var(--border)",
                color: disclosed ? "var(--good, #15803d)" : "var(--muted)",
              }}
            >
              {disclosed ? "AI-GENERATED · DISCLOSED" : "NO DISCLOSURE ATTACHED"}
            </span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {chosenImages.length} chosen image{chosenImages.length === 1 ? "" : "s"}
              {finals.video ? " + 1 video (simulated)" : ""} · {drafts.length} draft
              {drafts.length === 1 ? "" : "s"} behind them
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 12,
            }}
          >
            {chosenImages.map(({ f, i }) => (
              <figure key={i} style={{ margin: 0 }}>
                <img
                  src={finalImageSrc(f)}
                  alt={`Chosen final image ${i + 1}: ${f.prompt}`}
                  style={{ width: "100%", display: "block", borderRadius: 8, border: "2px solid var(--accent)" }}
                />
                <figcaption style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  CHOSEN FINAL #{i + 1} · {f.prompt.slice(0, 60)}
                </figcaption>
              </figure>
            ))}
            {finals.video && (
              <figure style={{ margin: 0 }}>
                <img
                  src={finalImageSrc(finals.video)}
                  alt={`Final video (simulated): ${finals.video.prompt}`}
                  style={{ width: "100%", display: "block", borderRadius: 8, border: "2px solid var(--border)" }}
                />
                <figcaption style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  FINAL VIDEO · simulated · {finals.video.prompt.slice(0, 60)}
                </figcaption>
              </figure>
            )}
          </div>
        </section>

        {note.trim() !== "" && (
          <section style={{ ...panel, borderLeft: "3px solid var(--accent)" }} aria-label="Direction note caption">
            <h2 style={h2}>Direction note</h2>
            <p style={{ margin: 0, whiteSpace: "pre-wrap", fontStyle: "italic" }}>
              {note.slice(0, cfg.noteMaxChars)}
            </p>
          </section>
        )}

        <section style={panel} aria-label="Draft filmstrip">
          <h2 style={h2}>Drafts — the road to the final set</h2>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
            {drafts.map((d) => (
              <img
                key={d.index}
                src={draftImageSrc(d)}
                alt={`Draft ${d.index + 1}: ${d.prompt}`}
                title={d.prompt}
                style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)", flex: "0 0 auto" }}
              />
            ))}
            {drafts.length === 0 && (
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>No drafts recorded.</p>
            )}
          </div>
        </section>

        <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
          This gallery is presentation only — the stored artifact and events are
          already final and are what scoring sees.
        </p>
        <button type="button" style={{ ...btn, alignSelf: "flex-start" }} onClick={deliver}>
          Deliver final set →
        </button>
      </div>
    );
  }

  return (
    <div
      className="t4-shell t4-grid"
      style={{ background: "var(--bg)", color: "var(--fg)", minHeight: "100%", fontFamily: "system-ui, sans-serif" }}
    >
      <style>{T4_CSS}</style>

      {/* LEFT — the conversation pane: brief pinned on top, then the
          prompt/generation history as chat bubbles, input at the bottom
          (same chat language as T1; ai-sdk-chatbot-style layout, no dep). */}
      <div className="t4-pane" style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <section style={{ ...panel, flex: 1, minHeight: 0 }} aria-label="Prompt">
          <div
            role="note"
            aria-label="Brief"
            style={{
              background: "var(--bg, #f7f4f2)",
              border: "1px solid var(--border)",
              borderLeft: "3px solid var(--accent, #0b6b47)",
              borderRadius: 8,
              padding: "8px 10px",
            }}
          >
            <h2 style={h2}>Target brief · {fmtTime(props.secondsRemaining)} left</h2>
            <p style={{ margin: "4px 0 0", fontSize: 14 }}>{cfg.brief}</p>
            <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 12 }}>
              Audience: {cfg.audience} · Deliverable: {cfg.finalImageQuota} final images +{" "}
              {cfg.finalVideoQuota} final video. Drafts are unlimited; finals are the hard quota.
            </p>
          </div>

          {/* Chat transcript — every draft is a prompt bubble + an image reply. */}
          <div
            role="log"
            aria-label="Generation conversation"
            style={{ flex: 1, minHeight: 160, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, padding: "4px 0" }}
          >
            {drafts.length === 0 && (
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                {hasKey
                  ? "Real image generation (your OpenRouter key, your browser only). Every draft is logged with the model id; finals keep the full-resolution image."
                  : "demo simulator — deterministic offline demo: same prompt, same image. Name colors, objects and composition to steer it. Every draft is logged. Connect a model on the run start screen to generate real images here."}
              </p>
            )}
            {drafts.map((d) => (
              <div key={d.index} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div
                  style={{
                    alignSelf: "flex-end",
                    maxWidth: "88%",
                    background: "var(--accent-dim, #bcd9cc)",
                    border: "1px solid var(--border)",
                    borderRadius: "12px 12px 4px 12px",
                    padding: "8px 10px",
                    fontSize: 13.5,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>you</span>
                  {d.prompt}
                </div>
                <div
                  style={{
                    alignSelf: "flex-start",
                    maxWidth: "88%",
                    background: "var(--card, #fff)",
                    border: "1px solid var(--border)",
                    borderRadius: "12px 12px 12px 4px",
                    padding: "8px 10px",
                  }}
                >
                  <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
                    {d.modelId ?? IMAGE_MODEL_ID} · draft #{d.index + 1}
                  </span>
                  <img
                    src={draftImageSrc(d)}
                    alt={`Draft ${d.index + 1}: ${d.prompt}`}
                    style={{ maxWidth: "100%", width: 220, display: "block", borderRadius: 6, border: "1px solid var(--border)" }}
                  />
                </div>
              </div>
            ))}
            {genBusy && (
              <div style={{ alignSelf: "flex-start", color: "var(--muted)", fontSize: 13 }}>Generating…</div>
            )}
            <div ref={chatEndRef} />
          </div>

          {genError && (
            <p role="alert" style={{ margin: 0, color: "var(--bad, #b91c1c)", fontSize: 13 }}>
              {genError}
            </p>
          )}

          {hasKey ? (
            <div className="t4-row-model" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <select
                aria-label="Image model"
                style={{ ...mono, resize: "none", flex: 1, minWidth: 0 }}
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {CURATED_IMAGE_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                aria-label="Custom image model override"
                style={{ ...mono, resize: "none", flex: 1, minWidth: 0 }}
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="custom model id (optional)"
              />
              <button
                type="button"
                className="t4-btn ghost"
                style={{ padding: "4px 10px", fontSize: 12 }}
                onClick={() => updateKey("")}
              >
                Disconnect
              </button>
            </div>
          ) : null}

          {/* Input pinned at the bottom: drafting is the conversation.
              Phone layout: the CSS 900px block wraps the wide Generate
              button below a full-width prompt (it was crushed to a 38px
              sliver at a 390px viewport, user report). */}
          <div className="t4-row-prompt" style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <textarea
              aria-label="Image prompt"
              style={{ ...mono, minHeight: 44, flex: 1, minWidth: 0 }}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void generateDraft();
                }
              }}
              placeholder="e.g. three boats on a storm wave under a gold star, centered"
            />
            <button
              type="button"
              className="t4-btn"
              onClick={() => void generateDraft()}
              disabled={submitted || genBusy}
            >
              {genBusy ? "Generating…" : "Generate draft (unlimited)"}
            </button>
          </div>
        </section>

        <section style={panel} aria-label="Direction note">
          <h2 style={h2}>Direction note</h2>
          <textarea
            aria-label="Direction note"
            style={{ ...mono, minHeight: 60 }}
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
            className="t4-btn"
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
                  src={finalImageSrc(f)}
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
                  src={finalImageSrc(finals.video)}
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
            {/* Newest first — a fresh generation always appears at the top
                of the gallery, never below the fold. */}
            {[...drafts].reverse().map((d) => (
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
                  src={draftImageSrc(d)}
                  alt={`Draft ${d.index + 1}: ${d.prompt}`}
                  style={{ width: "100%", display: "block", borderRadius: 4 }}
                />
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  #{d.index + 1}{d.index === drafts.length - 1 ? " · latest" : ""} · {d.prompt.slice(0, 48)}
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    className="t4-btn"
                    style={{ padding: "4px 8px", fontSize: 12, fontWeight: 500 }}
                    onClick={() => promote(d, "image")}
                    disabled={imagesLeft <= 0 || submitted}
                  >
                    → Final image
                  </button>
                  <button
                    type="button"
                    className="t4-btn"
                    style={{ padding: "4px 8px", fontSize: 12, fontWeight: 500 }}
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
