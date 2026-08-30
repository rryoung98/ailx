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

export interface SnapshotOptions {
  /** Directory holding the track packages; adds the score() source digests. */
  tracksRoot?: string;
  /**
   * Build a snapshot a BROWSER may hold: drops every item's `provenance`
   * record.
   *
   * The released-practice tier publishes its keys on purpose, but provenance
   * is a different kind of byte: it records how an item was made, with which
   * model and prompt, and — for the translated ja/ko items — the `source_item`
   * id of the OPERATIONAL item it was translated from. Shipping that enumerates
   * a bank the candidate is not supposed to be able to enumerate
   * (docs/ARCHITECTURE.md §4). Nothing in the browser reads it.
   *
   * The operational snapshot keeps provenance: it never leaves the server, and
   * provenance is audit material.
   */
  public?: boolean;
}

/** Build the whole validated instrument as one JSON value (no YAML at runtime). */
export function buildSnapshot(
  instrumentDir: string,
  options: SnapshotOptions = {},
): InstrumentSnapshot {
  const instrument = loadInstrument(instrumentDir);
  const snap: InstrumentSnapshot = {
    format: "ailx-instrument-snapshot@1",
    generated_by: "@ailx/content-tools build-snapshot",
    instrument: options.public === true ? withoutProvenance(instrument) : instrument,
  };
  if (options.tracksRoot) snap.scorers = scorerRecordsIn(options.tracksRoot);
  return snap;
}

/** Strip `provenance` from every bank item, leaving the rest byte-identical. */
function withoutProvenance(instrument: InstrumentPackage): InstrumentPackage {
  return {
    ...instrument,
    tracks: instrument.tracks.map((track) =>
      track.bank === undefined
        ? track
        : {
            ...track,
            bank: {
              ...track.bank,
              items: track.bank.items.map(({ provenance: _dropped, ...rest }) => rest),
            },
          },
    ),
  };
}

export function writeSnapshot(
  instrumentDir: string,
  outPath: string,
  options: SnapshotOptions = {},
): InstrumentSnapshot {
  const snap = buildSnapshot(instrumentDir, options);
  writeFileSync(outPath, JSON.stringify(snap, null, 2) + "\n");
  return snap;
}
