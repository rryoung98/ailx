#!/usr/bin/env node
/**
 * Regenerates apps/web/lib/instrument/fixtures/plugin-golden.json — the pinned golden
 * fixtures for the four REAL track plugin score() functions (F16).
 *
 * Run from the repo root AFTER `pnpm -r build`:
 *   node apps/web/scripts/gen-plugin-golden.mjs
 *
 * The /validate page and vitest replay these fixtures through runPure and
 * fail on any drift. Re-run this script deliberately whenever a track's
 * scoring changes, and review the diff like any other golden update.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const load = (p) => import(join(root, p));

const { t1Plugin } = await load("packages/tracks/t1-creative-build/dist/index.js");
const t2mod = await load("packages/tracks/t2-discrimination/dist/index.js");
const t3mod = await load("packages/tracks/t3-reasoning/dist/index.js");
const { t4Plugin } = await load("packages/tracks/t4-generative/dist/index.js");

const FIXTURES = {
  t1: {
    config: null,
    artifact: {
      html: "<html><head><style>h1{color:#123}</style></head><body><header><h1>Golden</h1></header><main><section><p>fixture</p></section></main></body></html>",
      promptLog: [
        { kind: "prompted", prompt: "draft", clientTs: "2026-01-01T00:00:30.000Z" },
        { kind: "revised", clientTs: "2026-01-01T00:01:00.000Z" },
      ],
      selfReport: "A deliberately small golden artifact with a coherent stated intent.",
    },
    judgments: [
      { dimension: "functional", sample: 0, value: 0.8, modelId: "golden@1" },
      { dimension: "functional", sample: 1, value: 0.7, modelId: "golden@1" },
      { dimension: "functional", sample: 2, value: 0.9, modelId: "golden@1" },
      { dimension: "comparative", sample: 0, value: 0.6, modelId: "golden@1" },
      { dimension: "comparative", sample: 1, value: 0.5, modelId: "golden@1" },
      { dimension: "comparative", sample: 2, value: 0.55, modelId: "golden@1" },
      { dimension: "ambition", sample: 0, value: 0.4, modelId: "golden@1" },
      { dimension: "rationale", sample: 0, value: 0.7, modelId: "golden@1" },
    ],
  },
  t2: {
    config: {
      items: [
        { id: "golden-t2-a", type: "media-image", stem: "Authentic?", material: "data:image/svg+xml;base64,PHN2Zy8+", options: ["Synthetic", "Authentic"], key: 0, signal: 0, difficulty: 0.25, rationale: "r", exposureSeconds: 6 },
        { id: "golden-t2-b", type: "message-email", stem: "Hostile?", material: "From: x\n\nbody", options: ["Hostile", "Legitimate"], key: 1, signal: 0, difficulty: 0.5, rationale: "r", exposureSeconds: 25 },
        { id: "golden-t2-c", type: "media-image", stem: "Authentic?", material: "data:image/svg+xml;base64,PHN2Zy8+", options: ["Synthetic", "Authentic"], key: 1, signal: 0, difficulty: 0.85, rationale: "r", exposureSeconds: 6 },
        { id: "golden-t2-d", type: "provenance", stem: "Best claim?", material: "No manifest present.", options: ["A", "B", "C"], key: 2, difficulty: 0.5, rationale: "r" },
      ],
    },
    artifact: {
      responses: [
        { itemId: "golden-t2-a", choice: 0, confidence: 80, latencyMs: 900 },
        { itemId: "golden-t2-b", choice: 1, confidence: 60, latencyMs: 2400 },
        { itemId: "golden-t2-c", choice: 0, confidence: 40, latencyMs: 1100 },
        { itemId: "golden-t2-d", choice: 2, confidence: 0, latencyMs: 5000 },
      ],
    },
    judgments: [],
  },
  t3: {
    config: {
      title: "Golden scenario",
      brief: "Advise on the golden question.",
      sourceTitle: "Golden source",
      sourceExcerpt: "Section 1: the golden figure is 38.",
      plantedErrors: [
        { id: "pe-g", topic: "golden figure", claim: "The figure is 61.", truth: "It is 38." },
      ],
      correctAdvice: [
        { id: "ca-g", topic: "golden advice", claim: "38 supports the reform." },
      ],
      minWords: 20,
    },
    artifact: {
      transcript: [
        { seq: 0, verb: "prompted", object: "prompt:1", text: "What is the figure?", clientTs: "2026-01-01T00:00:00.000Z" },
        { seq: 1, verb: "assisted", object: "assist:1", claimIds: ["pe-g", "ca-g"], clientTs: "2026-01-01T00:00:01.000Z" },
        { seq: 2, verb: "challenged", object: "claim:pe-g", clientTs: "2026-01-01T00:00:02.000Z" },
        // Verification names the claim it checked (F5): an unattributed
        // `verified` event buys no process points and no adoption credit.
        { seq: 3, verb: "verified", object: "claim:ca-g", claimIds: ["ca-g"], clientTs: "2026-01-01T00:00:03.000Z" },
        { seq: 4, verb: "accepted", object: "claim:ca-g", clientTs: "2026-01-01T00:00:04.000Z" },
      ],
      finalAnswer: "The figure is 38 per Section 1, so the reform is justified; the assistant's 61 was rejected after checking the source directly and carefully.",
    },
    judgments: [
      { dimension: "analysis", sample: 0, value: 0.6, modelId: "golden@1" },
      { dimension: "analysis", sample: 1, value: 0.8, modelId: "golden@1" },
      { dimension: "analysis", sample: 2, value: 0.6, modelId: "golden@1" },
    ],
  },
  t4: {
    config: null,
    artifact: {
      drafts: [
        { index: 0, prompt: "poster", svg: "<svg/>", clientTs: "2026-01-01T00:00:00.000Z" },
        { index: 1, prompt: "poster, focal figure, wide margins", svg: "<svg/>", clientTs: "2026-01-01T00:00:01.000Z" },
      ],
      finals: {
        images: [
          { kind: "image", fromDraftIndex: 1, prompt: "poster, focal figure, wide margins", asset: "<svg/>", clientTs: "2026-01-01T00:00:02.000Z" },
        ],
      },
      chosenSet: [0],
      note: "Chose the second frame: the focal figure reads first, as the brief asks.",
      disclosed: true,
    },
    judgments: [
      { dimension: "generation", sample: 0, value: 0.3, modelId: "golden@1" },
      { dimension: "generation", sample: 1, value: 0.7, modelId: "golden@1" },
      { dimension: "brief-fit", sample: 0, value: 0.6, modelId: "golden@1" },
      { dimension: "comparative", sample: 0, value: 0.5, modelId: "golden@1" },
      { dimension: "direction-note", sample: 0, value: 0.6, modelId: "golden@1" },
      { dimension: "provenance", sample: 0, value: 0.9, modelId: "golden@1" },
    ],
  },
};

const RUBRIC = "golden-rubric";
const out = {};
const score = {
  t1: (f) => t1Plugin.score({ artifact: f.artifact, judgments: f.judgments, rubricVersion: RUBRIC }, t1Plugin.validateConfig(f.config)),
  t2: (f) => t2mod.plugin.score({ artifact: f.artifact, judgments: f.judgments, rubricVersion: RUBRIC }, t2mod.validateT2Config(f.config)),
  t3: (f) => t3mod.plugin.score({ artifact: f.artifact, judgments: f.judgments, rubricVersion: RUBRIC }, t3mod.validateT3Config(f.config)),
  t4: (f) => t4Plugin.score({ artifact: f.artifact, judgments: f.judgments, rubricVersion: RUBRIC }, t4Plugin.validateConfig(f.config)),
};
for (const t of ["t1", "t2", "t3", "t4"]) {
  const f = FIXTURES[t];
  out[t] = { ...f, expected: score[t](f) };
}

const dest = join(root, "apps/web/lib/instrument/fixtures/plugin-golden.json");
writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
console.log("wrote", dest);
