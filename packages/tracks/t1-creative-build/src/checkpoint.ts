/**
 * T1 checkpoint codec — F2 dependency.
 * The Runner calls props.onCheckpoint(encodeT1Checkpoint(state)) after every
 * meaningful mutation and rehydrates via decodeT1Checkpoint(props.checkpoint)
 * on mount, so pause/reload/timeout never lose in-progress state.
 * Pure and DOM-free so it is unit-testable under SSR.
 */
import type { PromptLogEntry } from "./types.js";

export interface T1CheckpointState {
  html: string;
  promptLog: PromptLogEntry[];
  selfReport: string;
}

export function encodeT1Checkpoint(state: T1CheckpointState): T1CheckpointState {
  return {
    html: state.html,
    promptLog: state.promptLog.map((e) => ({ ...e })),
    selfReport: state.selfReport,
  };
}

export function decodeT1Checkpoint(raw: unknown): T1CheckpointState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.html !== "string" || typeof r.selfReport !== "string") return null;
  const promptLog: PromptLogEntry[] = Array.isArray(r.promptLog)
    ? (r.promptLog as unknown[]).filter(
        (e): e is PromptLogEntry =>
          typeof e === "object" &&
          e !== null &&
          ((e as PromptLogEntry).kind === "prompted" ||
            (e as PromptLogEntry).kind === "revised") &&
          typeof (e as PromptLogEntry).clientTs === "string",
      )
    : [];
  return { html: r.html, promptLog, selfReport: r.selfReport };
}
