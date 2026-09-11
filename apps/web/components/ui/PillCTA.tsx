"use client";

/**
 * Sticky bottom-center pill CTA (Zero-style). Fixed, safe-area aware; give
 * pages that use it bottom padding so content is never trapped beneath it.
 *
 * Clearance guard: the pill hides itself while any element marked
 * [data-pill-clear] (connect panel, runner controls, landing
 * CTAs) intersects the bottom band of the viewport, so it can never cover a
 * tappable control — at ANY width. It was mobile-only, which was arbitrary:
 * a fixed pill sits on a desktop heading exactly as hard as on a phone
 * button, and on the landing page it did.
 *
 * End-of-page guard: the pill also hides once the reader reaches the last
 * PAGE_END_PX of the document, where the site footer lives. The footer is in
 * the layout, so no page can mark it, and the pill was rasterizing straight
 * across its text. That guard applies only when the document scrolls FARTHER
 * than the band it hides in — overflow > PAGE_END_PX. Below that there is no
 * position the reader can take that is not "at the end", so clearing the pill
 * hides it for the whole life of the page and no scroll event can bring it
 * back: on a tall display or in a zoomed-out browser (a low-vision setting)
 * that took the only Start control on /exam away at first paint, with no
 * error and nothing to tab to. A page that does not scroll has no footer to
 * clear.
 *
 * `disabled` renders the gated state (still clickable so the page can
 * redirect attention, e.g. pulse the ConnectPanel) — aria-disabled only.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

const CLEAR_BAND_PX = 140;
/** Distance from the document bottom at which the footer is in play. */
const PAGE_END_PX = 180;

export function PillCTA({
  href,
  onClick,
  disabled,
  busy,
  children,
}: {
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  /**
   * The action this pill started has not finished (TEN-211). The pill is the
   * first thing a candidate does, and a request behind it can take as long as
   * the write bound allows; without this the press changed nothing on screen
   * and a repeat tap was dropped in silence. `aria-busy` says it to a screen
   * reader; the caller says it in the label.
   */
  busy?: boolean;
  children: React.ReactNode;
}) {
  const [overlapping, setOverlapping] = useState(false);
  const [atPageEnd, setAtPageEnd] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;
    const intersecting = new Set<Element>();
    let io: IntersectionObserver | null = null;
    // Re-query on every attach: the marked controls are the page's, and a
    // panel can mount after this one does.
    const attach = () => {
      io?.disconnect();
      intersecting.clear();
      setOverlapping(false);
      const els = Array.from(document.querySelectorAll("[data-pill-clear]"));
      // Root = the bottom CLEAR_BAND_PX of the viewport (negative top margin
      // shrinks the root box from the top).
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) intersecting.add(e.target);
            else intersecting.delete(e.target);
          }
          setOverlapping(intersecting.size > 0);
        },
        { rootMargin: `${CLEAR_BAND_PX - window.innerHeight}px 0px 0px 0px` },
      );
      for (const el of els) io.observe(el);
    };
    attach();
    window.addEventListener("resize", attach);
    return () => {
      io?.disconnect();
      window.removeEventListener("resize", attach);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const read = () => {
      const doc = document.documentElement;
      const overflow = doc.scrollHeight - window.innerHeight;
      const remaining = overflow - window.scrollY;
      setAtPageEnd(overflow > PAGE_END_PX && remaining <= PAGE_END_PX);
    };
    read();
    window.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", read);
    // Geometry changes without a scroll or a resize: a panel opens, a form
    // grows, an image lands. Re-read the document box itself so the guard is
    // never stuck on a measurement taken at mount.
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(read);
      ro.observe(document.documentElement);
    }
    return () => {
      window.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
      ro?.disconnect();
    };
  }, []);

  const cleared = overlapping || atPageEnd;
  /* One class, no inline twin. `.pill-cta-cleared` in globals.css carries
     opacity, pointer-events and the slide, at EVERY width — it used to be
     gated inside a 640px media query, which is why this component also
     wrote the same three declarations inline. The reduced-motion snap lives
     in the same stylesheet block. */
  const cls = `pill-cta${cleared ? " pill-cta-cleared" : ""}`;
  const inner = (
    <>
      <span className="dot" aria-hidden />
      {children}
    </>
  );
  if (href) {
    return (
      <Link className={cls} href={href} aria-hidden={cleared || undefined} tabIndex={cleared ? -1 : undefined}>
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={`${cls}${disabled ? " disabled" : ""}`}
     
      aria-disabled={disabled || undefined}
      aria-busy={busy || undefined}
      aria-hidden={cleared || undefined}
      tabIndex={cleared ? -1 : undefined}
      onClick={onClick}
    >
      {inner}
    </button>
  );
}
