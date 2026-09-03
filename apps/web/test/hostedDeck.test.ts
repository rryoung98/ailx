// @vitest-environment jsdom
/**
 * The HOSTED deck: what the browser presents when the server dealt the deck.
 *
 * The point of every assertion here is negative — a sitting deck must be
 * constructible with NO key and NO rationale, because that is all the server
 * will send while the attempt is open (docs/ARCHITECTURE.md §4). If this file
 * can be made to pass only by handing the browser an answer, the split failed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateT2Config } from "@ailx/track-t2";
import { fetchHostedT2Config, fetchServerReview, t2ConfigFromDeck } from "../lib/instrument/hostedDeck";
import { syncKey, type PresentedDeck } from "../lib/data/persistence";

const sittingItem = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  type: "message-page",
  stem: "Hostile attempt or legitimate interface?",
  material: "[login page] URL: https://secure-payportal.com.account-verify.net/login",
  options: ["Legitimate", "Hostile"],
  signal: 1,
  difficulty: 0.4,
  exposureSeconds: 25,
  phase: "sitting",
  ...over,
});

const deckOf = (items: Record<string, unknown>[], over: Partial<PresentedDeck> = {}): PresentedDeck => ({
  phase: "sitting",
  deckDigest: "b".repeat(64),
  released: false,
  items,
  ...over,
});

describe("t2ConfigFromDeck", () => {
  it("builds a presentation config from a deck with no marking scheme", () => {
    const cfg = t2ConfigFromDeck(deckOf([sittingItem("itm-1"), sittingItem("itm-2")]));
    expect(cfg.items).toHaveLength(2);
    expect(JSON.parse(JSON.stringify(cfg.items[0]))).toEqual({
      id: "itm-1",
      type: "message-page",
      stem: "Hostile attempt or legitimate interface?",
      material: "[login page] URL: https://secure-payportal.com.account-verify.net/login",
      options: ["Legitimate", "Hostile"],
      signal: 1,
      difficulty: 0.4,
      exposureSeconds: 25,
    });
    // `phase` is transport, not deck content, and must not ride along.
    expect(cfg.items[0]).not.toHaveProperty("phase");
    // And the SCORING validator still refuses this deck: it has no keys, so
    // nothing in the browser could grade it even by mistake.
    expect(() => validateT2Config(cfg)).toThrow(/key out of range/);
  });

  it("carries key, rationale and teaching through in the REVIEW phase", () => {
    const cfg = t2ConfigFromDeck(
      deckOf(
        [
          sittingItem("itm-1", {
            phase: "review",
            key: 1,
            rationale: "The registrable domain is account-verify.net.",
            teaching: "Read the domain right to left.",
            yourChoice: 1,
            correct: true,
          }),
        ],
        { phase: "review" },
      ),
    );
    expect(cfg.items[0]).toMatchObject({
      key: 1,
      rationale: "The registrable domain is account-verify.net.",
      teaching: "Read the domain right to left.",
    });
    // The server's own verdict is a report fact, not deck content.
    expect(cfg.items[0]).not.toHaveProperty("correct");
    expect(cfg.items[0]).not.toHaveProperty("yourChoice");
  });

  it("refuses an empty deck rather than presenting nothing", () => {
    expect(() => t2ConfigFromDeck(deckOf([]))).toThrow(/no T2 items/);
  });

  /**
   * TEN-68. A withheld item cannot be sat — it arrives with no stem, no
   * options and no material. Presenting the other two would sit a shorter
   * deck than the exposure log records, which is exactly the silent
   * shortening TEN-61 exists to stop, so this refuses and names the gap.
   */
  it("refuses a deck the server withheld an item from", () => {
    expect(() =>
      t2ConfigFromDeck(
        deckOf([
          sittingItem("itm-1"),
          { phase: "withheld", id: "itm-2", withheld: "withdrawn" },
          sittingItem("itm-3"),
        ]),
      ),
    ).toThrow(/withheld 1 of 3 dealt T2 items \(itm-2: withdrawn\)/);
  });

  it("refuses a malformed item instead of mounting a broken sitting", () => {
    expect(() => t2ConfigFromDeck(deckOf([sittingItem("itm-1", { options: ["only-one"] })]))).toThrow(
      /options needs/,
    );
    expect(() => t2ConfigFromDeck(deckOf([sittingItem("itm-1", { difficulty: "hard" })]))).toThrow(
      /difficulty/,
    );
    expect(() =>
      t2ConfigFromDeck(deckOf([sittingItem("itm-1"), sittingItem("itm-1")])),
    ).toThrow(/duplicate item id/);
  });
});

/** jsdom in this repo runs without a real Storage; every suite shims one. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe("fetchHostedT2Config", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: memoryStorage(),
      configurable: true,
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    window.localStorage.clear();
  });

  it("returns null in the STATIC build — the demo keeps its bundled deck", async () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "");
    await expect(fetchHostedT2Config("att-local")).resolves.toBeNull();
  });

  it("returns null for a server-mode run the backend never created", async () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    // No sync state = no server attempt: the run is on this build's own deck.
    await expect(fetchHostedT2Config("att-local")).resolves.toBeNull();
  });

  it("presents the deck the server dealt for a server attempt", async () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    const id = "00000000-0000-4000-8000-0000000000cc";
    window.localStorage.setItem(
      syncKey(id),
      JSON.stringify({ serverAttemptId: id, syncedThrough: 0, finalized: false }),
    );
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => deckOf([sittingItem("itm-1"), sittingItem("itm-2")]),
    })) as unknown as typeof fetch;
    vi.spyOn(window, "fetch").mockImplementation(fetchFn);
    const cfg = await fetchHostedT2Config(id);
    expect(cfg?.items.map((i) => i.id)).toEqual(["itm-1", "itm-2"]);
    expect(String((fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])).toContain(
      `/attempts/${id}/items`,
    );
    vi.restoreAllMocks();
  });
});

describe("fetchServerReview", () => {
  const id = "00000000-0000-4000-8000-0000000000dd";

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: memoryStorage(),
      configurable: true,
    });
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    window.localStorage.setItem(
      syncKey(id),
      JSON.stringify({ serverAttemptId: id, syncedThrough: 0, finalized: false }),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const serve = (body: unknown) => {
    vi.spyOn(window, "fetch").mockImplementation((async () => ({
      ok: true,
      status: 200,
      json: async () => body,
    })) as unknown as typeof fetch);
  };

  it("returns the keys the server unsealed for a finalized attempt", async () => {
    serve(
      deckOf([sittingItem("itm-1", { phase: "review", key: 1, rationale: "why" })], {
        phase: "review",
      }),
    );
    await expect(fetchServerReview(id)).resolves.toEqual({
      dealt: 1,
      keys: { "itm-1": 1 },
      withheld: [],
    });
  });

  it("returns null while the attempt is still a SITTING (no keys exist yet)", async () => {
    serve(deckOf([sittingItem("itm-1")]));
    await expect(fetchServerReview(id)).resolves.toBeNull();
  });

  it("returns null in the static demo, whose keys are bundled on purpose", async () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "");
    await expect(fetchServerReview(id)).resolves.toBeNull();
  });

  /**
   * TEN-68. A dealt item the ledger later withdrew comes back with no
   * material at all. It must survive as a REPORTED fact, and the dealt count
   * must stay the count that was sat — the review is not allowed to shrink.
   */
  it("keeps a withheld item, and counts it as dealt", async () => {
    serve(
      deckOf(
        [
          sittingItem("itm-1", { phase: "review", key: 1, rationale: "why" }),
          { phase: "withheld", id: "itm-2", withheld: "withdrawn", yourChoice: 0 },
        ],
        { phase: "review" },
      ),
    );
    const review = await fetchServerReview(id);
    expect(review).not.toBeNull();
    expect(review!.dealt).toBe(2);
    expect(review!.keys).toEqual({ "itm-1": 1 });
    expect(review!.withheld).toEqual([
      { phase: "withheld", id: "itm-2", withheld: "withdrawn", yourChoice: 0 },
    ]);
  });

  /**
   * A withheld entry this build cannot validate — a reason it does not know,
   * a missing id — is still an item the candidate sat. Dropping it would
   * leave it counted in `dealt` and named nowhere, so it is reported as
   * `unavailable`: gone, and we cannot say why.
   */
  it("keeps a withheld entry it cannot validate, as unavailable", async () => {
    serve(
      deckOf(
        [
          { phase: "withheld", id: "itm-1", withheld: "retired-in-a-later-version" },
          { phase: "withheld", withheld: "withdrawn" },
        ],
        { phase: "review" },
      ),
    );
    const review = await fetchServerReview(id);
    expect(review!.dealt).toBe(2);
    expect(review!.withheld).toEqual([
      { phase: "withheld", id: "itm-1", withheld: "unavailable" },
      { phase: "withheld", id: "(unidentified item)", withheld: "unavailable" },
    ]);
  });

  it("reports a review whose every item was withdrawn, rather than nothing", async () => {
    serve(
      deckOf([{ phase: "withheld", id: "itm-1", withheld: "unavailable" }], { phase: "review" }),
    );
    await expect(fetchServerReview(id)).resolves.toEqual({
      dealt: 1,
      keys: {},
      withheld: [{ phase: "withheld", id: "itm-1", withheld: "unavailable" }],
    });
  });
});
