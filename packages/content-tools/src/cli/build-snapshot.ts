#!/usr/bin/env node
/**
 * build-snapshot <instrument-dir> [out.json] [--scorers <tracks-root-dir>]
 * Validates the instrument and writes it as one JSON snapshot so the static
 * web app can import it without YAML parsing at runtime. `--scorers` points at
 * the directory holding the track packages and adds the build-time content
 * address of every declared score() source closure.
 */
import { join } from "node:path";
import { writeSnapshot } from "../snapshot.js";

const argv = process.argv.slice(2);
const cut = argv.indexOf("--scorers");
const positional = cut === -1 ? argv : argv.slice(0, cut);
const tracksRoot = cut === -1 ? undefined : argv[cut + 1];
if (cut !== -1 && !tracksRoot) {
  console.error("--scorers needs a directory of track packages");
  process.exit(2);
}

const dir = positional[0];
if (!dir) {
  console.error("usage: build-snapshot <instrument-dir> [out.json] [--scorers <tracks-root-dir>]");
  process.exit(2);
}
const out = positional[1] ?? join(dir, "snapshot.json");
const snap = writeSnapshot(dir, out, tracksRoot);
console.log(
  `wrote ${out}: ${snap.instrument.manifest.id}@${snap.instrument.manifest.version}, ` +
  `${snap.instrument.tracks.length} tracks, ${snap.scorers?.length ?? 0} scorer digests`,
);
