/**
 * T3 checkpoint codec — F2 dependency.
 * Captures the full working state (transcript, chat messages, draft,
 * stances, counters) so the Runner can rehydrate after pause/reload.
 * Pure and DOM-free so it is unit-testable under SSR.
 */
import type { T3Turn } from "./types.js";

export interface T3ChatMsg {
  role: "user" | "assistant";
  text: string;
  claimIds: string[];
  object: string;
}

export interface T3CheckpointState {
  phase: "brief" | "work" | "reveal";
  transcript: T3Turn[];
  messages: T3ChatMsg[];
  draft: string;
  savedDraft: string;
  stances: Record<string, "challenged" | "accepted">;
  seq: number;
  promptSeq: number;
  draftRev: number;
}

const VERBS = new Set([
  "prompted", "assisted", "revised", "regenerated",
  "verified", "challenged", "accepted", "submitted",
]);

export function encodeT3Checkpoint(state: T3CheckpointState): T3CheckpointState {
  return {
    phase: state.phase,
    transcript: state.transcript.map((t) => ({ ...t })),
    messages: state.messages.map((m) => ({ ...m, claimIds: [...m.claimIds] })),
    draft: state.draft,
    savedDraft: state.savedDraft,
    stances: { ...state.stances },
    seq: state.seq,
    promptSeq: state.promptSeq,
    draftRev: state.draftRev,
  };
}

export function decodeT3Checkpoint(raw: unknown): T3CheckpointState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.phase !== "brief" && r.phase !== "work" && r.phase !== "reveal") return null;
  if (typeof r.draft !== "string" || typeof r.savedDraft !== "string") return null;
  for (const k of ["seq", "promptSeq", "draftRev"] as const) {
    if (typeof r[k] !== "number" || !Number.isInteger(r[k]) || (r[k] as number) < 0) return null;
  }
  if (!Array.isArray(r.transcript) || !Array.isArray(r.messages)) return null;
  const transcript: T3Turn[] = [];
  for (const t of r.transcript as unknown[]) {
    if (typeof t !== "object" || t === null) return null;
    const v = t as Record<string, unknown>;
    if (!VERBS.has(v.verb as string) || typeof v.object !== "string") return null;
    transcript.push(v as unknown as T3Turn);
  }
  const messages: T3ChatMsg[] = [];
  for (const m of r.messages as unknown[]) {
    if (typeof m !== "object" || m === null) return null;
    const v = m as Record<string, unknown>;
    if ((v.role !== "user" && v.role !== "assistant") || typeof v.text !== "string") return null;
    messages.push({
      role: v.role,
      text: v.text,
      claimIds: Array.isArray(v.claimIds) ? (v.claimIds as unknown[]).filter((x): x is string => typeof x === "string") : [],
      object: typeof v.object === "string" ? v.object : "",
    });
  }
  const stances: Record<string, "challenged" | "accepted"> = {};
  if (typeof r.stances === "object" && r.stances !== null) {
    for (const [k, v] of Object.entries(r.stances as Record<string, unknown>)) {
      if (v === "challenged" || v === "accepted") stances[k] = v;
    }
  }
  return {
    phase: r.phase,
    transcript,
    messages,
    draft: r.draft,
    savedDraft: r.savedDraft,
    stances,
    seq: r.seq as number,
    promptSeq: r.promptSeq as number,
    draftRev: r.draftRev as number,
  };
}
