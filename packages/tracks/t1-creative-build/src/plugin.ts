import type {
  ScoreInputs,
  StageSpec,
  TrackCtx,
  TrackPlugin,
  Upload,
} from "@ailx/core";
import { scoreT1 } from "./score.js";
import type {
  PromptLogEntry,
  T1Artifact,
  T1Config,
  T1Score,
  T1Session,
} from "./types.js";

export const T1_TRACK_ID = "t1-creative-build";

const DEFAULT_CONFIG: T1Config = {
  brief:
    "Build a personal site that communicates who you are and what you work " +
    "on, to a stated audience. AI assistance is unrestricted and expected — " +
    "the prompt log is a required submission artefact, not a confession.",
  requiredElements: ["name", "what you work on", "contact route"],
  selfReportMaxChars: 1600, // ~200 words
};

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export const t1Plugin: TrackPlugin<T1Config, T1Session, T1Artifact, T1Score> = {
  id: T1_TRACK_ID,
  apiVersion: 2,

  validateConfig(raw: unknown): T1Config {
    if (raw === null || raw === undefined) return { ...DEFAULT_CONFIG };
    if (typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("t1 config must be an object");
    }
    const r = raw as Record<string, unknown>;
    const cfg: T1Config = { ...DEFAULT_CONFIG };
    if (r.brief !== undefined) {
      if (typeof r.brief !== "string" || r.brief.length === 0) {
        throw new Error("t1 config.brief must be a non-empty string");
      }
      cfg.brief = r.brief;
    }
    if (r.requiredElements !== undefined) {
      if (!isStringArray(r.requiredElements)) {
        throw new Error("t1 config.requiredElements must be string[]");
      }
      cfg.requiredElements = r.requiredElements;
    }
    if (r.selfReportMaxChars !== undefined) {
      if (
        typeof r.selfReportMaxChars !== "number" ||
        !Number.isInteger(r.selfReportMaxChars) ||
        r.selfReportMaxChars <= 0
      ) {
        throw new Error("t1 config.selfReportMaxChars must be a positive integer");
      }
      cfg.selfReportMaxChars = r.selfReportMaxChars;
    }
    return cfg;
  },

  async startSession(ctx: TrackCtx, _cfg: T1Config): Promise<T1Session> {
    return { attemptId: ctx.attemptId, trackId: T1_TRACK_ID };
  },

  /** Idempotent: same payload -> same artifact. */
  async ingest(
    _ctx: TrackCtx,
    _s: T1Session,
    payload: Upload,
  ): Promise<T1Artifact> {
    const j = payload.json as Partial<T1Artifact> | undefined;
    if (!j || typeof j.html !== "string" || j.html.length === 0) {
      throw new Error("t1 artifact requires non-empty html");
    }
    const promptLog: PromptLogEntry[] = Array.isArray(j.promptLog)
      ? j.promptLog.filter(
          (e): e is PromptLogEntry =>
            !!e &&
            (e.kind === "prompted" || e.kind === "revised") &&
            typeof e.clientTs === "string",
        )
      : [];
    return {
      html: j.html,
      promptLog,
      selfReport: typeof j.selfReport === "string" ? j.selfReport : "",
    };
  },

  /** Async stages the platform enqueues — data, not code (spec §14). */
  pipeline(_cfg: T1Config): StageSpec[] {
    return [
      { id: "capture", queue: "screenshot", maxAttempts: 3 },
      { id: "judge-t1-screening", queue: "judge", maxAttempts: 3 },
      { id: "pairwise-comparative", queue: "human-cj", maxAttempts: 1 },
      { id: "aggregate", queue: "aggregate", maxAttempts: 3 },
    ];
  },

  /** PURE — see score.ts. */
  score(inputs: ScoreInputs<T1Artifact>, cfg: T1Config): T1Score {
    return scoreT1(inputs, cfg);
  },

  /** Lazy UI loader (F11) — the platform must not hardcode track imports. */
  ui: () => import("./Runner.js").then((m) => ({ Runner: m.Runner })),
};
