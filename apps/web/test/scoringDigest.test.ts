/**
 * The audit digest is the instrument's, not the bundle's.
 *
 * `scoringDigest()` used to hash `Function.prototype.toString()` of whatever
 * the bundler emitted, so a minifier bump moved it with no source change.
 * It now returns the build-time content address of the score() source closure
 * carried in the committed snapshot, which a third party can re-derive from a
 * git checkout with `pnpm --filter @ailx/content-tools run snapshot:2026.1`.
 */
import { describe, expect, it } from "vitest";
import { TRACK_IDS } from "@ailx/session";
import SNAPSHOT from "../../../instruments/2026.1/snapshot.json";
import { scoringDigest } from "../lib/registry";

const scorers = (SNAPSHOT as { scorers?: Array<{ trackId: string; digest: string; sources: Array<{ path: string }> }> }).scorers;

describe("scoring digest", () => {
  it("is carried by the committed instrument snapshot for every track", () => {
    expect(scorers?.map((s) => s.trackId)).toEqual([...TRACK_IDS]);
  });

  it("returns the snapshot digest, unchanged by anything in the browser", () => {
    for (const t of TRACK_IDS) {
      const s = scorers?.find((x) => x.trackId === t);
      expect(scoringDigest(t)).toBe(s?.digest);
      expect(scoringDigest(t)).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("is distinct per track and stable across calls", () => {
    const once = TRACK_IDS.map((t) => scoringDigest(t));
    expect(new Set(once).size).toBe(TRACK_IDS.length);
    expect(TRACK_IDS.map((t) => scoringDigest(t))).toEqual(once);
  });

  it("addresses source files, not bundled function text", () => {
    for (const s of scorers ?? []) {
      expect(s.sources.length).toBeGreaterThan(0);
      for (const f of s.sources) expect(f.path).toMatch(/^src\/.+\.tsx?$/);
    }
  });
});
