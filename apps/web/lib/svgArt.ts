/**
 * Deterministic inline-SVG "image model" for the static demo.
 * Everything derives from sha256 of the seed — same prompt, same picture,
 * forever. No network, no canvas, no deps.
 */

import { seededUniform, sha256Hex } from "@ailx/session";

export interface DemoArt {
  svg: string;
  seed: string;
}

const PALETTES = [
  ["#0f172a", "#5b8cff", "#8ab4ff", "#e8eaf0"],
  ["#1a0f2a", "#b45bff", "#ff8ad6", "#ffe8f4"],
  ["#0a1f1a", "#2fd0a0", "#a0ffd6", "#eafff6"],
  ["#241505", "#ffb020", "#ffd98a", "#fff4dd"],
  ["#200a0a", "#ff5b5b", "#ffa08a", "#ffe9e2"],
  ["#101c08", "#9ccf3a", "#d6ff8a", "#f6ffe2"],
];

/** Generative composition from an arbitrary prompt string. */
export function generateDemoImage(prompt: string, sample: number): DemoArt {
  const seed = sha256Hex(`ailx-demo-image@1:${prompt}:${sample}`);
  const u = (i: number) => seededUniform(seed, i);
  const pal = PALETTES[Math.floor(u(0) * PALETTES.length)];
  const parts: string[] = [];
  parts.push(`<rect width="320" height="200" fill="${pal[0]}"/>`);
  // horizon band
  const hy = 60 + u(1) * 90;
  parts.push(`<rect y="${hy.toFixed(0)}" width="320" height="${(200 - hy).toFixed(0)}" fill="${pal[1]}" opacity="0.25"/>`);
  // orbs / shapes
  const n = 4 + Math.floor(u(2) * 5);
  for (let i = 0; i < n; i++) {
    const cx = u(10 + i * 4) * 320;
    const cy = u(11 + i * 4) * 200;
    const r = 8 + u(12 + i * 4) * 46;
    const col = pal[1 + Math.floor(u(13 + i * 4) * 3)];
    if (u(30 + i) > 0.5) {
      parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${col}" opacity="${(0.35 + u(40 + i) * 0.5).toFixed(2)}"/>`);
    } else {
      parts.push(`<rect x="${(cx - r).toFixed(1)}" y="${(cy - r / 2).toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${r.toFixed(1)}" rx="${(r / 4).toFixed(1)}" fill="${col}" opacity="${(0.35 + u(40 + i) * 0.5).toFixed(2)}" transform="rotate(${(u(50 + i) * 40 - 20).toFixed(0)} ${cx.toFixed(1)} ${cy.toFixed(1)})"/>`);
    }
  }
  // scan-line texture
  parts.push(`<g opacity="0.08">${Array.from({ length: 10 }, (_, i) => `<rect y="${i * 20}" width="320" height="1" fill="#fff"/>`).join("")}</g>`);
  return { seed, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">${parts.join("")}</svg>` };
}

/**
 * A T2 "photograph": procedural landscape. Synthetic ones carry a subtle
 * physics tell — a second shadow direction / duplicated element.
 */
export function generatePhoto(seed0: string, synthetic: boolean): DemoArt {
  const seed = sha256Hex(`ailx-demo-photo@1:${seed0}`);
  const u = (i: number) => seededUniform(seed, i);
  const sky = ["#20304a", "#2a2440", "#1a3a4a", "#3a2a20"][Math.floor(u(0) * 4)];
  const ground = ["#18261a", "#242018", "#1c2430"][Math.floor(u(1) * 3)];
  const sunX = 40 + u(2) * 240;
  const parts: string[] = [];
  parts.push(`<rect width="320" height="200" fill="${sky}"/>`);
  parts.push(`<circle cx="${sunX.toFixed(0)}" cy="46" r="16" fill="#ffd98a" opacity="0.9"/>`);
  parts.push(`<rect y="130" width="320" height="70" fill="${ground}"/>`);
  const n = 3 + Math.floor(u(3) * 3);
  for (let i = 0; i < n; i++) {
    const x = 20 + u(10 + i) * 280;
    const h = 24 + u(20 + i) * 40;
    // tree
    parts.push(`<rect x="${(x - 2).toFixed(0)}" y="${(130 - h).toFixed(0)}" width="4" height="${h.toFixed(0)}" fill="#3a3026"/>`);
    parts.push(`<circle cx="${x.toFixed(0)}" cy="${(130 - h).toFixed(0)}" r="${(h / 2.4).toFixed(0)}" fill="#2f4a2a"/>`);
    // correct shadow: away from sun
    const dir = x > sunX ? 1 : -1;
    const wrong = synthetic && i === 1 ? -1 : 1; // the tell
    parts.push(`<ellipse cx="${(x + dir * wrong * h * 0.4).toFixed(0)}" cy="133" rx="${(h * 0.45).toFixed(0)}" ry="3.5" fill="#000" opacity="0.35"/>`);
  }
  if (synthetic) {
    // duplicated bush artifact
    const bx = 60 + u(6) * 180;
    parts.push(`<circle cx="${bx.toFixed(0)}" cy="150" r="9" fill="#2f4a2a"/>`);
    parts.push(`<circle cx="${(bx + 14).toFixed(0)}" cy="150" r="9" fill="#2f4a2a"/>`);
  }
  return { seed, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">${parts.join("")}</svg>` };
}
