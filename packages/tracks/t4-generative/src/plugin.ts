import type {
  ScoreInputs,
  StageSpec,
  TrackCtx,
  TrackPlugin,
  Upload,
} from "@ailx/core";
import { scoreT4 } from "./score.js";
import type {
  T4Artifact,
  T4Config,
  T4Generation,
  T4Score,
  T4Session,
} from "./types.js";

export const T4_TRACK_ID = "t4-generative";

const DEFAULT_CONFIG: T4Config = {
  brief:
    "Produce a visual that makes the viewer understand: cooperation between " +
    "three nations, weathering a storm together. The viewer should read " +
    "resilience, not decoration.",
  audience: "Summit delegates seeing the gallery without any caption.",
  maxGenerations: 6,
  noteMaxChars: 1200,
};

export const t4Plugin: TrackPlugin<T4Config, T4Session, T4Artifact, T4Score> = {
  id: T4_TRACK_ID,
  apiVersion: 2,

  validateConfig(raw: unknown): T4Config {
    if (raw === null || raw === undefined) return { ...DEFAULT_CONFIG };
    if (typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("t4 config must be an object");
    }
    const r = raw as Record<string, unknown>;
    const cfg: T4Config = { ...DEFAULT_CONFIG };
    if (r.brief !== undefined) {
      if (typeof r.brief !== "string" || r.brief.length === 0) {
        throw new Error("t4 config.brief must be a non-empty string");
      }
      cfg.brief = r.brief;
    }
    if (r.audience !== undefined) {
      if (typeof r.audience !== "string") {
        throw new Error("t4 config.audience must be a string");
      }
      cfg.audience = r.audience;
    }
    if (r.maxGenerations !== undefined) {
      if (
        typeof r.maxGenerations !== "number" ||
        !Number.isInteger(r.maxGenerations) ||
        r.maxGenerations < 1 ||
        r.maxGenerations > 50
      ) {
        throw new Error("t4 config.maxGenerations must be an integer in [1,50]");
      }
      cfg.maxGenerations = r.maxGenerations;
    }
    if (r.noteMaxChars !== undefined) {
      if (
        typeof r.noteMaxChars !== "number" ||
        !Number.isInteger(r.noteMaxChars) ||
        r.noteMaxChars <= 0
      ) {
        throw new Error("t4 config.noteMaxChars must be a positive integer");
      }
      cfg.noteMaxChars = r.noteMaxChars;
    }
    return cfg;
  },

  async startSession(ctx: TrackCtx, _cfg: T4Config): Promise<T4Session> {
    return { attemptId: ctx.attemptId, trackId: T4_TRACK_ID };
  },

  /** Idempotent: same payload -> same artifact. */
  async ingest(
    _ctx: TrackCtx,
    _s: T4Session,
    payload: Upload,
  ): Promise<T4Artifact> {
    const j = payload.json as Partial<T4Artifact> | undefined;
    if (!j || !Array.isArray(j.generations) || j.generations.length === 0) {
      throw new Error("t4 artifact requires at least one generation");
    }
    const generations: T4Generation[] = j.generations.map((g, i) => {
      if (!g || typeof g.prompt !== "string" || typeof g.svg !== "string") {
        throw new Error(`t4 generation ${i} malformed`);
      }
      return {
        index: i,
        prompt: g.prompt,
        svg: g.svg,
        clientTs: typeof g.clientTs === "string" ? g.clientTs : "",
      };
    });
    const chosenIndex =
      typeof j.chosenIndex === "number" &&
      Number.isInteger(j.chosenIndex) &&
      j.chosenIndex >= 0 &&
      j.chosenIndex < generations.length
        ? j.chosenIndex
        : generations.length - 1;
    return {
      generations,
      chosenIndex,
      note: typeof j.note === "string" ? j.note : "",
    };
  },

  /** Async stages the platform enqueues — data, not code (spec §14). */
  pipeline(_cfg: T4Config): StageSpec[] {
    return [
      { id: "safety-pass", queue: "safety", maxAttempts: 3 },
      { id: "judge-t4-generations", queue: "judge", maxAttempts: 3 },
      { id: "judge-t4-brief-fit", queue: "judge", maxAttempts: 3 },
      { id: "pairwise-comparative", queue: "human-cj", maxAttempts: 1 },
      { id: "aggregate", queue: "aggregate", maxAttempts: 3 },
    ];
  },

  /** PURE — see score.ts. */
  score(inputs: ScoreInputs<T4Artifact>, cfg: T4Config): T4Score {
    return scoreT4(inputs, cfg);
  },
};
