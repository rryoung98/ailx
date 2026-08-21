"use client";

/**
 * Header locale switcher (en/ja/ko). Persists to localStorage 'ailx:locale'
 * and notifies same-tab listeners. Scope control: only ITEM content
 * localizes — exam UI chrome stays English in the demo, and the switcher
 * says so where the locale is switched.
 */
import {
  LOCALES, LOCALE_LABELS, LOCALE_SCOPE_NOTE, setLocale, useLocale,
} from "./locale";

export function LocaleSwitcher() {
  const locale = useLocale();
  return (
    <span
      className="locale-switcher"
      role="group"
      aria-label="Content locale"
      title={LOCALE_SCOPE_NOTE}
      style={{ display: "inline-flex", gap: "0.15rem", alignItems: "center" }}
    >
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={locale === l}
          onClick={() => setLocale(l)}
          style={{
            background: locale === l ? "var(--accent, #7bd88f)" : "transparent",
            color: locale === l ? "var(--bg, #0b0d10)" : "inherit",
            border: "1px solid var(--faint, #444)",
            borderRadius: 6,
            padding: "0.1rem 0.45rem",
            fontSize: "0.75rem",
            cursor: "pointer",
          }}
        >
          {LOCALE_LABELS[l]}
        </button>
      ))}
      <span className="faint small" style={{ marginLeft: "0.35rem", fontSize: "0.65rem" }}>
        item content only — UI stays English
      </span>
    </span>
  );
}
