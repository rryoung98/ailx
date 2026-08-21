"use client";

/**
 * Sticky bottom-center pill CTA (Zero-style). Fixed, safe-area aware; give
 * pages that use it bottom padding so content is never trapped beneath it.
 */
import Link from "next/link";

export function PillCTA({
  href,
  onClick,
  children,
}: {
  href?: string;
  onClick?: () => void;
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
    <button type="button" className="pill-cta" onClick={onClick}>
      {inner}
    </button>
  );
}
