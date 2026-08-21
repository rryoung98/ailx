/**
 * T4 checkpoint codec — F2 dependency.
 * Captures drafts, finals, chosenSet, note and disclosure so the Runner can
 * rehydrate after pause/reload. Pure and DOM-free (SSR-testable).
 */
import type { T4Draft, T4Final, T4Finals } from "./types.js";

export interface T4CheckpointState {
  drafts: T4Draft[];
  finals: T4Finals;
  chosenSet: number[];
  note: string;
  disclosed: boolean;
  /**
   * True once the candidate pressed submit and is viewing the finals
   * gallery (presentation-only phase before onComplete fires). Optional in
   * stored checkpoints for backward compatibility; absent means false.
   */
  submitted?: boolean;
}

export function encodeT4Checkpoint(state: T4CheckpointState): T4CheckpointState {
  return {
    drafts: state.drafts.map((d) => ({ ...d })),
    finals: {
      images: state.finals.images.map((f) => ({ ...f })),
      ...(state.finals.video ? { video: { ...state.finals.video } } : {}),
    },
    chosenSet: [...state.chosenSet],
    note: state.note,
    disclosed: state.disclosed,
    submitted: state.submitted === true,
  };
}

function isDraft(x: unknown): x is T4Draft {
  if (typeof x !== "object" || x === null) return false;
  const v = x as Record<string, unknown>;
  return (
    typeof v.index === "number" &&
    typeof v.prompt === "string" &&
    typeof v.svg === "string" &&
    typeof v.clientTs === "string"
  );
}

function isFinal(x: unknown): x is T4Final {
  if (typeof x !== "object" || x === null) return false;
  const v = x as Record<string, unknown>;
  return (
    (v.kind === "image" || v.kind === "video") &&
    typeof v.fromDraftIndex === "number" &&
    typeof v.prompt === "string" &&
    typeof v.asset === "string" &&
    typeof v.clientTs === "string"
  );
}

export function decodeT4Checkpoint(raw: unknown): T4CheckpointState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.note !== "string" || typeof r.disclosed !== "boolean") return null;
  if (!Array.isArray(r.drafts) || !(r.drafts as unknown[]).every(isDraft)) return null;
  const finalsRaw = r.finals as Record<string, unknown> | null;
  if (typeof finalsRaw !== "object" || finalsRaw === null) return null;
  if (!Array.isArray(finalsRaw.images) || !(finalsRaw.images as unknown[]).every(isFinal)) return null;
  if (finalsRaw.video !== undefined && !isFinal(finalsRaw.video)) return null;
  const images = finalsRaw.images as T4Final[];
  const chosenSet = (Array.isArray(r.chosenSet) ? r.chosenSet : []).filter(
    (i): i is number =>
      typeof i === "number" && Number.isInteger(i) && i >= 0 && i < images.length,
  );
  return {
    drafts: r.drafts as T4Draft[],
    finals: finalsRaw.video
      ? { images, video: finalsRaw.video as T4Final }
      : { images },
    chosenSet,
    note: r.note,
    disclosed: r.disclosed,
    submitted: r.submitted === true,
  };
}
