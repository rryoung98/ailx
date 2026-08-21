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
      // No key → deterministic offline demo, labeled as such.
      commitDraft({
        index: latest.current.drafts.length,
        prompt: p,
        svg: generateImage(p),
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
          ...vars,
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
                border: disclosed ? "1px solid #4ade80" : "1px solid var(--border)",
                color: disclosed ? "#4ade80" : "var(--muted)",
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
          <h2 style={h2}>
            Draft with the model · {hasKey ? effectiveModel : "demo simulator"} ·
            unlimited drafts
          </h2>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
            {hasKey
              ? "Real image generation (your OpenRouter key, your browser " +
                "only). Every draft is logged with the model id; finals keep " +
                "the full-resolution image."
              : "Deterministic offline demo — same prompt, same image. Name " +
                "colors, objects and composition to steer it. Every draft is " +
                "logged. Paste an OpenRouter key for a real image model."}
          </p>
          {hasKey ? (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "#4ade80" }}>
                  ● Connected — key stored only in this browser (shared with T1)
                </span>
                <button
                  type="button"
                  style={{ ...btn, background: "transparent", color: "var(--fg)", border: "1px solid var(--border)", padding: "4px 10px", fontSize: 12 }}
                  onClick={() => updateKey("")}
                >
                  Disconnect
                </button>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
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
              </div>
            </>
          ) : (
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
              Connect a model on the run start screen to generate real images here.
            </p>
          )}
          <textarea
            aria-label="Image prompt"
            style={{ ...mono, minHeight: 72 }}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. three boats on a storm wave under a gold star, centered"
          />
          {genError && (
            <p role="alert" style={{ margin: 0, color: "#f87171", fontSize: 13 }}>
              {genError}
            </p>
          )}
          <button
            type="button"
            style={{ ...btn, opacity: submitted || genBusy ? 0.5 : 1 }}
            onClick={() => void generateDraft()}
            disabled={submitted || genBusy}
          >
            {genBusy ? "Generating…" : "Generate draft (unlimited)"}
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
                  src={draftImageSrc(d)}
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
