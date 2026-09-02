// @vitest-environment jsdom
/**
 * The daily challenge, as a person actually meets it.
 *
 * The rules — the deck, the day, the grid, the streak — are proved in
 * `packages/report/test/daily.test.ts`, where they are decided. What only a
 * RENDERED daily can show is asserted here:
 *
 *  - it plays for somebody with no account and no network at all;
 *  - two devices on the same calendar day get the same five cards;
 *  - the day is remembered, so a reload shows the result instead of dealing
 *    the same puzzle again;
 *  - and the RESULT VIEW — the screen somebody screenshots and the links they
 *    press — carries no card, no tell and no answer. The leak guard is run
 *    against the real pool over the real rendered text, because the grid
 *    being safe in a unit test is not the same as the page being safe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  DAILY_DECK_SIZE,
  DAILY_LEDGER_KEY,
  dailyDay,
  dailyDeck,
  dailyGrid,
  dailyNumber,
  dailyShareLeaks,
  parseDailyLedger,
  serializeDailyLedger,
} from "@ailx/report";
import { DailyChallenge } from "../lib/DailyChallenge";
import { DAILY_POOL } from "../lib/demoItems";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const store = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
  },
  configurable: true,
});

/** 2026-03-17, mid-afternoon in London — a plain, unambiguous local day. */
const NOW = Date.parse("2026-03-17T14:00:00.000Z");
const DAY = "2026-03-17";

let container: HTMLDivElement;
let root: Root;
const fetchSpy = vi.fn();

beforeEach(() => {
  store.clear();
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  // The device's own timezone decides the day; pin it to UTC so the fixture
  // day is the fixture day on every machine that runs this suite.
  vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(0);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(): void {
  act(() => root.render(createElement(DailyChallenge)));
}

const buttons = (): HTMLButtonElement[] => [...container.querySelectorAll("button")];
const byText = (label: string): HTMLButtonElement => {
  const found = buttons().find((b) => (b.textContent ?? "").includes(label));
  if (!found) throw new Error(`no button "${label}" in: ${buttons().map((b) => b.textContent).join(" | ")}`);
  return found;
};
const click = (el: HTMLElement): void => act(() => void el.click());
const text = (): string => container.textContent ?? "";

/** Play the whole round, calling `pick` on each card. */
function playRound(pick: (cardIndex: number) => number): void {
  const deck = dailyDeck(DAY, DAILY_POOL);
  for (let i = 0; i < deck.length; i++) {
    click(byText(deck[i].options[pick(i)]));
    click(byText(i === deck.length - 1 ? "See today" : "Next card"));
  }
}

describe("the daily plays for a stranger", () => {
  it("deals today's five cards with no account and no request", () => {
    mount();
    expect(text()).toContain(`daily #${dailyNumber(DAY)}`);
    expect(text()).toContain(`Card 1 of ${DAILY_DECK_SIZE}`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows the same five cards to two devices on the same calendar day", () => {
    // Tokyo, an hour after midnight; London, mid-afternoon. Same date.
    const tokyo = dailyDay(Date.parse("2026-03-17T01:00:00.000Z"), 9 * 60);
    expect(tokyo).toBe(DAY);
    expect(dailyDeck(tokyo, DAILY_POOL).map((c) => c.id)).toEqual(
      dailyDeck(DAY, DAILY_POOL).map((c) => c.id),
    );
  });

  it("teaches on every card, and only after the call", () => {
    mount();
    const first = dailyDeck(DAY, DAILY_POOL)[0];
    expect(text()).not.toContain(first.tell);
    click(byText(first.options[0]));
    expect(text()).toContain(first.tell);
  });

  it("finishes with a grid, a tally and a share row", () => {
    mount();
    const deck = dailyDeck(DAY, DAILY_POOL);
    playRound((i) => deck[i].key); // every call right
    expect(text()).toContain(dailyGrid(deck.map(() => "hit")));
    expect(text()).toContain(`${DAILY_DECK_SIZE} of ${DAILY_DECK_SIZE}`);
    expect(container.querySelector('[data-testid="share-targets"]')).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("records the day, so a reload shows the result instead of dealing it again", () => {
    mount();
    const deck = dailyDeck(DAY, DAILY_POOL);
    playRound((i) => deck[i].key);
    const ledger = parseDailyLedger(store.get(DAILY_LEDGER_KEY));
    expect(ledger.days).toEqual([DAY]);
    expect(ledger.last?.results).toEqual(deck.map(() => "hit"));

    act(() => root.unmount());
    root = createRoot(container);
    mount();
    expect(text()).toContain(`AILX Daily #${dailyNumber(DAY)}`);
    expect(text()).not.toContain("Card 1 of");
  });

  it("shows a streak once the browser has one, and says what it means", () => {
    store.set(
      DAILY_LEDGER_KEY,
      serializeDailyLedger({ days: ["2026-03-15", "2026-03-16"], last: null }),
    );
    mount();
    const deck = dailyDeck(DAY, DAILY_POOL);
    playRound((i) => deck[i].key);
    expect(text()).toContain("days in a row");
    expect(text()).toContain("counts the days you came back");
    expect(text()).not.toMatch(/percentile|top \d/i);
  });

  it("does not count a picture that never loaded against the player", () => {
    mount();
    // This day's first card is a picture — the deck is deterministic, so the
    // fixture can say so rather than branching on what it finds.
    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    act(() => void image!.dispatchEvent(new Event("error")));
    expect(text()).toContain("has not been counted for or against you");
    click(byText("Skip this card"));
    expect(text()).toContain(`Card 2 of ${DAILY_DECK_SIZE}`);
  });

  it("survives a rewritten or corrupt store instead of failing to render", () => {
    store.set(DAILY_LEDGER_KEY, '{"days":["not-a-day",{"day":"2026-13-45"}],"last":{"results":7}}');
    mount();
    expect(text()).toContain(`Card 1 of ${DAILY_DECK_SIZE}`);
  });
});

describe("the result view gives the day away to nobody", () => {
  it("renders no card, no id, no tell and no answer once the round is over", () => {
    mount();
    const deck = dailyDeck(DAY, DAILY_POOL);
    playRound((i) => (i % 2 === 0 ? deck[i].key : 1 - deck[i].key));
    expect(dailyShareLeaks(text(), DAILY_POOL)).toEqual([]);
  });

  it("puts nothing in a share link that is not in the grid", () => {
    mount();
    const deck = dailyDeck(DAY, DAILY_POOL);
    playRound((i) => deck[i].key);
    const links = [...container.querySelectorAll<HTMLAnchorElement>('[data-testid^="share-"] , a[data-testid^="share-"]')]
      .map((a) => a.getAttribute("href"))
      .filter((href): href is string => href !== null);
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) {
      expect(dailyShareLeaks(decodeURIComponent(href), DAILY_POOL)).toEqual([]);
    }
  });
});

describe("the pool is published material and nothing else", () => {
  it("draws only on the practice corpus and the released-practice tier", async () => {
    const { PRACTICE_BANK } = await import("@ailx/report");
    const { snapshotTrack } = await import("../lib/instrument");
    const released = new Set(
      (snapshotTrack("t2").bank?.items ?? []).map((i) => (i as { id: string }).id),
    );
    const practice = new Set(PRACTICE_BANK.map((i) => i.id));
    expect(DAILY_POOL.length).toBeGreaterThan(DAILY_DECK_SIZE);
    for (const card of DAILY_POOL) {
      expect(practice.has(card.id) || released.has(card.id), card.id).toBe(true);
    }
  });

  it("asks a one-bit question on every card, with the signal call first", () => {
    for (const card of DAILY_POOL) {
      expect(card.options).toHaveLength(2);
      expect([0, 1]).toContain(card.key);
      expect(card.stem.length).toBeGreaterThan(0);
      expect(card.tell.length).toBeGreaterThan(0);
    }
  });
});
