/**
 * The share payload is a PRIVACY BOUNDARY, so it is asserted as an exact
 * serialized object, not with `toMatchObject`. If a field is ever added to
 * the report derivation, this test fails until someone decides, explicitly,
 * whether it may leave the account.
 */
import { describe, expect, it } from "vitest";
import { TRACK_IDS, type TrackRawScores } from "@ailx/session";
import {
  SHARE_PAYLOAD_VERSION,
  parseSharePayload,
  shareCardLines,
  sharePayloadFrom,
  buildSharePayload,
} from "../src/share.js";
import { playerType } from "../src/playerType.js";

const shape = (v: number[]): TrackRawScores => ({ t1: v[0], t2: v[1], t3: v[2], t4: v[3] });

const HIGH = shape([88.24, 79.5, 71.06, 66.9]);

describe("sharePayloadFrom", () => {
  it("serializes exactly the allowlisted fields, nothing else", () => {
    const payload = sharePayloadFrom(HIGH, "Distinction", { instrument: "ailx 2026.1" });
    expect(payload).toEqual({
      v: 1,
      instrument: "ailx 2026.1",
      band: "Distinction",
      playerType: {
        code: playerType(HIGH).code,
        name: playerType(HIGH).name,
        tagline: playerType(HIGH).tagline,
        poles: playerType(HIGH).poles.map((p) => ({
          track: p.track,
          letter: p.letter,
          label: p.label,
          high: p.high,
        })),
      },
      tracks: { t1: 88.2, t2: 79.5, t3: 71.1, t4: 66.9 },
      site: null,
    });
    expect(Object.keys(payload).sort()).toEqual(
      ["band", "instrument", "playerType", "site", "tracks", "v"],
    );
  });

  it("never carries item-level, response-level or identity data (exam integrity)", () => {
    const json = JSON.stringify(sharePayloadFrom(HIGH, "Merit", { instrument: "ailx 2026.1" }));
    for (const forbidden of [
      "itemId", "item_id", "items", "deck", "bank", "answer", "correct", "confidence",
      "responses", "log", "events", "attemptId", "participant", "authRef", "locale",
      "composite", "percentile", "judgments", "rubricVersion", "scoringDigest",
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("carries the site path only when the caller opted in", () => {
    expect(sharePayloadFrom(HIGH, "Pass", { instrument: "i" }).site).toBeNull();
    expect(
      sharePayloadFrom(HIGH, "Pass", { instrument: "i", site: "/api/site/abc/index.html" }).site,
    ).toBe("/api/site/abc/index.html");
  });

  it("rounds the track shape to one decimal and keeps all four tracks", () => {
    const p = sharePayloadFrom(shape([0.04, 99.999, 50, 33.35]), "Participation", { instrument: "i" });
    expect(p.tracks).toEqual({ t1: 0, t2: 100, t3: 50, t4: 33.4 });
    expect(Object.keys(p.tracks)).toEqual([...TRACK_IDS]);
  });

  it("is deterministic — same input, byte-identical output", () => {
    const a = JSON.stringify(sharePayloadFrom(HIGH, "Merit", { instrument: "ailx 2026.1" }));
    const b = JSON.stringify(sharePayloadFrom(HIGH, "Merit", { instrument: "ailx 2026.1" }));
    expect(a).toBe(b);
  });
});

describe("buildSharePayload", () => {
  const scored = (scaled: number) => ({
    score: { raw: {}, scaled },
  });
  const state = (values: number[] | null) =>
    ({
      phase: "completed",
      attemptId: "attempt-1",
      config: { instrument: "ailx", version: "2026.1", locale: "en", budgets: {}, demo: true },
      order: TRACK_IDS,
      tracks: Object.fromEntries(
        TRACK_IDS.map((t, i) => [t, values === null ? {} : scored(values[i])]),
      ),
      lastSeq: 9,
    }) as never;

  it("returns null until every track is scored", () => {
    expect(buildSharePayload(state(null))).toBeNull();
  });

  it("derives band + type from the projected session state", () => {
    const p = buildSharePayload(state([90, 90, 90, 90]));
    expect(p).not.toBeNull();
    expect(p!.instrument).toBe("ailx 2026.1");
    expect(p!.band).toBe("Distinction");
    expect(p!.playerType.code).toBe("MSVD");
    expect(p!.site).toBeNull();
  });

  it("does not leak the attempt id even though the state carries one", () => {
    expect(JSON.stringify(buildSharePayload(state([50, 50, 50, 50])))).not.toContain("attempt-1");
  });
});

describe("parseSharePayload", () => {
  const good = sharePayloadFrom(HIGH, "Merit", { instrument: "ailx 2026.1" });

  it("round-trips a stored payload", () => {
    expect(parseSharePayload(JSON.parse(JSON.stringify(good)))).toEqual(good);
  });

  it("strips unknown keys a row may have picked up", () => {
    const parsed = parseSharePayload({ ...good, email: "a@b.c", attemptId: "x" });
    expect(parsed).toEqual(good);
    expect(JSON.stringify(parsed)).not.toContain("a@b.c");
  });

  it("rejects junk, wrong versions and missing keys", () => {
    expect(parseSharePayload(null)).toBeNull();
    expect(parseSharePayload("nope")).toBeNull();
    expect(parseSharePayload({ ...good, v: SHARE_PAYLOAD_VERSION + 1 })).toBeNull();
    expect(parseSharePayload({ ...good, tracks: { t1: 1 } })).toBeNull();
    expect(parseSharePayload({ ...good, playerType: null })).toBeNull();
    const { band: _band, ...missing } = good;
    expect(parseSharePayload(missing)).toBeNull();
  });
});

describe("shareCardLines", () => {
  it("gives the page and the social image ONE set of lines", () => {
    const lines = shareCardLines(sharePayloadFrom(HIGH, "Distinction", { instrument: "ailx 2026.1" }));
    expect(lines.eyebrow).toBe("AILX 2026.1 · PLAYER TYPE");
    expect(lines.code).toHaveLength(4);
    expect(lines.band).toBe("Distinction");
    expect(lines.tracks.map((t) => t.track)).toEqual(["T1", "T2", "T3", "T4"]);
    expect(lines.tracks[0].value).toBe(88.2);
  });
});
