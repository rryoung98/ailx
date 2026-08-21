/**
 * Track Runner registry — REAL track packages wired in.
 * Runners load through dynamic import (code splitting); scoring calls the
 * plugins' pure score() with deterministically stored demo judgments.
 */
import type { ComponentType } from "react";
import type { TrackUIProps } from "@ailx/core";
import type { TrackId, TrackScoreValue } from "@ailx/session";
import { t1Plugin } from "@ailx/track-t1";
import { plugin as t2Plugin, validateT2Config } from "@ailx/track-t2";
import { plugin as t3Plugin, validateT3Config } from "@ailx/track-t3";
import { t4Plugin } from "@ailx/track-t4";
import { demoScoreArtifact } from "./demo";
import { PlaceholderRunner } from "./PlaceholderRunner";
import { trackConfig } from "./instrument";
import { judgeT1, judgeT3, judgeT4 } from "./judging";

export interface TrackModule {
  Runner: ComponentType<TrackUIProps>;
  placeholder: boolean;
}

type Importer = () => Promise<{ Runner: ComponentType<TrackUIProps> }>;

const realImporters: Record<TrackId, Importer> = {
  t1: () => import("@ailx/track-t1"),
  t2: () => import("@ailx/track-t2"),
  t3: () => import("@ailx/track-t3"),
  t4: () => import("@ailx/track-t4"),
};

export async function loadTrackModule(trackId: TrackId): Promise<TrackModule> {
  try {
    const mod = await realImporters[trackId]();
    if (typeof mod.Runner === "function" || typeof mod.Runner === "object") {
      return { Runner: mod.Runner, placeholder: false };
    }
  } catch {
    // fall through
  }
  return { Runner: PlaceholderRunner, placeholder: true };
}

/**
 * Score a completed track through the REAL plugin's pure score().
 * Falls back to the seeded demo scorer on malformed artifacts (e.g. timeout
 * sentinel artifacts).
 */
export function scoreTrackArtifact(trackId: TrackId, artifact: unknown): TrackScoreValue {
  try {
    return scoreReal(trackId, artifact);
  } catch {
    return demoScoreArtifact(trackId, artifact);
  }
}

function scoreReal(trackId: TrackId, artifact: unknown): TrackScoreValue {
  const rubricVersion = `demo-${trackId}`;
  switch (trackId) {
    case "t1": {
      const a = artifact as Parameters<typeof judgeT1>[0];
      const cfg = t1Plugin.validateConfig(trackConfig("t1"));
      const s = t1Plugin.score({ artifact: a as never, judgments: judgeT1(a), rubricVersion }, cfg);
      return { raw: s.raw, scaled: s.scaled };
    }
    case "t2": {
      const cfg = validateT2Config(trackConfig("t2"));
      const s = t2Plugin.score({ artifact: artifact as never, judgments: [], rubricVersion }, cfg);
      return { raw: s.raw as unknown as Record<string, number>, scaled: s.scaled };
    }
    case "t3": {
      const a = artifact as Parameters<typeof judgeT3>[0];
      const cfg = validateT3Config(trackConfig("t3"));
      const s = t3Plugin.score({ artifact: a as never, judgments: judgeT3(a), rubricVersion }, cfg);
      return { raw: s.raw as unknown as Record<string, number>, scaled: s.scaled };
    }
    case "t4": {
      const a = artifact as Parameters<typeof judgeT4>[0];
      const cfg = t4Plugin.validateConfig(trackConfig("t4"));
      const s = t4Plugin.score({ artifact: a as never, judgments: judgeT4(a), rubricVersion }, cfg);
      return { raw: s.raw, scaled: s.scaled };
    }
  }
}
