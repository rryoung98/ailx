"use client";

/**
 * Content-locale selection (en/ja/ko), persisted at localStorage
 * 'ailx:locale'. The chosen locale flows into SessionConfig.locale at
 * attempt start and selects the localized T2 item deck. Exam UI chrome
 * stays English in this demo build (scope control) — only ITEM content
 * localizes; ja/ko items are machine-translated and marked unreviewed
 * in their provenance.
 */
import { useSyncExternalStore } from "react";

export type Locale = "en" | "ja" | "ko";

export const LOCALES: readonly Locale[] = ["en", "ja", "ko"] as const;

export const LOCALE_STORAGE_KEY = "ailx:locale";

/** Window event fired after a same-tab locale change. */
export const LOCALE_EVENT = "ailx:locale-changed";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "EN",
  ja: "日本語",
  ko: "한국어",
};

/** Shown beside the switcher: content localizes, chrome does not. */
export const LOCALE_SCOPE_NOTE =
  "Item content follows this locale; game UI chrome stays English in the demo.";

export function isLocale(v: unknown): v is Locale {
  return v === "en" || v === "ja" || v === "ko";
}

/** Read the persisted locale; unknown/absent/corrupt values fall back to en. */
export function loadLocale(storage: Pick<Storage, "getItem">): Locale {
  try {
    const v = storage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(v) ? v : "en";
  } catch {
    return "en";
  }
}

export function saveLocale(
  storage: Pick<Storage, "setItem" | "removeItem">,
  locale: Locale,
): void {
  if (!isLocale(locale)) throw new Error(`invalid locale: ${String(locale)}`);
  storage.setItem(LOCALE_STORAGE_KEY, locale);
}

/** Persist + notify same-tab subscribers (cross-tab rides 'storage'). */
export function setLocale(locale: Locale): void {
  saveLocale(window.localStorage, locale);
  window.dispatchEvent(new Event(LOCALE_EVENT));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(LOCALE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(LOCALE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function getSnapshot(): Locale {
  return loadLocale(window.localStorage);
}

function getServerSnapshot(): Locale {
  return "en";
}

/** Reactive persisted locale (SSR/static-export safe: server snapshot en). */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
