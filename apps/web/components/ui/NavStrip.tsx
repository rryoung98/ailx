"use client";

import { useEffect, useRef } from "react";

/**
 * The primary nav is one horizontally scrolling row below 860px, with its
 * scrollbar hidden. Two things follow from that, and neither is decoration:
 *
 * 1. The current page's link is often outside the visible strip. On /gallery
 *    at 320px the "Gallery" link sat at x=315 while the strip ended at
 *    x=203, so the page carried NO current-page marker at all. This scrolls
 *    it into view once, on mount.
 * 2. A hidden scrollbar means the strip's right edge just slices a link
 *    mid-word, which reads as a rendering fault rather than "swipe for
 *    more". globals.css fades that edge; this clears the fade once there is
 *    nothing further right, so the last link is never dimmed for no reason.
 *
 * Both are no-ops on a wide viewport, where the row does not scroll.
 */
export function NavStrip({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const strip = ref.current;
    if (!strip) return;

    const markEnd = () => {
      const scrollable = strip.scrollWidth - strip.clientWidth;
      // 1px of slack: fractional layout widths make an exact compare flap.
      const atEnd = scrollable <= 1 || strip.scrollLeft >= scrollable - 1;
      strip.dataset.scrollEnd = atEnd ? "1" : "0";
    };

    const current = strip.querySelector<HTMLElement>('[aria-current="page"]');
    if (current && strip.scrollWidth > strip.clientWidth) {
      current.scrollIntoView({ inline: "center", block: "nearest" });
    }
    markEnd();

    strip.addEventListener("scroll", markEnd, { passive: true });
    window.addEventListener("resize", markEnd);
    return () => {
      strip.removeEventListener("scroll", markEnd);
      window.removeEventListener("resize", markEnd);
    };
  }, []);

  return (
    <div className="nav-links" ref={ref}>
      {children}
    </div>
  );
}
