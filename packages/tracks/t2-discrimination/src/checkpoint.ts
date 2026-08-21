/**
 * T2 checkpoint codec — F2 dependency.
 * Runner state is a projection of {phase, deckIndex, replayIdx, responses};
 * the Runner calls props.onCheckpoint(encodeT2Checkpoint(...)) after every
 * mutation and rehydrates via decodeT2Checkpoint(props.checkpoint) on mount.
 * Pure and DOM-free so it is unit-testable under SSR.
 */
import type { T2Response } from "./types.js";

export type T2Phase = "intro" | "deck" | "replay" | "done";

export interface T2CheckpointState {
  phase: T2Phase;
  deckIndex: number;
  replayIdx: number;
  responses: T2Response[];
}

const PHASES: ReadonlyArray<T2Phase> = ["intro", "deck", "replay", "done"];

export function encodeT2Checkpoint(state: T2CheckpointState): T2CheckpointState {
  return {
    phase: state.phase,
    deckIndex: state.deckIndex,
    replayIdx: state.replayIdx,
    responses: state.responses.map((r) => ({ ...r })),
  };
}

export function decodeT2Checkpoint(raw: unknown): T2CheckpointState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!PHASES.includes(r.phase as T2Phase)) return null;
  if (typeof r.deckIndex !== "number" || !Number.isInteger(r.deckIndex) || r.deckIndex < 0) return null;
  if (typeof r.replayIdx !== "number" || !Number.isInteger(r.replayIdx) || r.replayIdx < 0) return null;
  if (!Array.isArray(r.responses)) return null;
  const responses: T2Response[] = [];
  for (const x of r.responses as unknown[]) {
    if (typeof x !== "object" || x === null) return null;
    const v = x as Record<string, unknown>;
    if (
      typeof v.itemId !== "string" ||
      typeof v.choice !== "number" ||
      typeof v.confidence !== "number" ||
      typeof v.latencyMs !== "number"
    ) {
      return null;
    }
    responses.push({
      itemId: v.itemId,
      choice: v.choice,
      confidence: v.confidence,
      latencyMs: v.latencyMs,
    });
  }
  return {
    phase: r.phase as T2Phase,
    deckIndex: r.deckIndex,
    replayIdx: r.replayIdx,
    responses,
  };
}
