import { sha256Bytes } from "./sha256.js";

/**
 * DEMO image model — deterministic simulator, clearly labeled.
 *
 * The static showcase makes no network calls, so where the spec names
 * Gemini image models we substitute a pure function: an SVG scene derived
 * from sha256(prompt) plus keywords extracted from a small vocabulary.
 * Better-specified prompts visibly steer the output — named colors set the
 * palette, named objects appear, composition words move the layout — so the
 * iteration loop the track measures is genuinely exercised.
 */

export const IMAGE_MODEL_ID = "demo-image@1";

export const COLOR_VOCAB: Record<string, string> = {
  red: "#d94141",
  crimson: "#b91c3c",
  orange: "#e8853a",
  gold: "#d9a441",
  yellow: "#e0c341",
  green: "#4caf6e",
  teal: "#2ba39b",
  blue: "#4179d9",
  navy: "#22335e",
  purple: "#7c5cff",
  violet: "#8e55c9",
  pink: "#e05297",
  white: "#f0f0f5",
  black: "#101014",
  grey: "#8b93a7",
  gray: "#8b93a7",
};

export const OBJECT_VOCAB = [
  "sun",
  "moon",
  "mountain",
  "tree",
  "river",
  "city",
  "tower",
  "bridge",
  "bird",
  "boat",
  "wave",
  "star",
] as const;
export type SceneObject = (typeof OBJECT_VOCAB)[number];

export const COMPOSITION_VOCAB = ["centered", "left", "right", "minimal", "dense"] as const;
export type Composition = (typeof COMPOSITION_VOCAB)[number];

export const MOOD_VOCAB = ["calm", "storm", "night", "dawn"] as const;
export type Mood = (typeof MOOD_VOCAB)[number];

export interface PromptReading {
  colors: string[];
  objects: SceneObject[];
  composition: Composition | null;
  mood: Mood | null;
}

/** Extract steering keywords from the prompt (small public vocabulary). */
export function readPrompt(prompt: string): PromptReading {
  const words = prompt
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
    // naive singularization so "boats" steers like "boat"
    .flatMap((w) => (w.endsWith("s") ? [w, w.slice(0, -1)] : [w]));
  const has = (w: string) => words.includes(w);
  return {
    colors: Object.keys(COLOR_VOCAB).filter(has).map((k) => COLOR_VOCAB[k]),
    objects: OBJECT_VOCAB.filter(has),
    composition: COMPOSITION_VOCAB.find(has) ?? null,
    mood: MOOD_VOCAB.find(has) ?? null,
  };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const W = 320;
const H = 200;

function drawObject(kind: SceneObject, cx: number, cy: number, r: number, fill: string): string {
  switch (kind) {
    case "sun":
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
    case "moon":
      return `<path d="M ${cx} ${cy - r} a ${r} ${r} 0 1 0 0 ${2 * r} a ${r * 0.78} ${r * 0.78} 0 1 1 0 -${2 * r}" fill="${fill}"/>`;
    case "mountain":
      return `<polygon points="${cx - r * 1.4},${cy + r} ${cx},${cy - r} ${cx + r * 1.4},${cy + r}" fill="${fill}"/>`;
    case "tree":
      return `<rect x="${cx - r * 0.12}" y="${cy}" width="${r * 0.24}" height="${r}" fill="#6b4a2f"/><polygon points="${cx - r * 0.7},${cy + r * 0.2} ${cx},${cy - r} ${cx + r * 0.7},${cy + r * 0.2}" fill="${fill}"/>`;
    case "river":
      return `<path d="M ${cx - r * 1.6} ${cy} q ${r * 0.8} ${-r * 0.5} ${r * 1.6} 0 t ${r * 1.6} 0" stroke="${fill}" stroke-width="${Math.max(3, r * 0.25)}" fill="none"/>`;
    case "city":
      return (
        `<rect x="${cx - r}" y="${cy - r * 0.6}" width="${r * 0.5}" height="${r * 1.6}" fill="${fill}"/>` +
        `<rect x="${cx - r * 0.35}" y="${cy - r}" width="${r * 0.5}" height="${r * 2}" fill="${fill}"/>` +
        `<rect x="${cx + r * 0.3}" y="${cy - r * 0.4}" width="${r * 0.5}" height="${r * 1.4}" fill="${fill}"/>`
      );
    case "tower":
      return `<rect x="${cx - r * 0.2}" y="${cy - r}" width="${r * 0.4}" height="${r * 2}" fill="${fill}"/><polygon points="${cx - r * 0.3},${cy - r} ${cx},${cy - r * 1.5} ${cx + r * 0.3},${cy - r}" fill="${fill}"/>`;
    case "bridge":
      return `<path d="M ${cx - r * 1.4} ${cy} q ${r * 1.4} ${-r * 1.2} ${r * 2.8} 0" stroke="${fill}" stroke-width="${Math.max(3, r * 0.2)}" fill="none"/><line x1="${cx - r * 1.4}" y1="${cy}" x2="${cx + r * 1.4}" y2="${cy}" stroke="${fill}" stroke-width="${Math.max(2, r * 0.12)}"/>`;
    case "bird":
      return `<path d="M ${cx - r * 0.8} ${cy} q ${r * 0.4} ${-r * 0.6} ${r * 0.8} 0 q ${r * 0.4} ${-r * 0.6} ${r * 0.8} 0" stroke="${fill}" stroke-width="${Math.max(2, r * 0.15)}" fill="none"/>`;
    case "boat":
      return `<polygon points="${cx - r},${cy} ${cx + r},${cy} ${cx + r * 0.6},${cy + r * 0.5}, ${cx - r * 0.6},${cy + r * 0.5}" fill="${fill}"/><line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - r}" stroke="${fill}" stroke-width="3"/>`;
    case "wave":
      return `<path d="M ${cx - r * 1.5} ${cy} q ${r * 0.375} ${-r * 0.6} ${r * 0.75} 0 t ${r * 0.75} 0 t ${r * 0.75} 0 t ${r * 0.75} 0" stroke="${fill}" stroke-width="${Math.max(3, r * 0.2)}" fill="none"/>`;
    case "star":
      return `<polygon points="${cx},${cy - r} ${cx + r * 0.29},${cy - r * 0.31} ${cx + r * 0.95},${cy - r * 0.31} ${cx + r * 0.42},${cy + r * 0.12} ${cx + r * 0.59},${cy + r * 0.81} ${cx},${cy + r * 0.38} ${cx - r * 0.59},${cy + r * 0.81} ${cx - r * 0.42},${cy + r * 0.12} ${cx - r * 0.95},${cy - r * 0.31} ${cx - r * 0.29},${cy - r * 0.31}" fill="${fill}"/>`;
  }
}

const MOOD_SKY: Record<Mood, [string, string]> = {
  calm: ["#294a6b", "#0f1c2e"],
  storm: ["#3a3f4d", "#14161d"],
  night: ["#101228", "#05060f"],
  dawn: ["#6b3a52", "#1b1030"],
};

/**
 * Deterministic render: sha256(prompt) drives layout jitter and fallback
 * choices; extracted keywords steer palette, objects and composition.
 */
export function generateImage(prompt: string): string {
  const norm = prompt.trim().toLowerCase();
  const seed = sha256Bytes("t4-image:" + norm);
  const read = readPrompt(prompt);

  const [skyTop, skyBottom] =
    read.mood !== null
      ? MOOD_SKY[read.mood]
      : MOOD_SKY[(["calm", "storm", "night", "dawn"] as const)[seed[2] % 4]];

  const palette =
    read.colors.length > 0
      ? read.colors
      : [Object.values(COLOR_VOCAB)[seed[3] % 16]];

  const objects: SceneObject[] =
    read.objects.length > 0
      ? read.objects.slice(0, 5)
      : [OBJECT_VOCAB[seed[4] % OBJECT_VOCAB.length]];

  const comp: Composition =
    read.composition ?? (["centered", "left", "right"] as const)[seed[5] % 3];

  const baseX = comp === "left" ? W * 0.28 : comp === "right" ? W * 0.72 : W / 2;
  const spread = comp === "dense" ? W * 0.16 : W * 0.26;
  const count = comp === "minimal" ? Math.min(1, objects.length) || 1 : objects.length;

  let shapes = "";
  for (let i = 0; i < count; i++) {
    const kind = objects[i % objects.length];
    const b = seed[6 + i * 3];
    const cx = Math.round(
      Math.min(W - 24, Math.max(24, baseX + ((b / 255) * 2 - 1) * spread + (i - (count - 1) / 2) * (spread * 0.9))),
    );
    const skyObject = kind === "sun" || kind === "moon" || kind === "star" || kind === "bird";
    const cy = Math.round(skyObject ? 34 + (seed[7 + i * 3] / 255) * 50 : 118 + (seed[7 + i * 3] / 255) * 40);
    const r = Math.round(16 + (seed[8 + i * 3] / 255) * 18);
    const fill = palette[i % palette.length];
    shapes += drawObject(kind, cx, cy, r, fill);
  }

  const ground = read.mood === "storm" ? "#1c2027" : "#16202b";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(prompt).slice(0, 120)}">` +
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${skyTop}"/><stop offset="1" stop-color="${skyBottom}"/>` +
    `</linearGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#sky)"/>` +
    `<rect y="${H * 0.78}" width="${W}" height="${H * 0.22}" fill="${ground}"/>` +
    shapes +
    `<title>${esc(prompt)}</title>` +
    `</svg>`
  );
}

/** SVG -> data URL for <img src>, keeping the parent DOM free of raw markup. */
export function svgDataUrl(svg: string): string {
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

export const VIDEO_MODEL_ID = "demo-video@1";

const VIDEO_OVERLAY =
  `<g><rect x="8" y="8" rx="4" width="132" height="24" fill="#000" opacity="0.55">` +
  `<animate attributeName="opacity" values="0.55;0.25;0.55" dur="2s" repeatCount="indefinite"/>` +
  `</rect>` +
  `<text x="16" y="25" font-family="system-ui,sans-serif" font-size="14" fill="#fff">▶ VIDEO · simulated</text>` +
  `<animateTransform attributeName="transform" type="translate" values="0 0; 4 0; 0 0" dur="6s" repeatCount="indefinite"/>` +
  `</g>`;

/**
 * DEMO video model — simulates the one-video final quota (spec §T4) as an
 * ANIMATED SVG derived from a draft render: a drifting pan plus a clearly
 * labeled "VIDEO · simulated" badge. Deterministic: same draft SVG in, same
 * animated markup out.
 */
export function simulateVideo(draftSvg: string): string {
  if (draftSvg.endsWith("</svg>")) {
    return draftSvg.slice(0, -"</svg>".length) + VIDEO_OVERLAY + "</svg>";
  }
  return draftSvg + VIDEO_OVERLAY;
}

/**
 * Simulated-video wrapper for a REAL model image: embed the raster data
 * URI in an SVG and add the same labeled animated overlay. Pure.
 */
export function simulateVideoFromImage(dataUri: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">` +
    `<image href="${dataUri}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>` +
    VIDEO_OVERLAY +
    `</svg>`
  );
}

/** Displayable src for a draft: real dataUri, else the demo SVG. */
export function draftImageSrc(d: { svg?: string; dataUri?: string }): string {
  if (typeof d.dataUri === "string" && d.dataUri.length > 0) return d.dataUri;
  return svgDataUrl(d.svg ?? "");
}

/** Displayable src for a final: real dataUri, else the SVG asset. */
export function finalImageSrc(f: { asset?: string; dataUri?: string }): string {
  if (typeof f.dataUri === "string" && f.dataUri.length > 0) return f.dataUri;
  return svgDataUrl(f.asset ?? "");
}
