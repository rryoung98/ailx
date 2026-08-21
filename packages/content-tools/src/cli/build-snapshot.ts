#!/usr/bin/env node
/**
 * build-snapshot <instrument-dir> [out.json]
 * Validates the instrument and writes it as one JSON snapshot so the static
 * web app can import it without YAML parsing at runtime.
 */
import { join } from "node:path";
import { writeSnapshot } from "../snapshot.js";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: build-snapshot <instrument-dir> [out.json]");
  process.exit(2);
}
const out = process.argv[3] ?? join(dir, "snapshot.json");
const snap = writeSnapshot(dir, out);
console.log(
  `wrote ${out}: ${snap.instrument.manifest.id}@${snap.instrument.manifest.version}, ` +
  `${snap.instrument.tracks.length} tracks`,
);
