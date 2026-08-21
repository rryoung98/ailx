import type {
  ScoreInputs,
  StageSpec,
  TrackCtx,
  TrackPlugin,
  TrackScore,
  Upload,
} from "@ailx/core";
import type { T3Artifact, T3Config, T3Session, T3Turn } from "./types.js";
import { scoreT3, type T3Raw } from "./scoring.js";

export interface T3Score extends TrackScore {
  raw: Record<string, number>;
  scaled: number;
}

function fail(msg: string): never {
  throw new Error(`t3-reasoning config: ${msg}`);
}

export function validateT3Config(raw: unknown): T3Config {
  if (typeof raw !== "object" || raw === null) fail("must be an object");
  const cfg = raw as Record<string, unknown>;
  for (const k of ["title", "brief", "sourceTitle", "sourceExcerpt"] as const) {
    if (typeof cfg[k] !== "string" || (cfg[k] as string).length === 0) fail(`${k} missing`);
  }
  if (!Array.isArray(cfg.plantedErrors) || cfg.plantedErrors.length === 0) {
    fail("plantedErrors must be non-empty (the seeded-error mechanism is the track)");
  }
  const ids = new Set<string>();
  for (const [i, e] of (cfg.plantedErrors as Array<Record<string, unknown>>).entries()) {
    for (const k of ["id", "topic", "claim", "truth"]) {
      if (typeof e[k] !== "string" || (e[k] as string).length === 0) fail(`plantedErrors[${i}].${k} missing`);
    }
    if (ids.has(e.id as string)) fail(`duplicate claim id ${String(e.id)}`);
    ids.add(e.id as string);
  }
  if (!Array.isArray(cfg.correctAdvice)) fail("correctAdvice must be an array");
  for (const [i, a] of (cfg.correctAdvice as Array<Record<string, unknown>>).entries()) {
    for (const k of ["id", "topic", "claim"]) {
      if (typeof a[k] !== "string" || (a[k] as string).length === 0) fail(`correctAdvice[${i}].${k} missing`);
    }
    if (ids.has(a.id as string)) fail(`duplicate claim id ${String(a.id)}`);
    ids.add(a.id as string);
  }
  const minWords = typeof cfg.minWords === "number" ? cfg.minWords : 1200;
  const w = (cfg.weights ?? { rsr: 25, analysis: 45, process: 20, rair: 10 }) as Record<string, unknown>;
  for (const k of ["rsr", "analysis", "process", "rair"] as const) {
    if (typeof w[k] !== "number" || (w[k] as number) < 0) fail(`weights.${k} must be a non-negative number`);
  }
  return {
    title: cfg.title as string,
    brief: cfg.brief as string,
    sourceTitle: cfg.sourceTitle as string,
    sourceExcerpt: cfg.sourceExcerpt as string,
    plantedErrors: cfg.plantedErrors as T3Config["plantedErrors"],
    correctAdvice: cfg.correctAdvice as T3Config["correctAdvice"],
    minWords,
    weights: {
      rsr: w.rsr as number,
      analysis: w.analysis as number,
      process: w.process as number,
      rair: w.rair as number,
    },
  };
}

const VERBS = new Set([
  "prompted", "assisted", "revised", "regenerated",
  "verified", "challenged", "accepted", "submitted",
]);

export const plugin: TrackPlugin<T3Config, T3Session, T3Artifact, T3Score> = {
  id: "t3-reasoning",
  apiVersion: 2,

  validateConfig: validateT3Config,

  async startSession(ctx: TrackCtx, _cfg: T3Config): Promise<T3Session> {
    return { attemptId: ctx.attemptId };
  },

  async ingest(_ctx: TrackCtx, _s: T3Session, payload: Upload): Promise<T3Artifact> {
    if (payload.kind !== "t3-transcript" || typeof payload.json !== "object" || payload.json === null) {
      throw new Error("t3-reasoning ingest: expected kind 't3-transcript' with a json body");
    }
    const body = payload.json as Partial<T3Artifact>;
    if (!Array.isArray(body.transcript)) throw new Error("t3-reasoning ingest: transcript must be an array");
    for (const t of body.transcript as T3Turn[]) {
      if (!VERBS.has(t.verb)) throw new Error(`t3-reasoning ingest: unknown verb ${String(t.verb)}`);
    }
    if (typeof body.finalAnswer !== "string") throw new Error("t3-reasoning ingest: finalAnswer must be a string");
    return { transcript: body.transcript, finalAnswer: body.finalAnswer };
  },

  /**
   * The heterogeneous three-model jury runs here as an async stage; in the
   * static showcase the stage is served by DemoJudge. Its outputs are stored
   * as Judgment rows and replayed into score().
   */
  pipeline(_cfg: T3Config): StageSpec[] {
    return [{ id: "judge-t3-analysis", queue: "judge", maxAttempts: 3 }];
  },

  /** PURE — consumes the stored transcript + stored jury judgments only. */
  score(inputs: ScoreInputs<T3Artifact>, cfg: T3Config): T3Score {
    const { raw, scaled } = scoreT3(inputs.artifact, inputs.judgments, cfg);
    return { raw: raw as unknown as Record<string, number>, scaled };
  },
};

export type { T3Raw };
