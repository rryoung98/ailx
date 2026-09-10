"use client";
/**
 * Warning banner — ONE component for the five phase branches of the exam page
 * (start gate, hydrating, between tracks, in track, completed). It was
 * copy-pasted inline five times with hardcoded dark-theme hex colours that
 * survived the light-palette migration; the shipped tokens are the single
 * source of truth for colour (AGENTS.md: DRY).
 *
 * Renders nothing when there is no warning, so every call site is a plain
 * `<PersistWarning warning={persistWarning} />`. `label` names the kind of
 * warning (default: persistence) — the start gate also uses it for the
 * stale-build block, and `MirrorWarning` for the unmirrored-sitting one.
 * Same banner, no second component and no second copy of the style: three
 * inline copies of these nine properties shipped to the browser before this
 * prop existed (AGENTS.md: DRY).
 *
 * `testId` is what tells the banners apart in a test, and it is the ONLY
 * thing that varies besides the words.
 */
export function PersistWarning({
  warning,
  label = "Persistence warning",
  testId = "persist-warning",
}: {
  warning: string | null;
  label?: string;
  testId?: string;
}) {
  if (!warning) return null;
  return (
    <div
      role="alert"
      data-testid={testId}
      style={{
        background: "var(--card)",
        border: "1px solid var(--bad)",
        borderLeft: "4px solid var(--bad)",
        color: "var(--bad)",
        padding: "0.6rem 0.9rem",
        borderRadius: 8,
        margin: "0.6rem auto",
        maxWidth: 980,
        fontSize: "0.85rem",
      }}
    >
      ⚠ {label}: {warning}
    </div>
  );
}
