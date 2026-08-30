import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Runner } from "../src/Runner.js";
import { encodeT2Checkpoint } from "../src/checkpoint.js";
import { validateT2Config, validateT2PresentationConfig } from "../src/plugin.js";
import { isRevealedT2Item, type T2PresentedItem } from "../src/types.js";
import { config, items } from "./fixtures.js";

/**
 * A hosted sitting deck as `GET /api/attempts/:id/items` serves it: `key`,
 * `rationale` and `teaching` are ABSENT, not blank (docs/ARCHITECTURE.md §4).
 * Presentation must be constructible from exactly these bytes — if it is not,
 * the candidate can only be sat on content whose answers they already hold.
 */
function seal(item: (typeof items)[number]): T2PresentedItem {
  const { key: _k, rationale: _r, teaching: _t, ...presented } = item;
  return presented;
}

const sealedItems = items.map(seal);
/** A needle from item 0's rationale with no HTML-escapable characters. */
const RATIONALE_NEEDLE = "Physics violations";
const sealedConfig = { items: sealedItems, weights: config.weights };

describe("T2 presentation config carries no marking scheme", () => {
  it("validates a deck with no key and no rationale", () => {
    const cfg = validateT2PresentationConfig(sealedConfig);
    expect(cfg.items).toHaveLength(items.length);
    for (const item of cfg.items) {
      expect(isRevealedT2Item(item)).toBe(false);
    }
  });

  it("keeps the presented item EXACTLY the presented fields", () => {
    // The whole object, not a field probe: a future field that smuggles an
    // answer in has to change this assertion, and be argued for.
    const cfg = validateT2PresentationConfig(sealedConfig);
    expect(JSON.parse(JSON.stringify(cfg.items[0]))).toEqual({
      id: items[0].id,
      type: items[0].type,
      stem: items[0].stem,
      material: items[0].material,
      options: [...items[0].options],
      signal: items[0].signal,
      difficulty: items[0].difficulty,
      exposureSeconds: items[0].exposureSeconds,
    });
  });

  it("the SCORING validator still refuses a deck without keys", () => {
    expect(() => validateT2Config(sealedConfig)).toThrow(/key out of range/);
    expect(() =>
      validateT2Config({ items: items.map(({ rationale: _r, ...rest }) => rest) }),
    ).toThrow(/rationale missing/);
  });

  it("still checks a key or rationale that IS present (review decks)", () => {
    const bad = [{ ...items[0], key: 9 }, ...sealedItems.slice(1)];
    expect(() => validateT2PresentationConfig({ items: bad })).toThrow(/key out of range/);
    const badRationale = [{ ...sealedItems[0], rationale: 7 }, ...sealedItems.slice(1)];
    expect(() => validateT2PresentationConfig({ items: badRationale })).toThrow(
      /rationale missing/,
    );
  });

  it("rejects the same structural defects both validators always rejected", () => {
    expect(() => validateT2PresentationConfig({ items: [] })).toThrow(/non-empty/);
    expect(() =>
      validateT2PresentationConfig({ items: [sealedItems[0], sealedItems[0]] }),
    ).toThrow(/duplicate item id/);
    expect(() =>
      validateT2PresentationConfig({ items: [{ ...sealedItems[0], type: "nope" }] }),
    ).toThrow(/type invalid/);
    expect(() =>
      validateT2PresentationConfig({ items: [{ ...sealedItems[0], difficulty: 2 }] }),
    ).toThrow(/difficulty/);
    expect(() =>
      validateT2PresentationConfig({ items: [{ ...sealedItems[0], signal: 5 }] }),
    ).toThrow(/signal out of range/);
    expect(() =>
      validateT2PresentationConfig({ items: [{ ...sealedItems[0], options: ["only-one"] }] }),
    ).toThrow(/options needs/);
  });
});

const runnerProps = (cfg: unknown, checkpoint?: unknown) => ({
  attemptId: "a-sealed",
  locale: "en" as const,
  config: cfg,
  onEvent: () => {},
  onComplete: () => {},
  secondsRemaining: 300,
  checkpoint,
  onCheckpoint: () => {},
});

describe("T2 Runner on a sealed (server-served) deck", () => {
  it("mounts and presents the deck", () => {
    const html = renderToStaticMarkup(createElement(Runner, runnerProps(sealedConfig)));
    expect(html).toContain("Start the deck");
  });

  it("replays without a verdict, an answer or a rationale", () => {
    const checkpoint = encodeT2Checkpoint({
      phase: "replay",
      deckIndex: sealedItems.length,
      replayIdx: 0,
      responses: [{ itemId: sealedItems[0].id, choice: 1, confidence: 80, latencyMs: 900 }],
    });
    const html = renderToStaticMarkup(
      createElement(Runner, runnerProps(sealedConfig, checkpoint)),
    );
    expect(html).toContain("Your call:");
    expect(html).toContain("Answers and rationales are held by the server");
    expect(html).not.toContain("correct");   // covers "incorrect" too
    expect(html).not.toContain("<strong>Answer:</strong>");
    expect(html).not.toContain(RATIONALE_NEEDLE);
  });

  it("still teaches key, rationale and provenance when the content carries them", () => {
    const checkpoint = encodeT2Checkpoint({
      phase: "replay",
      deckIndex: items.length,
      replayIdx: 0,
      responses: [{ itemId: items[0].id, choice: items[0].key, confidence: 80, latencyMs: 900 }],
    });
    const html = renderToStaticMarkup(createElement(Runner, runnerProps(config, checkpoint)));
    expect(html).toContain("<strong>Answer:</strong>");
    expect(html).toContain(RATIONALE_NEEDLE);
    expect(html).toContain("correct");
    expect(html).not.toContain("held by the server");
  });
});
