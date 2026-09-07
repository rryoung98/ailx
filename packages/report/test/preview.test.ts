/**
 * The preview card is an ALLOWLIST, and this is the test that keeps it one.
 *
 * The failure it exists to catch is the quiet one: somebody adds a section to
 * the share payload, and it appears on a public page because the preview was
 * written as a redaction instead of as a list.
 */
import { describe, expect, it } from "vitest";
import { ALL_SHARE_SECTIONS, sharePayloadFrom } from "../src/share.js";
import { PREVIEW_CARD_COUNT, previewCardFrom } from "../src/preview.js";

const PAYLOAD = sharePayloadFrom({ t1: 88.24, t2: 79.5, t3: 71.06, t4: 66.9 }, "Distinction", {
  instrument: "ailx 2026.1",
  sections: ALL_SHARE_SECTIONS,
  site: "/api/site/abc/index.html",
  completedOn: "2026-02-03",
  note: "I built a site for a bike co-op.",
  process: {
    totalActiveSeconds: 900,
    tracks: [
      { track: "t1", activeSeconds: 200, budgetSeconds: 600, timedOut: false, iterationRatio: 0.5, verificationEvents: 1 },
    ],
  },
});

describe("previewCardFrom", () => {
  it("carries exactly the safe list, by name", () => {
    expect(Object.keys(previewCardFrom(PAYLOAD)).sort()).toEqual([
      "band",
      "code",
      "completedOn",
      "name",
      "poles",
      "tagline",
      "tracks",
    ]);
  });

  it("drops the artefact, the note and everything opt-in that is not shape", () => {
    const json = JSON.stringify(previewCardFrom(PAYLOAD));
    expect(json).not.toContain("/api/site/");
    expect(json).not.toContain("bike co-op");
    expect(json).not.toContain("activeSeconds");
    expect(json).not.toContain("instrument");
    const card = previewCardFrom(PAYLOAD) as unknown as Record<string, unknown>;
    expect("site" in card).toBe(false);
    expect("note" in card).toBe(false);
    expect("process" in card).toBe(false);
    expect("profile" in card).toBe(false);
  });

  it("does NOT grow a field when the payload does", () => {
    const widened = { ...PAYLOAD, forum: { posts: ["a prompt somebody wrote"] } } as never;
    const json = JSON.stringify(previewCardFrom(widened));
    expect(json).not.toContain("forum");
    expect(json).not.toContain("a prompt somebody wrote");
  });

  it("keeps the letter, the meter and the shape, which are what a preview is FOR", () => {
    const card = previewCardFrom(PAYLOAD);
    expect(card.code).toBe(PAYLOAD.playerType.code);
    expect(card.tracks).toEqual(PAYLOAD.tracks);
    expect(card.band).toBe("Distinction");
    expect(card.completedOn).toBe("2026-02-03");
    for (const pole of card.poles) {
      expect(Object.keys(pole).sort()).toEqual(["label", "letter", "strength", "track"]);
      expect(typeof pole.strength).toBe("number");
    }
  });

  it("carries no strength for a card written before v3 — absent, never zero", () => {
    const old = {
      ...PAYLOAD,
      v: 2 as const,
      playerType: {
        ...PAYLOAD.playerType,
        poles: PAYLOAD.playerType.poles.map(({ strength: _s, ...rest }) => rest),
      },
    };
    for (const pole of previewCardFrom(old).poles) {
      expect("strength" in pole).toBe(false);
    }
  });

  it("shows six, which is two rows of three on a phone", () => {
    expect(PREVIEW_CARD_COUNT).toBe(6);
  });
});
