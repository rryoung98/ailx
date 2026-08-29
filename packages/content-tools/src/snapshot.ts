import { writeFileSync } from "node:fs";
import { loadInstrument } from "./loader.js";
import { scorerRecordsIn, type ScorerRecord } from "./scorers.js";
import type { InstrumentPackage } from "./types.js";

export interface InstrumentSnapshot {
  /** Format marker for the static web app. */
  format: "ailx-instrument-snapshot@1";
  generated_by: "@ailx/content-tools build-snapshot";
  instrument: InstrumentPackage;
  /**
   * Build-time content address of each track's score() SOURCE closure. This
   * is the audit digest the platform persists with a score; it identifies the
   * scoring code, never the bundle (FRONTEND.md §2.1). Absent only for a
   * snapshot built without a `tracksRoot`.
   */
  scorers?: ScorerRecord[];
}

/** Build the whole validated instrument as one JSON value (no YAML at runtime). */
export function buildSnapshot(
  instrumentDir: string,
  tracksRoot?: string,
): InstrumentSnapshot {
  const snap: InstrumentSnapshot = {
    format: "ailx-instrument-snapshot@1",
    generated_by: "@ailx/content-tools build-snapshot",
    instrument: loadInstrument(instrumentDir),
  };
  if (tracksRoot) snap.scorers = scorerRecordsIn(tracksRoot);
  return snap;
}

export function writeSnapshot(
  instrumentDir: string,
  outPath: string,
  tracksRoot?: string,
): InstrumentSnapshot {
  const snap = buildSnapshot(instrumentDir, tracksRoot);
  writeFileSync(outPath, JSON.stringify(snap, null, 2) + "\n");
  return snap;
}
