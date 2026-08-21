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
  T4Draft,
  T4Final,
  T4Score,
  T4Session,
} from "./types.js";

export const T4_TRACK_ID = "t4-generative";

const DEFAULT_CONFIG: T4Config = {
  brief:
    "Produce a visual set that makes the viewer understand: cooperation " +
    "between three nations, weathering a storm together. The viewer should " +
    "read resilience, not decoration.",
  audience: "Summit delegates seeing the gallery without any caption.",
  // Spec §T4: drafts unlimited; finals hard-limited to 3 images + 1 video.
  finalImageQuota: 3,
  finalVideoQuota: 1,
  noteMaxChars: 1200,
};

function intInRange(v: unknown, lo: number, hi: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
}

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
    if (r.finalImageQuota !== undefined) {
      if (!intInRange(r.finalImageQuota, 1, 10)) {
        throw new Error("t4 config.finalImageQuota must be an integer in [1,10]");
      }
      cfg.finalImageQuota = r.finalImageQuota;
    }
    if (r.finalVideoQuota !== undefined) {
      if (!intInRange(r.finalVideoQuota, 0, 3)) {
        throw new Error("t4 config.finalVideoQuota must be an integer in [0,3]");
      }
      cfg.finalVideoQuota = r.finalVideoQuota;
    }
    if (r.noteMaxChars !== undefined) {
      if (!intInRange(r.noteMaxChars, 1, 100000)) {
        throw new Error("t4 config.noteMaxChars must be a positive integer");
      }
      cfg.noteMaxChars = r.noteMaxChars;
    }
    return cfg;
  },

  async startSession(ctx: TrackCtx, _cfg: T4Config): Promise<T4Session> {
    return { attemptId: ctx.attemptId, trackId: T4_TRACK_ID };
  },

  /** Idempotent: same payload -> same artifact. Enforces the final quotas. */
  async ingest(
    _ctx: TrackCtx,
    _s: T4Session,
    payload: Upload,
  ): Promise<T4Artifact> {
    const cfg = DEFAULT_CONFIG;
    const j = payload.json as Partial<T4Artifact> | undefined;
    if (!j || !Array.isArray(j.drafts) || j.drafts.length === 0) {
      throw new Error("t4 artifact requires at least one draft");
    }
    const drafts: T4Draft[] = j.drafts.map((d, i) => {
      // A draft carries EITHER an svg (demo/legacy) OR a dataUri (real model).
      if (
        !d ||
        typeof d.prompt !== "string" ||
        (typeof d.svg !== "string" && typeof d.dataUri !== "string")
      ) {
        throw new Error(`t4 draft ${i} malformed`);
      }
      return {
        index: i,
        prompt: d.prompt,
        ...(typeof d.svg === "string" ? { svg: d.svg } : {}),
        ...(typeof d.dataUri === "string" ? { dataUri: d.dataUri } : {}),
        ...(typeof d.modelId === "string" ? { modelId: d.modelId } : {}),
        clientTs: typeof d.clientTs === "string" ? d.clientTs : "",
      };
    });
    const finalsRaw = (j.finals ?? {}) as Partial<T4Artifact["finals"]>;
    const parseFinal = (f: unknown, where: string, kind: "image" | "video"): T4Final => {
      const v = f as Partial<T4Final> | undefined;
      if (
        !v ||
        v.kind !== kind ||
        typeof v.prompt !== "string" ||
        // A final carries EITHER svg markup (asset) OR a real-model dataUri.
        (typeof v.asset !== "string" && typeof v.dataUri !== "string") ||
        typeof v.fromDraftIndex !== "number" ||
        !Number.isInteger(v.fromDraftIndex) ||
        v.fromDraftIndex < 0 ||
        v.fromDraftIndex >= drafts.length
      ) {
        throw new Error(`t4 final ${where} malformed`);
      }
      return {
        kind,
        fromDraftIndex: v.fromDraftIndex,
        prompt: v.prompt,
        ...(typeof v.asset === "string" ? { asset: v.asset } : {}),
        ...(typeof v.dataUri === "string" ? { dataUri: v.dataUri } : {}),
        ...(typeof v.modelId === "string" ? { modelId: v.modelId } : {}),
        clientTs: typeof v.clientTs === "string" ? v.clientTs : "",
      };
    };
    const imagesRaw = Array.isArray(finalsRaw.images) ? finalsRaw.images : [];
    if (imagesRaw.length > cfg.finalImageQuota) {
      throw new Error(
        `t4 finals.images exceeds the hard quota of ${cfg.finalImageQuota}`,
      );
    }
    const images = imagesRaw.map((f, i) => parseFinal(f, `images[${i}]`, "image"));
    const video =
      finalsRaw.video !== undefined && finalsRaw.video !== null
        ? parseFinal(finalsRaw.video, "video", "video")
        : undefined;
    if (video && cfg.finalVideoQuota < 1) {
      throw new Error("t4 finals.video exceeds the hard quota of 0");
    }
    const chosenSet = (Array.isArray(j.chosenSet) ? j.chosenSet : [])
      .filter(
        (i): i is number =>
          typeof i === "number" && Number.isInteger(i) && i >= 0 && i < images.length,
      )
      .filter((v, i, a) => a.indexOf(v) === i);
    return {
      drafts,
      finals: video ? { images, video } : { images },
      chosenSet: chosenSet.length > 0 ? chosenSet : images.map((_, i) => i),
      note: typeof j.note === "string" ? j.note : "",
      disclosed: j.disclosed === true,
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

  /** Lazy UI loader (F11) — the platform must not hardcode track imports. */
  ui: () => import("./Runner.js").then((m) => ({ Runner: m.Runner })),
};
