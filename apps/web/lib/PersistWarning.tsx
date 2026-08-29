"use client";
/**
 * Persistence warning banner — ONE component for the five phase branches of
 * the exam page (start gate, hydrating, between tracks, in track, completed).
 * It was copy-pasted inline five times with hardcoded dark-theme hex colours
 * that survived the light-palette migration; the shipped tokens are the
 * single source of truth for colour (AGENTS.md: DRY).
 *
 * Renders nothing when there is no warning, so every call site is a plain
 * `<PersistWarning warning={persistWarning} />`.
 */
export function PersistWarning({ warning }: { warning: string | null }) {
  if (!warning) return null;
  return (
    <div
      role="alert"
      data-testid="persist-warning"
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
      ⚠ Persistence warning: {warning}
    </div>
  );
}
