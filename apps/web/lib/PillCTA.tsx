"use client";

/**
 * Sticky bottom-center pill CTA (Zero-style). Fixed, safe-area aware; give
 * pages that use it bottom padding so content is never trapped beneath it.
 *
 * Mobile guard: on <= 640px viewports the pill hides itself while any
 * element marked [data-pill-clear] (teaser actions, connect panel, runner
 * controls) intersects the bottom band of the viewport, so it can never
 * cover a tappable control.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

const CLEAR_BAND_PX = 140;

export function PillCTA({
  href,
  onClick,
  children,
}: {
  href?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;
    const mq = window.matchMedia("(max-width: 640px)");
    const els = Array.from(document.querySelectorAll("[data-pill-clear]"));
    if (els.length === 0) return;
    const intersecting = new Set<Element>();
    let io: IntersectionObserver | null = null;
    const attach = () => {
      io?.disconnect();
      intersecting.clear();
      // Root = the bottom CLEAR_BAND_PX of the viewport (negative top margin
      // shrinks the root box from the top).
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) intersecting.add(e.target);
            else intersecting.delete(e.target);
          }
          setCleared(mq.matches && intersecting.size > 0);
        },
        { rootMargin: `${CLEAR_BAND_PX - window.innerHeight}px 0px 0px 0px` },
      );
      for (const el of els) io.observe(el);
    };
    attach();
    const onChange = () => attach();
    mq.addEventListener?.("change", onChange);
    window.addEventListener("resize", onChange);
    return () => {
      io?.disconnect();
      mq.removeEventListener?.("change", onChange);
      window.removeEventListener("resize", onChange);
    };
  }, []);

  const cls = `pill-cta${cleared ? " pill-cta-cleared" : ""}`;
  const inner = (
    <>
      <span className="dot" aria-hidden />
      {children}
    </>
  );
  if (href) {
    return (
      <Link className={cls} href={href}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} onClick={onClick}>
      {inner}
    </button>
  );
}
