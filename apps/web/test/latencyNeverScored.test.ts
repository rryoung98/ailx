/**
 * THE LATENCY GUARD, behavioural half: move every stored timing, get the
 * same score.
 *
 * The static half (`packages/content-tools/test/latencyNeverScored.test.ts`)
 * reads the score() import closure and refuses a timing read. This half asks
 * the question the way an auditor would: score a real artifact, then score a
 * copy in which every latency and every client timestamp has moved, and
 * demand byte-identical output. It covers what a text scan cannot — a timing
 * quantity reached through a renamed field, and the demo judges, which see
 * the same artifact the scorer does.
 *
 * The perturbation sizes are not arbitrary. Nicosia et al. (Behavior Research
 * Methods 2023;55(6):2800-2812, DOI 10.3758/s13428-022-01925-1) measured
 * total device latency from 35 ms to 140 ms across 26 smartphones and put the
 * spread across a full bring-your-own-device study at about 105 ms, with the
 * cheaper phones slower. 105 ms is therefore the device-effect step, and the
 * larger shifts stand in for a slow network and a wrong device clock.
 * docs/SAMPLING.md §6.1.
 */
import { describe, expect, it } from "vitest";
import { canonicalJson } from "@ailx/session";
import type { TrackId } from "@ailx/session";
import { fixtureArtifact } from "../lib/sampleAttempt";
import { scoreTrackArtifact } from "../lib/registry";

const TRACKS: TrackId[] = ["t1", "t2", "t3", "t4"];

/** Numeric millisecond fields, and the ISO stamp every track records. */
const NUMERIC_TIMING = new Set(["latencyMs", "activeMs", "durationMs", "elapsedMs"]);
const ISO_TIMING = new Set(["clientTs"]);

/** Every timing value moved by `ms`; everything else copied unchanged. */
function shiftTimings<T>(value: T, ms: number): T {
  if (Array.isArray(value)) return value.map((v) => shiftTimings(v, ms)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (NUMERIC_TIMING.has(k) && typeof v === "number") out[k] = Math.max(0, v + ms);
      else if (ISO_TIMING.has(k) && typeof v === "string" && v !== "") {
        out[k] = new Date(Date.parse(v) + ms).toISOString();
      } else out[k] = shiftTimings(v, ms);
    }
    return out as T;
  }
  return value;
}

/** How many timing values a shift actually touched — a guard on the guard. */
function countTimings(value: unknown): number {
  if (Array.isArray(value)) return value.reduce<number>((n, v) => n + countTimings(v), 0);
  if (value && typeof value === "object") {
    let n = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if ((NUMERIC_TIMING.has(k) && typeof v === "number") || (ISO_TIMING.has(k) && typeof v === "string" && v !== "")) n++;
      else n += countTimings(v);
    }
    return n;
  }
  return 0;
}

/** 105 ms is the BYOD device spread; the rest are slow networks and bad clocks. */
const SHIFTS = [105, -105, 2_000, 600_000, -600_000];

describe("no track score moves when the stored timings move", () => {
  for (const trackId of TRACKS) {
    const artifact = fixtureArtifact(trackId);

    it(`${trackId}: the fixture actually carries timings (or this test proves nothing)`, () => {
      expect(countTimings(artifact)).toBeGreaterThan(0);
    });

    it(`${trackId}: the score is byte-identical under every timing shift`, () => {
      const baseline = canonicalJson(scoreTrackArtifact(trackId, artifact));
      expect(baseline).not.toContain("invalid");
      for (const ms of SHIFTS) {
        const moved = shiftTimings(artifact, ms);
        expect(canonicalJson(moved), `shift ${ms}ms changed nothing`).not.toBe(canonicalJson(artifact));
        expect(
          canonicalJson(scoreTrackArtifact(trackId, moved)),
          `${trackId} score moved under a ${ms}ms timing shift`,
        ).toBe(baseline);
      }
    });
  }

  it("the shift helper moves what it claims to move, and nothing else", () => {
    const before = { latencyMs: 900, clientTs: "2026-01-01T00:00:00.000Z", choice: 1, nested: [{ latencyMs: 0 }] };
    const after = shiftTimings(before, 105);
    expect(after.latencyMs).toBe(1005);
    expect(after.clientTs).toBe("2026-01-01T00:00:00.105Z");
    expect(after.choice).toBe(1);
    expect(after.nested[0].latencyMs).toBe(105);
    // A latency can never go negative, and a big negative shift floors at 0.
    expect(shiftTimings(before, -10_000).latencyMs).toBe(0);
    expect(countTimings(before)).toBe(3);
  });
});
