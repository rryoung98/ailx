/**
 * Track Runner registry.
 *
 * The four track packages (@ailx/track-t1..t4) are built in parallel branches
 * and are NOT present in this worktree. Each importer below is therefore
 * `null`, and the registry falls back to the bundled Placeholder runner and
 * the deterministic demo scorer, so this branch builds and runs standalone.
 *
 * AT MERGE: flip each importer to the real dynamic import, e.g.
 *   t1: () => import("@ailx/track-t1"),
 * and (optionally) route scoreArtifact through the plugin's pure score().
 */

import type { ComponentType } from "react";
import type { TrackUIProps } from "@ailx/core";
import type { TrackId, TrackScoreValue } from "@ailx/session";
import { demoScoreArtifact } from "./demo";
import { PlaceholderRunner } from "./PlaceholderRunner";

export interface TrackModule {
  Runner: ComponentType<TrackUIProps>;
  /** True when this is the bundled placeholder, not the real track package. */
  placeholder: boolean;
}

type Importer = () => Promise<{ Runner: ComponentType<TrackUIProps> }>;

/** MERGE POINT — flip these to real imports when the track packages land. */
const realImporters: Record<TrackId, Importer | null> = {
  t1: null, // () => import("@ailx/track-t1")
  t2: null, // () => import("@ailx/track-t2")
  t3: null, // () => import("@ailx/track-t3")
  t4: null, // () => import("@ailx/track-t4")
};

export async function loadTrackModule(trackId: TrackId): Promise<TrackModule> {
  const importer = realImporters[trackId];
  if (importer) {
    try {
      const mod = await importer();
      if (typeof mod.Runner === "function" || typeof mod.Runner === "object") {
        return { Runner: mod.Runner, placeholder: false };
      }
    } catch {
      // fall through to placeholder: track module not yet installed
    }
  }
  return { Runner: PlaceholderRunner, placeholder: true };
}

/**
 * Score a completed track's artifact. PURE (demo scorer is sha256-seeded).
 * At merge this can delegate to the real plugin's score() with stored
 * demo-judge judgments as inputs.
 */
export function scoreTrackArtifact(trackId: TrackId, artifact: unknown): TrackScoreValue {
  return demoScoreArtifact(trackId, artifact);
}
