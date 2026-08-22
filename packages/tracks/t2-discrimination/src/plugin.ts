import type {
  ScoreInputs,
  StageSpec,
  TrackCtx,
  TrackPlugin,
  TrackScore,
  Upload,
} from "@ailx/core";
import type { T2Artifact, T2Config, T2Item, T2Session } from "./types.js";
import { scoreT2, type T2Raw } from "./scoring.js";

export interface T2Score extends TrackScore {
  raw: Record<string, number>;
  scaled: number;
}

const ITEM_TYPES = new Set([
  "media-image", "media-video", "media-audio",
  "message-email", "message-page", "provenance",
]);

function fail(msg: string): never {
  throw new Error(`t2-discrimination config: ${msg}`);
}

export function validateT2Config(raw: unknown): T2Config {
  if (typeof raw !== "object" || raw === null) fail("must be an object");
  const cfg = raw as Record<string, unknown>;
  if (!Array.isArray(cfg.items) || cfg.items.length === 0) fail("items must be a non-empty array");
  const seen = new Set<string>();
  for (const [idx, itRaw] of cfg.items.entries()) {
    const it = itRaw as Partial<T2Item>;
    if (typeof it.id !== "string" || it.id.length === 0) fail(`items[${idx}].id missing`);
    if (seen.has(it.id)) fail(`duplicate item id ${it.id}`);
    seen.add(it.id);
    if (!ITEM_TYPES.has(it.type as string)) fail(`items[${idx}].type invalid: ${String(it.type)}`);
    if (typeof it.stem !== "string") fail(`items[${idx}].stem missing`);
    if (typeof it.material !== "string") fail(`items[${idx}].material missing`);
    if (!Array.isArray(it.options) || it.options.length < 2) fail(`items[${idx}].options needs >= 2 entries`);
    if (typeof it.key !== "number" || it.key < 0 || it.key >= it.options.length) {
      fail(`items[${idx}].key out of range`);
    }
    if (it.type !== "provenance" && it.options.length !== 2) {
      fail(`items[${idx}]: binary blocks require exactly 2 options`);
    }
    if (typeof it.difficulty !== "number" || it.difficulty < 0 || it.difficulty > 1) {
      fail(`items[${idx}].difficulty must be in [0,1]`);
    }
    if (typeof it.rationale !== "string") fail(`items[${idx}].rationale missing`);
  }
  const w = (cfg.weights ?? { sensitivity: 60, calibration: 25, provenance: 15 }) as Record<string, unknown>;
  for (const k of ["sensitivity", "calibration", "provenance"] as const) {
    if (typeof w[k] !== "number" || (w[k] as number) < 0) fail(`weights.${k} must be a non-negative number`);
  }
  if (cfg.dPrimeCeiling !== undefined &&
      (typeof cfg.dPrimeCeiling !== "number" || !Number.isFinite(cfg.dPrimeCeiling) || cfg.dPrimeCeiling <= 0)) {
    fail("dPrimeCeiling must be a positive finite number when present");
  }
  return {
    items: cfg.items as T2Item[],
    weights: {
      sensitivity: w.sensitivity as number,
      calibration: w.calibration as number,
      provenance: w.provenance as number,
    },
    ...(cfg.dPrimeCeiling !== undefined ? { dPrimeCeiling: cfg.dPrimeCeiling as number } : {}),
  };
}

export const plugin: TrackPlugin<T2Config, T2Session, T2Artifact, T2Score> = {
  id: "t2-discrimination",
  apiVersion: 2,

  validateConfig: validateT2Config,

  async startSession(ctx: TrackCtx, _cfg: T2Config): Promise<T2Session> {
    return { attemptId: ctx.attemptId, startedItemIds: [] };
  },

  async ingest(_ctx: TrackCtx, _s: T2Session, payload: Upload): Promise<T2Artifact> {
    if (payload.kind !== "t2-responses" || typeof payload.json !== "object" || payload.json === null) {
      throw new Error("t2-discrimination ingest: expected kind 't2-responses' with a json body");
    }
    const body = payload.json as Partial<T2Artifact>;
    if (!Array.isArray(body.responses)) {
      throw new Error("t2-discrimination ingest: json.responses must be an array");
    }
    return { responses: body.responses };
  },

  // Fully model-free: no async judging stages.
  pipeline(_cfg: T2Config): StageSpec[] {
    return [];
  },

  /** PURE — spec §14. Consumes only the stored artifact + config. */
  score(inputs: ScoreInputs<T2Artifact>, cfg: T2Config): T2Score {
    const { raw, scaled } = scoreT2(inputs.artifact, cfg);
    return { raw: raw as unknown as Record<string, number>, scaled };
  },

  /** Lazy UI loader (F11) — the platform must not hardcode track imports. */
  ui: () => import("./Runner.js").then((m) => ({ Runner: m.Runner })),
};

export type { T2Raw };
