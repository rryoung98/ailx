"use client";

/**
 * Scroll reveal wrapper. SOTA path is pure CSS (animation-timeline: view()
 * in globals.css); this component only backfills browsers without it by
 * toggling data-reveal via IntersectionObserver (once). Reduced motion is
 * handled entirely in CSS (everything visible, nothing animated).
 */
import { useEffect, useRef } from "react";

export function Reveal({ children, as: Tag = "div", className = "", ...rest }: {
  children: React.ReactNode;
  as?: "div" | "section" | "li";
  className?: string;
} & Record<string, unknown>) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const css = (globalThis as { CSS?: { supports?: (q: string) => boolean } }).CSS;
    if (css?.supports?.("animation-timeline: view()")) return; // native path
    if (typeof IntersectionObserver === "undefined") return; // ancient/jsdom: stay visible
    el.setAttribute("data-reveal", "pending");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.setAttribute("data-reveal", "shown");
            io.disconnect();
          }
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag ref={ref as never} className={`reveal ${className}`.trim()} {...rest}>
      {children}
    </Tag>
  );
}
