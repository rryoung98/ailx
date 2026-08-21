/**
 * Hand-drawn script annotation with a curved arrow, Zero-style. Server-safe
 * (pure SVG + CSS); decorative by default (aria-hidden) — the annotated
 * content must carry the meaning.
 */
export function Annotation({
  children,
  side = "right",
}: {
  children: React.ReactNode;
  side?: "left" | "right";
}) {
  const arrow = (
    <svg viewBox="0 0 34 26" aria-hidden focusable="false" style={side === "left" ? { transform: "scaleX(-1)" } : undefined}>
      <path d="M2 4 C 12 2, 24 8, 29 20" />
      <path d="M23 17 L 29 20 L 30 13" />
    </svg>
  );
  return (
    <span className="annotation" aria-hidden>
      {side === "left" ? arrow : null}
      <span>{children}</span>
      {side === "right" ? arrow : null}
    </span>
  );
}
