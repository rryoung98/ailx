/**
 * The custody tests.
 *
 * These run against the REAL operational snapshot, because the property under
 * test is not "the redactor deletes two fields" — it is "the bytes we actually
 * ship for a real sitting contain no answer". A fixture could not fail the way
 * the production bundle failed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEMO_SNAPSHOT,
  OPERATIONAL_SNAPSHOT,
  fromSnapshot,
  openDemoInstrument,
  openInstrument,
  resetInstrumentCache,
  type Instrument,
  type RedactedItem,
  type Snapshot,
} from "../src/index.js";

const ATTEMPT = "11111111-2222-3333-4444-555555555555";

const operational = await openInstrument(process.env, {});
const demo = openDemoInstrument();

function deckOf(inst: Instrument, locale = "en") {
  const decks = inst.sampleDecks(ATTEMPT, locale);
  expect(decks).toHaveLength(1);
  return decks[0]!;
}

describe("sampleDecks", () => {
  it("deals a non-empty, duplicate-free t2 deck stamped with the bank sha", () => {
    const deck = deckOf(operational);
    expect(deck.trackId).toBe("t2");
    expect(deck.bankSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(deck.itemIds.length).toBeGreaterThan(0);
    expect(new Set(deck.itemIds).size).toBe(deck.itemIds.length);
  });

  it("is pure: the same attempt id re-derives the same deck", () => {
    expect(deckOf(operational).itemIds).toEqual(deckOf(operational).itemIds);
  });

  it("different attempts get different decks (the exposure model works)", () => {
    const a = operational.sampleDecks(ATTEMPT, "en")[0]!.itemIds;
    const b = operational.sampleDecks("99999999-8888-7777-6666-555555555555", "en")[0]!.itemIds;
    expect(a).not.toEqual(b);
  });

  it("serves ja and ko from their own localized banks", () => {
    for (const locale of ["ja", "ko"]) {
      const deck = deckOf(operational, locale);
      expect(deck.itemIds.length, locale).toBeGreaterThan(0);
      expect(deck.itemIds, locale).not.toEqual(deckOf(operational, "en").itemIds);
    }
  });

  it("an unpopulated locale falls back to en rather than an empty sitting", () => {
    expect(deckOf(operational, "xx").itemIds).toEqual(deckOf(operational, "en").itemIds);
  });
});

describe("itemView — the trust boundary", () => {
  const deck = deckOf(operational);

  it("a sitting carries NO key and NO rationale — absent, not blanked", () => {
    for (const item of operational.itemView(deck, "sitting", "en")) {
      expect(item.phase).toBe("sitting");
      expect(Object.keys(item)).not.toContain("key");
      expect(Object.keys(item)).not.toContain("rationale");
      expect(Object.keys(item)).not.toContain("provenance");
    }
  });

  it("no serialized sitting item contains any operational key or rationale text", () => {
    // The bundle test greps built JS; this greps the API RESPONSE, which is
    // the other way the same bytes could reach a browser.
    const snap = JSON.parse(readFileSync(OPERATIONAL_SNAPSHOT, "utf8")) as Snapshot;
    const bank = snap.instrument.tracks.find((t) => t.trackId === "t2-discrimination")!.bank!;
    const wire = JSON.stringify(operational.itemView(deck, "sitting", "en"));
    for (const raw of bank.items) {
      expect(wire.includes(raw.rationale), raw.id).toBe(false);
    }
    expect(wire).not.toContain('"key"');
    expect(wire).not.toContain('"rationale"');
  });

  it("presents everything the Runner needs to render the card", () => {
    for (const item of operational.itemView(deck, "sitting", "en")) {
      expect(typeof item.id).toBe("string");
      expect(typeof item.stem).toBe("string");
      expect(typeof item.material).toBe("string");
      expect(item.options.length).toBeGreaterThanOrEqual(2);
      expect(item.difficulty).toBeGreaterThanOrEqual(0);
      expect(item.difficulty).toBeLessThanOrEqual(1);
    }
  });

  it("review unlocks the key and the rationale", () => {
    const items = operational.itemView(deck, "review", "en");
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.phase).toBe("review");
      if (item.phase !== "review") throw new Error("unreachable");
      expect(item.key).toBeGreaterThanOrEqual(0);
      expect(item.key).toBeLessThan(item.options.length);
      expect(item.rationale.length).toBeGreaterThan(0);
    }
  });

  it("review carries the SERVER's verdict next to the candidate's choice", () => {
    const deckItems = operational.itemView(deck, "sitting", "en");
    const first = deckItems[0]!;
    const answers = new Map([[first.id, 0]]);
    const [reviewed] = operational.itemView(deck, "review", "en", answers) as [
      Extract<RedactedItem, { phase: "review" }>,
    ];
    expect(reviewed.yourChoice).toBe(0);
    expect(reviewed.correct).toBe(reviewed.key === 0);
  });

  it("answers are IGNORED during the sitting — no verdict before finalize", () => {
    const items = operational.itemView(deck, "sitting", "en", new Map([[deck.itemIds[0]!, 0]]));
    expect(JSON.stringify(items)).not.toContain("yourChoice");
    expect(JSON.stringify(items)).not.toContain("correct");
  });

  it("drops an item id the bank no longer carries instead of rendering a hole", () => {
    const stale = { ...deck, itemIds: [...deck.itemIds, "deadbeef".repeat(8)] };
    expect(operational.itemView(stale, "sitting", "en")).toHaveLength(deck.itemIds.length);
  });

  it("an empty deck views as an empty list, not as the whole bank", () => {
    expect(operational.itemView({ ...deck, itemIds: [] }, "review", "en")).toEqual([]);
  });
});

describe("gradeResponse", () => {
  const deck = deckOf(operational);
  const reviewed = operational.itemView(deck, "review", "en") as Array<
    Extract<RedactedItem, { phase: "review" }>
  >;

  it("marks the keyed option correct and every other option wrong", () => {
    for (const item of reviewed) {
      for (let choice = 0; choice < item.options.length; choice++) {
        const v = operational.gradeResponse(item.id, { choice });
        expect(v.itemId).toBe(item.id);
        expect(v.key).toBe(item.key);
        expect(v.correct).toBe(choice === item.key);
      }
    }
  });

  it("accepts an option ID as well as an index (a hand-written client)", () => {
    const item = reviewed[0]!;
    const byLabel = operational.gradeResponse(item.id, { choice: item.options[item.key] });
    expect(byLabel.correct).toBe(true);
  });

  it("a lapsed, missing or malformed answer is a MISS, never a throw", () => {
    const id = reviewed[0]!.id;
    for (const payload of [{ choice: -1 }, {}, null, "ai", { choice: {} }, { choice: 1.5 }]) {
      expect(operational.gradeResponse(id, payload).correct, JSON.stringify(payload)).toBe(false);
    }
  });

  it("refuses an item that is not in this bank (no oracle for guessed ids)", () => {
    expect(() => operational.gradeResponse("nope", { choice: 0 })).toThrow(/not in this bank/);
  });
});

describe("audit facts survive the move", () => {
  it("exposes the same rubricVersion and scoring digest as the snapshot", () => {
    const snap = JSON.parse(readFileSync(OPERATIONAL_SNAPSHOT, "utf8")) as Snapshot;
    for (const trackId of ["t1", "t2", "t3", "t4"] as const) {
      const scorer = snap.scorers!.find((s) => s.trackId === trackId)!;
      expect(operational.scoringDigest(trackId)).toBe(scorer.digest);
      expect(operational.rubricVersion(trackId)).toMatch(/\S/);
    }
  });

  it("the demo tier carries the SAME scorer digests — the code did not change", () => {
    for (const trackId of ["t1", "t2", "t3", "t4"] as const) {
      expect(demo.scoringDigest(trackId)).toBe(operational.scoringDigest(trackId));
      expect(demo.rubricVersion(trackId)).toBe(operational.rubricVersion(trackId));
    }
  });

  it("fails CLOSED when the snapshot carries no scoring digest", () => {
    const snap = JSON.parse(readFileSync(OPERATIONAL_SNAPSHOT, "utf8")) as Snapshot;
    const inst = fromSnapshot({ ...snap, scorers: undefined });
    expect(() => inst.scoringDigest("t2")).toThrow(/rebuild it/);
  });

  it("packageDigest is the bank content address the deck is seeded with", () => {
    expect(operational.packageDigest).toBe(deckOf(operational).bankSha256);
    expect(demo.packageDigest).not.toBe(operational.packageDigest);
  });
});

describe("scoringConfig", () => {
  it("carries the keys score() needs — which is why it stays server-side", () => {
    const deck = deckOf(operational);
    const cfg = operational.scoringConfig("t2", deck, "en") as {
      items: Array<{ id: string; key: number; rationale: string }>;
      dPrimeCeiling?: number;
    };
    expect(cfg.items.map((i) => i.id)).toEqual([...deck.itemIds]);
    for (const i of cfg.items) expect(typeof i.key).toBe("number");
  });

  it("is undefined for tracks whose config is not content-borne", () => {
    for (const t of ["t1", "t3", "t4"] as const) {
      expect(operational.scoringConfig(t, undefined, "en")).toBeUndefined();
    }
  });
});

describe("opening an instrument", () => {
  it("the two tiers are DISJOINT — no released item is still an exam item", () => {
    const opIds = new Set(operational.sampleDecks(ATTEMPT, "en")[0]!.itemIds);
    const snapOp = JSON.parse(readFileSync(OPERATIONAL_SNAPSHOT, "utf8")) as Snapshot;
    const snapDemo = JSON.parse(readFileSync(DEMO_SNAPSHOT, "utf8")) as Snapshot;
    const ids = (s: Snapshot) =>
      new Set(s.instrument.tracks.find((t) => t.trackId === "t2-discrimination")!.bank!.items.map((i) => i.id));
    const shared = [...ids(snapDemo)].filter((id) => ids(snapOp).has(id));
    expect(shared).toEqual([]);
    expect(opIds.size).toBeGreaterThan(0);
  });

  it("marks the demo tier released and the operational tier not", () => {
    expect(demo.released).toBe(true);
    expect(operational.released).toBe(false);
  });

  it("REFUSES to open a snapshot whose digest is not the pinned one", async () => {
    resetInstrumentCache();
    await expect(
      openInstrument({}, { snapshotPath: OPERATIONAL_SNAPSHOT, expectDigest: "0".repeat(64) }),
    ).rejects.toThrow(/digest mismatch/);
  });

  it("opens the pinned digest it was given", async () => {
    resetInstrumentCache();
    const { createHash } = await import("node:crypto");
    const digest = createHash("sha256").update(readFileSync(OPERATIONAL_SNAPSHOT)).digest("hex");
    await expect(
      openInstrument({}, { snapshotPath: OPERATIONAL_SNAPSHOT, expectDigest: digest }),
    ).resolves.toBeDefined();
  });

  it("AILX_INSTRUMENT_SNAPSHOT mounts a different package without a code change", async () => {
    resetInstrumentCache();
    const inst = await openInstrument({ AILX_INSTRUMENT_SNAPSHOT: DEMO_SNAPSHOT });
    expect(inst.packageDigest).toBe(demo.packageDigest);
  });

  it("applies the injected assetUrl to served media, and nothing else", () => {
    const snap = JSON.parse(readFileSync(DEMO_SNAPSHOT, "utf8")) as Snapshot;
    const prefixed = fromSnapshot(snap, { assetUrl: (p) => `/ailx${p}`, released: true });
    const deck = prefixed.sampleDecks(ATTEMPT, "en")[0]!;
    const media = prefixed
      .itemView(deck, "sitting", "en")
      .filter((i) => i.material.startsWith("/"));
    expect(media.length).toBeGreaterThan(0);
    for (const i of media) expect(i.material.startsWith("/ailx/")).toBe(true);
  });
});
