import { writeFileSync } from "node:fs";
import { loadInstrument } from "./loader.js";
import type { InstrumentPackage } from "./types.js";

export interface InstrumentSnapshot {
  /** Format marker for the static web app. */
  format: "ailx-instrument-snapshot@1";
  generated_by: "@ailx/content-tools build-snapshot";
  instrument: InstrumentPackage;
}

/** Build the whole validated instrument as one JSON value (no YAML at runtime). */
export function buildSnapshot(instrumentDir: string): InstrumentSnapshot {
  return {
    format: "ailx-instrument-snapshot@1",
    generated_by: "@ailx/content-tools build-snapshot",
    instrument: loadInstrument(instrumentDir),
  };
}

export function writeSnapshot(instrumentDir: string, outPath: string): InstrumentSnapshot {
  const snap = buildSnapshot(instrumentDir);
  writeFileSync(outPath, JSON.stringify(snap, null, 2) + "\n");
  return snap;
}
