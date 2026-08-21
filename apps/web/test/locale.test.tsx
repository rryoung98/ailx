// @vitest-environment jsdom
/**
 * ja/ko locale support regression tests:
 *  - persisted locale selection ('ailx:locale'): load/save/fallback + the
 *    header LocaleSwitcher writes it and announces the English-chrome scope;
 *  - localized T2 decks: t2Items('ja') / t2Items('ko') give a playable
 *    >= 8-item deck whose every item maps to a bank item of that locale,
 *    with machine-translation marked in provenance and en source linked;
 *  - locale-aware wiring: trackConfig('t2', locale) validates through the
 *    real T2 plugin and scoreTrack scores a ja sitting against the ja deck.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { validateT2Config } from "@ailx/track-t2";
import {
  LOCALES, LOCALE_STORAGE_KEY, isLocale, loadLocale, saveLocale,
} from "../lib/locale";
import { LocaleSwitcher } from "../lib/LocaleSwitcher";
import { SNAPSHOT, snapshotTrack, t2Items, trackConfig } from "../lib/instrument";
import { scoreTrack } from "../lib/registry";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// This repo's jsdom environment does not ship window.localStorage; install a
// spec-shaped in-memory shim so the REAL storage-facing code paths run.
if (typeof window !== "undefined" && !window.localStorage) {
  const map = new Map<string, string>();
  const shim: Storage = {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
  Object.defineProperty(window, "localStorage", { value: shim, configurable: true });
}

describe("locale persistence (ailx:locale)", () => {
  afterEach(() => window.localStorage.clear());

  it("defaults to en when nothing is stored or the value is corrupt", () => {
    expect(loadLocale(window.localStorage)).toBe("en");
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "fr");
    expect(loadLocale(window.localStorage)).toBe("en");
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "{}");
    expect(loadLocale(window.localStorage)).toBe("en");
  });

  it("round-trips every supported locale through the storage key", () => {
    for (const l of LOCALES) {
      saveLocale(window.localStorage, l);
      expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe(l);
      expect(loadLocale(window.localStorage)).toBe(l);
    }
  });

  it("falls back to en when storage throws (private mode)", () => {
    expect(loadLocale({ getItem: () => { throw new Error("denied"); } })).toBe("en");
  });

  it("isLocale admits exactly en/ja/ko", () => {
    expect(isLocale("en") && isLocale("ja") && isLocale("ko")).toBe(true);
    expect(isLocale("EN")).toBe(false);
    expect(isLocale("")).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});

describe("LocaleSwitcher component", () => {
  let root: Root | null = null;
  let host: HTMLElement | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    window.localStorage.clear();
  });

  function mount() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(createElement(LocaleSwitcher)));
  }

  it("clicking a locale persists it to localStorage and marks it pressed", () => {
    mount();
    const buttons = [...host!.querySelectorAll("button")];
    expect(buttons).toHaveLength(3);
    const ja = buttons.find((b) => b.textContent === "日本語")!;
    act(() => ja.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("ja");
    expect(ja.getAttribute("aria-pressed")).toBe("true");
    const ko = buttons.find((b) => b.textContent === "한국어")!;
    act(() => ko.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("ko");
    expect(ko.getAttribute("aria-pressed")).toBe("true");
    expect(ja.getAttribute("aria-pressed")).toBe("false");
  });

  it("rehydrates the stored selection on mount", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "ko");
    mount();
    const pressed = [...host!.querySelectorAll('button[aria-pressed="true"]')];
    expect(pressed).toHaveLength(1);
    expect(pressed[0].textContent).toBe("한국어");
  });

  it("states, where the locale is switched, that UI chrome stays English", () => {
    mount();
    expect(host!.textContent).toContain("UI stays English");
  });
});

describe("localized T2 decks (ja/ko)", () => {
  const bankById = new Map(
    snapshotTrack("t2").bank!.items.map((i) => [i.id, i]),
  );

  for (const locale of ["ja", "ko"] as const) {
    it(`t2Items('${locale}') is a playable deck: >= 8 items, all locale ${locale}`, () => {
      const items = t2Items(locale);
      expect(items.length).toBeGreaterThanOrEqual(8);
      for (const item of items) {
        const bankItem = bankById.get(item.id);
        expect(bankItem, `deck item ${item.id} missing from bank`).toBeTruthy();
        expect(bankItem!.locale).toBe(locale);
      }
      // Mixed families: timed binary items and untimed provenance items.
      const types = new Set(items.map((i) => i.type));
      expect(types).toContain("media-image");
      expect(types).toContain("provenance");
      // Balanced media block for measurable d'.
      const media = items.filter((i) => i.type === "media-image");
      const ai = media.filter((i) => i.signal === i.key).length;
      expect(ai).toBe(media.length - ai);
    });

    it(`${locale} deck items carry machine-translation provenance linking the en source`, () => {
      for (const item of t2Items(locale)) {
        const prov = bankById.get(item.id)!.provenance as {
          translation_provenance?: string;
          translation_note?: string;
          source_item?: string;
        };
        expect(["source", "machine-unreviewed"]).toContain(prov.translation_provenance);
        if (prov.translation_provenance === "machine-unreviewed") {
          expect(prov.translation_note).toMatch(/not been reviewed|native speaker/);
        }
        if (prov.source_item) {
          expect(bankById.get(prov.source_item)?.locale).toBe("en");
        }
      }
    });

    it(`trackConfig('t2', '${locale}') validates through the real T2 plugin`, () => {
      const cfg = validateT2Config(trackConfig("t2", locale));
      expect(cfg.items.length).toBeGreaterThanOrEqual(8);
    });

    it(`scoreTrack scores a ${locale} sitting against the ${locale} deck`, () => {
      const items = t2Items(locale);
      const artifact = {
        responses: items.map((i) => ({
          itemId: i.id, choice: i.key, confidence: 80, latencyMs: 1500,
        })),
      };
      const rec = scoreTrack("t2", artifact, locale);
      // All-correct localized sitting scores well through the real plugin…
      expect(rec.score.scaled).toBeGreaterThan(50);
      // …and beats the same artifact scored against the wrong (en) deck,
      // where every localized item id counts as a lapse.
      const wrongDeck = scoreTrack("t2", artifact, "en");
      expect(rec.score.scaled).toBeGreaterThan(wrongDeck.score.scaled);
    });
  }

  it("unknown or unpopulated locales fall back to the en deck (never empty)", () => {
    const en = t2Items("en").map((i) => i.id);
    expect(t2Items("fr").map((i) => i.id)).toEqual(en);
  });

  it("snapshot bank is locale-consistent: every ja/ko media asset is shared with en", () => {
    const items = snapshotTrack("t2").bank!.items;
    const enSrc = new Set(
      items.filter((i) => i.locale === "en")
        .map((i) => (i.material as { src?: string }).src)
        .filter(Boolean),
    );
    for (const i of items.filter((x) => x.locale !== "en")) {
      const src = (i.material as { src?: string }).src;
      if (src) expect(enSrc.has(src), `${i.locale} item references non-en asset ${src}`).toBe(true);
    }
  });

  it("SessionConfig locale values are exactly the switcher's locales", () => {
    expect([...LOCALES]).toEqual(["en", "ja", "ko"]);
    expect(SNAPSHOT.instrument.manifest.locales).toEqual(["en", "ja", "ko"]);
  });
});
