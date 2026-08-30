import type {
  ScoreInputs,
  StageSpec,
  TrackCtx,
  TrackPlugin,
  TrackScore,
  Upload,
} from "@ailx/core";
import type {
  T2Artifact,
  T2Config,
  T2Item,
  T2PresentationConfig,
  T2PresentedItem,
  T2Session,
} from "./types.js";
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

/**
 * ONE validator, two demands. `secrets: true` requires every item's marking
 * scheme (scoring, replay, the released-practice tier); `secrets: false`
 * accepts a redacted sitting deck as served by
 * `GET /api/attempts/:id/items`, and still CHECKS a key or rationale that
 * happens to be there. Splitting the shapes without splitting the rules is
 * the whole reason this is one function.
 */
function validate(raw: unknown, secrets: boolean): T2PresentationConfig {
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
    if (secrets || it.key !== undefined) {
      if (typeof it.key !== "number" || it.key < 0 || it.key >= (it.options?.length ?? 0)) {
        fail(`items[${idx}].key out of range`);
      }
    }
    if (it.type !== "provenance" && it.options.length !== 2) {
      fail(`items[${idx}]: binary blocks require exactly 2 options`);
    }
    if (typeof it.difficulty !== "number" || it.difficulty < 0 || it.difficulty > 1) {
      fail(`items[${idx}].difficulty must be in [0,1]`);
    }
    if ((secrets || it.rationale !== undefined) && typeof it.rationale !== "string") {
      fail(`items[${idx}].rationale missing`);
    }
    if (it.signal !== undefined &&
        (typeof it.signal !== "number" || it.signal < 0 || it.signal >= (it.options?.length ?? 0))) {
      fail(`items[${idx}].signal out of range`);
    }
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
    items: cfg.items as T2PresentedItem[],
    weights: {
      sensitivity: w.sensitivity as number,
      calibration: w.calibration as number,
      provenance: w.provenance as number,
    },
    ...(cfg.dPrimeCeiling !== undefined ? { dPrimeCeiling: cfg.dPrimeCeiling as number } : {}),
  };
}

/**
 * SCORING config: every item must carry its key and rationale. The cast is
 * safe precisely because `secrets: true` just proved both are present on
 * every item.
 */
export function validateT2Config(raw: unknown): T2Config {
  return validate(raw, true) as T2Config;
}

/**
 * PRESENTATION config: what the Runner mounts. A hosted sitting deck arrives
 * from the server with `key` and `rationale` ABSENT, so demanding them here
 * would refuse the only deck a candidate is allowed to be shown.
 */
export function validateT2PresentationConfig(raw: unknown): T2PresentationConfig {
  return validate(raw, false);
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
