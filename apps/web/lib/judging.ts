/**
 * Client-side demo judging — plays the role of the pipeline() stages for the
 * static showcase. Deterministic (sha256-seeded), so re-judging identical
 * artifacts yields identical Judgment rows; score() consumes only these
 * stored rows, matching the platform architecture (§11/§14).
 */
import type { Judgment } from "@ailx/core";
import { sha256Hex } from "@ailx/track-t1";

function seeded01(seed: string): number {
  return parseInt(sha256Hex(seed).slice(0, 8), 16) / 0xffffffff;
}

function mk(dimension: string, sample: number, value: number): Judgment {
  return { dimension, sample, value, evidence: "[DEMO] seeded judge", modelId: `demo-judge-${(sample % 3) + 1}@1` };
}

/** 3 samples per dimension; value blends artifact-effort signal with seeded jitter. */
function tri(dimension: string, base: number, seedRoot: string): Judgment[] {
  return [0, 1, 2].map((s) => {
    const jitter = (seeded01(`${seedRoot}|${dimension}|${s}`) - 0.5) * 0.2;
    return mk(dimension, s, Math.max(0, Math.min(1, base + jitter)));
  });
}

function clamp01(x: number): number { return x < 0 ? 0 : x > 1 ? 1 : x; }

export function judgeT1(artifact: { html: string; promptLog: unknown[]; selfReport: string }): Judgment[] {
  const seed = sha256Hex(artifact.html + "|" + artifact.selfReport);
  const size = clamp01(artifact.html.length / 2500);
  const hasStructure = /<(header|main|section|nav|h1)/i.test(artifact.html) ? 0.25 : 0;
  const hasStyle = /<style|style=/i.test(artifact.html) ? 0.2 : 0;
  const hasScript = /<script/i.test(artifact.html) ? 0.15 : 0;
  const base = clamp01(0.25 + 0.35 * size + hasStructure + hasStyle);
  return [
    ...tri("functional", clamp01(base + 0.1), seed),
    ...tri("comparative", base, seed),
    ...tri("ambition", clamp01(0.2 + 0.4 * size + hasScript + hasStyle), seed),
    ...tri("rationale", clamp01(0.2 + 0.6 * clamp01(artifact.selfReport.length / 400)), seed),
  ];
}

export function judgeT3(artifact: { transcript: unknown[]; finalAnswer: string }): Judgment[] {
  const seed = sha256Hex(artifact.finalAnswer);
  const lengthBand = Math.min(3, Math.floor(artifact.finalAnswer.length / 400));
  return [0, 1, 2].map((s) => {
    const jitter = Math.floor(seeded01(`${seed}|analysis|${s}`) * 3) - 1; // -1..+1
    return mk("analysis", s, Math.max(0, Math.min(5, 2 + lengthBand + jitter)));
  });
}

interface T4Gen { prompt: string; [k: string]: unknown }

export function judgeT4(artifact: { generations: T4Gen[]; chosenIndex: number; note: string }): Judgment[] {
  const seed = sha256Hex(JSON.stringify(artifact.generations.map((g) => g.prompt)) + artifact.note);
  const out: Judgment[] = [];
  // Per-generation 'generation' values: richer prompts judge higher (deterministic).
  artifact.generations.forEach((g, i) => {
    const richness = clamp01(g.prompt.split(/\s+/).filter(Boolean).length / 20);
    const jitter = (seeded01(`${seed}|gen|${i}`) - 0.5) * 0.15;
    out.push(mk("generation", i, clamp01(0.2 + 0.7 * richness + jitter)));
  });
  const chosen = artifact.generations[Math.min(artifact.chosenIndex, artifact.generations.length - 1)];
  const chosenRich = chosen ? clamp01(chosen.prompt.split(/\s+/).filter(Boolean).length / 20) : 0;
  out.push(
    ...tri("brief-fit", clamp01(0.3 + 0.55 * chosenRich), seed),
    ...tri("comparative", clamp01(0.25 + 0.55 * chosenRich), seed),
    ...tri("direction-note", clamp01(0.2 + 0.65 * clamp01(artifact.note.length / 300)), seed),
    ...tri("provenance", 0.8, seed), // demo pipeline always attaches credentials
  );
  return out;
}
