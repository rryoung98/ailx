"use client";

/**
 * Sticky bottom-center pill CTA (Zero-style). Fixed, safe-area aware; give
 * pages that use it bottom padding so content is never trapped beneath it.
 * `disabled` renders the gated state (still clickable so the page can
 * redirect attention, e.g. pulse the ConnectPanel) — aria-disabled only.
 */
import Link from "next/link";

export function PillCTA({
  href,
  onClick,
  disabled,
  children,
}: {
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const inner = (
    <>
      <span className="dot" aria-hidden />
      {children}
    </>
  );
  if (href) {
    return (
      <Link className="pill-cta" href={href}>
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={`pill-cta${disabled ? " disabled" : ""}`}
      aria-disabled={disabled || undefined}
      onClick={onClick}
    >
      {inner}
    </button>
  );
}
