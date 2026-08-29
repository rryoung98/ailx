/**
 * The share payload is a PRIVACY BOUNDARY, so it is asserted as an exact
 * serialized object, not with `toMatchObject`. If a field is ever added to
 * the report derivation, this test fails until someone decides, explicitly,
 * whether it may leave the account.
 */
import { describe, expect, it } from "vitest";
import { TRACK_IDS, type SessionState, type TrackRawScores } from "@ailx/session";
import {
  ALL_SHARE_SECTIONS,
  DEFAULT_SHARE_SECTIONS,
  SHARE_NOTE_MAX,
  SHARE_PAYLOAD_VERSION,
  SHARE_SECTIONS,
  parseShareNote,
  parseShareSections,
  parseSharePayload,
  shareCardLines,
  shareMinutes,
  sharePayloadFrom,
  buildSharePayload,
} from "../src/share.js";
import { playerType } from "../src/playerType.js";

const shape = (v: number[]): TrackRawScores => ({ t1: v[0], t2: v[1], t3: v[2], t4: v[3] });

const HIGH = shape([88.24, 79.5, 71.06, 66.9]);

/** No sections switched on — the bare card every version has always carried. */
const CARD_ONLY = {
  profile: false,
  process: false,
  completed: false,
  site: false,
  note: false,
} as const;

describe("sharePayloadFrom", () => {
  it("serializes exactly the allowlisted fields, nothing else", () => {
    const payload = sharePayloadFrom(HIGH, "Distinction", {
      instrument: "ailx 2026.1",
      sections: CARD_ONLY,
    });
    expect(payload).toEqual({
      v: 2,
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
      profile: null,
      process: null,
      completedOn: null,
      note: null,
    });
    expect(Object.keys(payload).sort()).toEqual([
      "band", "completedOn", "instrument", "note", "playerType", "process", "profile", "site",
      "tracks", "v",
    ]);
  });

  it("serializes EVERY opt-in section as an exact object when all are on", () => {
    const process = {
      totalActiveSeconds: 900,
      tracks: TRACK_IDS.map((t, i) => ({
        track: t,
        activeSeconds: 200 + i,
        budgetSeconds: 600,
        timedOut: i === 3,
        iterationRatio: i === 0 ? null : 0.5,
        verificationEvents: i,
      })),
    };
    const payload = sharePayloadFrom(HIGH, "Distinction", {
      instrument: "ailx 2026.1",
      sections: ALL_SHARE_SECTIONS,
      site: "/api/site/abc/index.html",
      process,
      completedOn: "2026-02-03",
      note: "I built a site for a bike co-op.",
    });
    expect(payload.site).toBe("/api/site/abc/index.html");
    expect(payload.completedOn).toBe("2026-02-03");
    expect(payload.note).toBe("I built a site for a bike co-op.");
    expect(payload.process).toEqual(process);
    expect(payload.profile).toEqual({
      strengths: playerType(HIGH).strengths,
      watchouts: playerType(HIGH).watchouts,
    });
    // The full payload is STILL only these ten keys.
    expect(Object.keys(payload).sort()).toEqual([
      "band", "completedOn", "instrument", "note", "playerType", "process", "profile", "site",
      "tracks", "v",
    ]);
    // And each process row is exactly six process fields — never a score.
    for (const row of payload.process!.tracks) {
      expect(Object.keys(row).sort()).toEqual([
        "activeSeconds", "budgetSeconds", "iterationRatio", "timedOut", "track",
        "verificationEvents",
      ]);
    }
  });

  it("never carries item-level, response-level or identity data (exam integrity)", () => {
    const json = JSON.stringify(
      sharePayloadFrom(HIGH, "Merit", {
        instrument: "ailx 2026.1",
        sections: ALL_SHARE_SECTIONS,
        site: "/api/site/abc/index.html",
        completedOn: "2026-02-03",
        note: "a note",
        process: {
          totalActiveSeconds: 60,
          tracks: [
            { track: "t2", activeSeconds: 60, budgetSeconds: 300, timedOut: false, iterationRatio: null, verificationEvents: 0 },
          ],
        },
      }),
    );
    for (const forbidden of [
      "itemId", "item_id", "items", "deck", "bank", "answer", "correct", "confidence",
      "responses", "log", "events", "attemptId", "participant", "authRef", "locale",
      "composite", "percentile", "judgments", "rubricVersion", "scoringDigest",
      "dPrime", "brier", "nSignal", "nNoise", "eventCount", "verbCounts",
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("drops any section the selection switched off, even with data supplied", () => {
    const payload = sharePayloadFrom(HIGH, "Pass", {
      instrument: "i",
      sections: CARD_ONLY,
      site: "/api/site/abc/index.html",
      completedOn: "2026-02-03",
      note: "excluded",
      process: { totalActiveSeconds: 1, tracks: [] },
    });
    expect(payload.site).toBeNull();
    expect(payload.completedOn).toBeNull();
    expect(payload.note).toBeNull();
    expect(payload.process).toBeNull();
    expect(payload.profile).toBeNull();
    expect(JSON.stringify(payload)).not.toContain("excluded");
  });

  it("carries the site path only when the caller opted in", () => {
    expect(sharePayloadFrom(HIGH, "Pass", { instrument: "i" }).site).toBeNull();
    expect(
      sharePayloadFrom(HIGH, "Pass", { instrument: "i", site: "/api/site/abc/index.html" }).site,
    ).toBe("/api/site/abc/index.html");
    expect(
      sharePayloadFrom(HIGH, "Pass", {
        instrument: "i",
        site: "/api/site/abc/index.html",
        sections: { ...ALL_SHARE_SECTIONS, site: false },
      }).site,
    ).toBeNull();
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

describe("parseShareSections", () => {
  it("defaults to the derived sections, with the authored ones off", () => {
    expect(parseShareSections(undefined)).toEqual(DEFAULT_SHARE_SECTIONS);
    expect(DEFAULT_SHARE_SECTIONS.site).toBe(false);
    expect(DEFAULT_SHARE_SECTIONS.note).toBe(false);
  });

  it("ignores unknown keys and non-boolean values (a hostile body cannot widen)", () => {
    const parsed = parseShareSections({
      site: true,
      profile: "yes",
      answers: true,
      items: true,
      __proto__: { note: true },
    });
    expect(parsed).toEqual({ ...DEFAULT_SHARE_SECTIONS, site: true });
    expect(Object.keys(parsed).sort()).toEqual([...SHARE_SECTIONS].sort());
    expect((parsed as Record<string, unknown>).answers).toBeUndefined();
  });

  it("accepts an explicit false for a section that defaults on", () => {
    expect(parseShareSections({ profile: false }).profile).toBe(false);
  });
});

describe("parseShareNote", () => {
  it("flattens control characters and collapses whitespace", () => {
    expect(parseShareNote("  a\n\nb\tc  ")).toBe("a b c");
  });

  it("reads blank, non-string and whitespace-only notes as null", () => {
    expect(parseShareNote("")).toBeNull();
    expect(parseShareNote("   \n ")).toBeNull();
    expect(parseShareNote(42)).toBeNull();
    expect(parseShareNote(undefined)).toBeNull();
  });

  it("caps the length", () => {
    expect(parseShareNote("x".repeat(1000))).toHaveLength(SHARE_NOTE_MAX);
  });
});

describe("buildSharePayload", () => {
  const scored = (scaled: number) => ({
    trackId: "t1",
    status: "completed",
    activeMs: 120_000,
    events: [
      { verb: "prompted", object: "p1", clientTs: "2026-01-01T00:00:00.000Z" },
      { verb: "revised", object: "p1", clientTs: "2026-01-01T00:01:00.000Z" },
      { verb: "verified", object: "s1", clientTs: "2026-01-01T00:02:00.000Z" },
    ],
    score: { raw: {}, scaled },
  });
  const state = (values: number[] | null): SessionState =>
    ({
      phase: "completed",
      attemptId: "attempt-1",
      config: {
        instrument: "ailx", version: "2026.1", locale: "en", demo: true,
        budgets: { t1: 600, t2: 300, t3: 600, t4: 480 },
      },
      order: TRACK_IDS,
      tracks: Object.fromEntries(
        TRACK_IDS.map((t, i) => [t, values === null ? { events: [], activeMs: 0 } : scored(values[i])]),
      ),
      lastSeq: 9,
      lastTs: Date.UTC(2026, 1, 3, 10, 0, 0),
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

  it("fills the default sections and leaves the authored ones empty", () => {
    const p = buildSharePayload(state([90, 90, 90, 90]))!;
    expect(p.profile!.strengths.length).toBe(4);
    expect(p.process!.tracks.map((t) => t.track)).toEqual([...TRACK_IDS]);
    expect(p.process!.totalActiveSeconds).toBe(480);
    expect(p.process!.tracks[0].iterationRatio).toBe(1);
    expect(p.process!.tracks[0].verificationEvents).toBe(1);
    expect(p.completedOn).toBe("2026-02-03");
    expect(p.note).toBeNull();
    expect(p.site).toBeNull();
  });

  it("honours a narrower selection", () => {
    const p = buildSharePayload(state([90, 90, 90, 90]), { sections: CARD_ONLY })!;
    expect(p.profile).toBeNull();
    expect(p.process).toBeNull();
    expect(p.completedOn).toBeNull();
  });

  it("carries the note only when the note section is on", () => {
    const opts = { note: "  built  a\nthing " };
    expect(buildSharePayload(state([50, 50, 50, 50]), opts)!.note).toBeNull();
    expect(
      buildSharePayload(state([50, 50, 50, 50]), {
        ...opts,
        sections: { ...DEFAULT_SHARE_SECTIONS, note: true },
      })!.note,
    ).toBe("built a thing");
  });

  it("does not leak the attempt id even though the state carries one", () => {
    expect(JSON.stringify(buildSharePayload(state([50, 50, 50, 50])))).not.toContain("attempt-1");
  });
});

describe("parseSharePayload", () => {
  const good = sharePayloadFrom(HIGH, "Merit", {
    instrument: "ailx 2026.1",
    sections: ALL_SHARE_SECTIONS,
    site: "/api/site/abc/index.html",
    completedOn: "2026-02-03",
    note: "a note",
    process: {
      totalActiveSeconds: 120,
      tracks: TRACK_IDS.map((t) => ({
        track: t, activeSeconds: 30, budgetSeconds: 600, timedOut: false,
        iterationRatio: 0.5, verificationEvents: 2,
      })),
    },
  });

  it("round-trips a stored payload", () => {
    expect(parseSharePayload(JSON.parse(JSON.stringify(good)))).toEqual(good);
  });

  it("strips unknown keys a row may have picked up", () => {
    const parsed = parseSharePayload({ ...good, email: "a@b.c", attemptId: "x" });
    expect(parsed).toEqual(good);
    expect(JSON.stringify(parsed)).not.toContain("a@b.c");
  });

  it("reads a v1 row with every section absent, and keeps saying it is v1", () => {
    const v1 = {
      v: 1,
      instrument: "ailx 2026.1",
      band: "Merit",
      playerType: good.playerType,
      tracks: good.tracks,
      site: null,
    };
    const parsed = parseSharePayload(v1)!;
    expect(parsed.v).toBe(1);
    expect(parsed.profile).toBeNull();
    expect(parsed.process).toBeNull();
    expect(parsed.completedOn).toBeNull();
    expect(parsed.note).toBeNull();
  });

  it("re-sanitizes stored section content on the way out", () => {
    const parsed = parseSharePayload({
      ...good,
      note: "line\none",
      completedOn: "not-a-date",
      process: { totalActiveSeconds: "x", tracks: [{ track: "nope" }] },
      profile: { strengths: [1, 2], watchouts: "nope" },
    })!;
    expect(parsed.note).toBe("line one");
    expect(parsed.completedOn).toBeNull();
    expect(parsed.process).toBeNull();
    expect(parsed.profile).toEqual({ strengths: ["1", "2"], watchouts: [] });
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
    const lines = shareCardLines(
      sharePayloadFrom(HIGH, "Distinction", { instrument: "ailx 2026.1", sections: CARD_ONLY }),
    );
    expect(lines.eyebrow).toBe("AILX 2026.1 · PLAYER TYPE");
    expect(lines.code).toHaveLength(4);
    expect(lines.band).toBe("Distinction");
    expect(lines.tracks.map((t) => t.track)).toEqual(["T1", "T2", "T3", "T4"]);
    expect(lines.tracks[0].value).toBe(88.2);
    expect(lines.highlight).toBeNull();
    expect(lines.footnotes).toEqual([]);
  });

  it("promotes the candidate's own note over a derived strength", () => {
    const withNote = sharePayloadFrom(HIGH, "Merit", {
      instrument: "i", sections: ALL_SHARE_SECTIONS, note: "I shipped a co-op site.",
      completedOn: "2026-02-03", site: "/api/site/abc/index.html",
      process: { totalActiveSeconds: 1800, tracks: [] },
    });
    expect(shareCardLines(withNote).highlight).toBe("I shipped a co-op site.");
    expect(shareCardLines(withNote).footnotes).toEqual(["30 min on task", "2026-02-03", "built a site"]);
    const noNote = sharePayloadFrom(HIGH, "Merit", {
      instrument: "i", sections: { ...ALL_SHARE_SECTIONS, note: false },
    });
    expect(noNote.profile).not.toBeNull();
    expect(shareCardLines(noNote).highlight).toBe(playerType(HIGH).strengths[0]);
  });
});

describe("shareMinutes", () => {
  it("rounds to whole minutes and never goes negative", () => {
    expect(shareMinutes(0)).toBe(0);
    expect(shareMinutes(89)).toBe(1);
    expect(shareMinutes(-5)).toBe(0);
    expect(shareMinutes(1800)).toBe(30);
  });
});
