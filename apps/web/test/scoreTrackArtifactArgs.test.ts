/**
 * TEN-260: which KEY the scorer reads, pinned.
 *
 * `scoreTrackArtifact(trackId, artifact, attemptId)` passed its third
 * argument straight into `scoreTrack`'s THIRD parameter, which is the
 * `locale`, not the attemptId. Both are strings, so nothing complained and
 * the deck the candidate actually sat (T2 rotates per attempt) was scored
 * against the default deck: every rotated item counts as a lapse.
 *
 * The two functions now have shapes that cannot be confused — the options
 * come by NAME — and this test reads the one observable difference the mix-up
 * produced.
 */
import { describe, expect, it } from "vitest";
import { scoreTrack, scoreTrackArtifact } from "../lib/instrument/registry";
import { trackConfig } from "../lib/instrument/instrument";

interface Item { id: string; key: number }

const ATTEMPT = "att-rotation-repro";

/** Every item of the deck THIS attempt was dealt, answered correctly. */
function perfectArtifact(attemptId?: string) {
  const cfg = trackConfig("t2", "en", attemptId) as { items: Item[] };
  return {
    responses: cfg.items.map((i) => ({
      itemId: i.id,
      choice: i.key,
      confidence: 90,
      latencyMs: 1500,
    })),
  };
}

describe("scoreTrackArtifact names its arguments", () => {
  it("scores against the attempt's own deck, not a deck named by a locale", () => {
    const artifact = perfectArtifact(ATTEMPT);
    const named = scoreTrackArtifact("t2", artifact, { attemptId: ATTEMPT });
    expect(named).toEqual(scoreTrack("t2", artifact, "en", ATTEMPT).score);
    // Non-vacuous: the default deck is a DIFFERENT population, so a run
    // scored without the attemptId must not silently agree.
    expect(scoreTrackArtifact("t2", artifact).scaled).toBeLessThan(named.scaled);
  });

  it("carries the locale under its own name", () => {
    const artifact = perfectArtifact();
    expect(scoreTrackArtifact("t2", artifact, { locale: "en" })).toEqual(
      scoreTrack("t2", artifact, "en").score,
    );
  });
});
