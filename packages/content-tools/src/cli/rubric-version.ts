#!/usr/bin/env node
/**
 * rubric-version <instrument-dir>
 * Computes rubric_version = hash(rubric.yaml + prompts) per track.
 */
import { loadInstrument } from "../loader.js";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: rubric-version <instrument-dir>");
  process.exit(2);
}
const pkg = loadInstrument(dir);
for (const t of pkg.tracks) {
  console.log(`${t.trackId}  rubric_version=${t.rubricVersion}  prompts=${t.prompts.length}`);
}
