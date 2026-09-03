import type {
  ScoreInputs,
  StageSpec,
  TrackCtx,
  TrackPlugin,
  TrackScore,
  Upload,
} from "@ailx/core";
import type {
  T3Artifact, T3Config, T3Hosted, T3PresentationConfig, T3Session, T3Turn,
} from "./types.js";
import { T3_DEFAULT_WEIGHTS } from "./types.js";
import { scoreT3, type T3Raw } from "./scoring.js";

export interface T3Score extends TrackScore {
  raw: Record<string, number>;
  scaled: number;
}

function fail(msg: string): never {
  throw new Error(`t3-reasoning config: ${msg}`);
}

/**
 * ONE validator, two demands — the same split as `t2-discrimination`.
 *
 * `secrets: true` requires the marking scheme (the planted errors, their
 * `truth` and trigger `topic`, the correct advice, the weights): scoring, the
 * released-practice tier, the static demo. `secrets: false` accepts the
 * REDACTED sitting form the exam service serves
 * (`GET /v1/attempts/:id/track/t3`), which carries none of it — and still
 * checks any of it that happens to be present, so the released-practice
 * config is validated exactly as strictly through either door.
 */
function validate(raw: unknown, secrets: boolean): T3PresentationConfig {
  if (typeof raw !== "object" || raw === null) fail("must be an object");
  const cfg = raw as Record<string, unknown>;
  for (const k of ["title", "brief", "sourceTitle", "sourceExcerpt"] as const) {
    if (typeof cfg[k] !== "string" || (cfg[k] as string).length === 0) fail(`${k} missing`);
  }
  const hosted = cfg.hosted;
  if (hosted !== undefined) {
    for (const m of ["assist", "record", "reveal"] as const) {
      if (typeof (hosted as Record<string, unknown>)[m] !== "function") fail(`hosted.${m} must be a function`);
    }
    // The leak, stated as a rule: a hosted sitting whose config ALSO carried
    // the plant list would put the answer key back in the browser, and the
    // Runner would have two sources of truth for which claim is which.
    if (cfg.plantedErrors !== undefined || cfg.correctAdvice !== undefined) {
      fail("a hosted config may not carry plantedErrors/correctAdvice — the server owns the scenario");
    }
  }
  const ids = new Set<string>();
  if (secrets || cfg.plantedErrors !== undefined) {
    if (!Array.isArray(cfg.plantedErrors) || cfg.plantedErrors.length === 0) {
      fail("plantedErrors must be non-empty (the seeded-error mechanism is the track)");
    }
    for (const [i, e] of (cfg.plantedErrors as Array<Record<string, unknown>>).entries()) {
      for (const k of ["id", "topic", "claim", "truth"]) {
        if (typeof e[k] !== "string" || (e[k] as string).length === 0) fail(`plantedErrors[${i}].${k} missing`);
      }
      if (ids.has(e.id as string)) fail(`duplicate claim id ${String(e.id)}`);
      ids.add(e.id as string);
    }
  }
  if (secrets || cfg.correctAdvice !== undefined) {
    if (!Array.isArray(cfg.correctAdvice)) fail("correctAdvice must be an array");
    for (const [i, a] of (cfg.correctAdvice as Array<Record<string, unknown>>).entries()) {
      for (const k of ["id", "topic", "claim"]) {
        if (typeof a[k] !== "string" || (a[k] as string).length === 0) fail(`correctAdvice[${i}].${k} missing`);
      }
      if (ids.has(a.id as string)) fail(`duplicate claim id ${String(a.id)}`);
      ids.add(a.id as string);
    }
  }
  const minWords = typeof cfg.minWords === "number" ? cfg.minWords : 1200;
  // TEN-30: the time condition is a declared form parameter. Absent is the
  // shipped behaviour; present, it must be a real positive number of minutes,
  // because a sitting labelled with a nonsense budget is worse than one
  // labelled with none.
  // Whole minutes, at least one: 0.001 is a positive number and a zero-second
  // clock, which is a sitting nobody can run.
  const tb = cfg.timeBudgetMinutes;
  if (tb !== undefined && (typeof tb !== "number" || !Number.isInteger(tb) || tb < 1)) {
    fail("timeBudgetMinutes must be a whole number of minutes, 1 or more, when present");
  }
  const base: T3PresentationConfig = {
    title: cfg.title as string,
    brief: cfg.brief as string,
    sourceTitle: cfg.sourceTitle as string,
    sourceExcerpt: cfg.sourceExcerpt as string,
    minWords,
    ...(tb !== undefined ? { timeBudgetMinutes: tb as number } : {}),
    ...(hosted !== undefined ? { hosted: hosted as T3Hosted } : {}),
  };
  if (!secrets && cfg.plantedErrors === undefined) return base;
  const w = (cfg.weights ?? T3_DEFAULT_WEIGHTS) as Record<string, unknown>;
  for (const k of ["errorCatchRate", "adviceUptakeRate", "process", "analysis"] as const) {
    if (typeof w[k] !== "number" || (w[k] as number) < 0) fail(`weights.${k} must be a non-negative number`);
  }
  return {
    ...base,
    plantedErrors: cfg.plantedErrors as T3Config["plantedErrors"],
    correctAdvice: (cfg.correctAdvice ?? []) as T3Config["correctAdvice"],
    weights: {
      errorCatchRate: w.errorCatchRate as number,
      adviceUptakeRate: w.adviceUptakeRate as number,
      process: w.process as number,
      analysis: w.analysis as number,
    },
  };
}

/** The KEYED config: scoring and the static demo. Demands the whole key. */
export function validateT3Config(raw: unknown): T3Config {
  return validate(raw, true) as T3Config;
}

/**
 * The config the RUNNER validates, in both modes. A hosted sitting form has
 * no plant list at all, and demanding one would refuse the only scenario a
 * hosted candidate may be shown.
 */
export function validateT3PresentationConfig(raw: unknown): T3PresentationConfig {
  return validate(raw, false);
}

/**
 * The sitting clock a T3 form declares, in seconds, or undefined when it
 * declares none. The ONE conversion from the form parameter to a session
 * budget, so the condition a sitting ran under and the clock it was given
 * cannot disagree.
 */
export function t3TimeBudgetSeconds(cfg: T3PresentationConfig): number | undefined {
  const m = cfg.timeBudgetMinutes;
  return typeof m === "number" && m > 0 ? Math.round(m * 60) : undefined;
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

  /** Lazy UI loader (F11) — the platform must not hardcode track imports. */
  ui: () => import("./Runner.js").then((m) => ({ Runner: m.Runner })),
};

export type { T3Raw };
