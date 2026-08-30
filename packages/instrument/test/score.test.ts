/**
 * `scoreTrack` — the server-issued score.
 *
 * The property under test is not "it returns a number": it is that the number
 * is byte-identically what the PURE plugin produces over the same keyed
 * config, and that the config itself never rides along in the result.
 */
import { describe, expect, it } from "vitest";
import { plugin as t2Plugin, validateT2Config } from "@ailx/track-t2";
import {
  fromSnapshot,
  openDemoInstrument,
  type DeckRecord,
  type Instrument,
} from "../src/index.js";

const ATTEMPT = "11111111-2222-3333-4444-555555555555";
const demo: Instrument = openDemoInstrument();
const deck: DeckRecord = demo.sampleDecks(ATTEMPT, "en")[0]!;

/** A plausible sitting: every item answered with option 0 at 70% confidence. */
const artifact = {
  responses: deck.itemIds.map((itemId) => ({ itemId, choice: 0, confidence: 70, latencyMs: 1200 })),
};

describe("scoreTrack", () => {
  it("matches the pure plugin run over the same config", () => {
    const rubricVersion = demo.rubricVersion("t2");
    const cfg = validateT2Config(demo.scoringConfig("t2", deck, "en"));
    const pure = t2Plugin.score({ artifact: artifact as never, judgments: [], rubricVersion }, cfg);

    const got = demo.scoreTrack("t2", deck, artifact, "en");
    expect(got.score.raw).toEqual(pure.raw);
    expect(got.score.scaled).toBe(pure.scaled);
    expect(got.rubricVersion).toBe(rubricVersion);
    expect(got.scoringDigest).toBe(demo.scoringDigest("t2"));
  });

  it("is pure: the same inputs re-derive the same score", () => {
    expect(demo.scoreTrack("t2", deck, artifact, "en")).toEqual(
      demo.scoreTrack("t2", deck, artifact, "en"),
    );
  });

  it("scores an ABSENT deck against the locale's default deck rather than failing", () => {
    // The static/demo path has no recorded deck. It still gets a real score;
    // the hosted handler is the layer that insists on a recorded deck.
    const got = demo.scoreTrack("t2", undefined, artifact, "en");
    expect(typeof got.score.scaled).toBe("number");
  });

  it("refuses any track but t2 — a judged track has no bank-side score", () => {
    for (const t of ["t1", "t3", "t4"] as const) {
      expect(() => demo.scoreTrack(t, deck, artifact, "en")).toThrow(/not scored/);
    }
  });

  it("refuses a malformed artifact instead of throwing from inside scoreT2", () => {
    for (const bad of [undefined, null, 42, "responses", {}, { responses: "nope" }]) {
      expect(() => demo.scoreTrack("t2", deck, bad, "en")).toThrow(/responses/);
    }
  });

  it("tolerates an empty response set — a walked-out sitting is still scorable", () => {
    expect(demo.scoreTrack("t2", deck, { responses: [] }, "en").score.scaled).toBe(0);
  });

  it("returns EXACTLY score/rubricVersion/scoringDigest — no key, no item text", () => {
    const got = demo.scoreTrack("t2", deck, artifact, "en");
    expect(Object.keys(got).sort()).toEqual(["rubricVersion", "score", "scoringDigest"]);
    expect(Object.keys(got.score).sort()).toEqual(["raw", "scaled"]);
    const wire = JSON.stringify(got);
    expect(wire).not.toContain('"key"');
    expect(wire).not.toContain('"rationale"');
    expect(wire).not.toContain('"items"');
    // No item id, stem or material text survives into the score.
    for (const id of deck.itemIds) expect(wire).not.toContain(id);
  });
});

describe("scoreTrack — a snapshot with no scorers[]", () => {
  it("refuses to issue a score the platform cannot audit", async () => {
    const { readFileSync } = await import("node:fs");
    const { DEMO_SNAPSHOT } = await import("../src/index.js");
    const snap = JSON.parse(readFileSync(DEMO_SNAPSHOT, "utf8")) as Record<string, unknown>;
    delete snap.scorers;
    const inst = fromSnapshot(snap as never, { released: true });
    expect(() => inst.scoreTrack("t2", deck, artifact, "en")).toThrow(/scoring digest/);
  });
});
