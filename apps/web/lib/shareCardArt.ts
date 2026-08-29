/**
 * Social-preview card art for a share link — the element tree only, with no
 * renderer imported, so it is pure, unit-testable and usable from any
 * runtime. `app/api/share/[token]/card.png/route.api.ts` rasterizes it.
 *
 * WHY A RASTER PNG AND NOT SVG: Facebook, X, LinkedIn and Slack do not render
 * SVG `og:image`, so an SVG preview means NO preview, and the growth loop
 * dies at the first paste. The rasterizer is `next/og`, which ships inside
 * Next.js — no new dependency, no network at render time (FRONTEND.md §4.6),
 * and the output is deterministic given the stored payload.
 *
 * The text comes from `shareCardLines` in @ailx/report, so the image can
 * never drift from the page it previews.
 */
import { createElement, type ReactElement } from "react";
import { shareCardLines, type SharePayload } from "@ailx/report";

export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;

/**
 * Literal twins of the `:root` tokens in app/globals.css. The rasterizer has
 * no stylesheet and cannot read a CSS custom property, so these must be
 * duplicated — apps/web/test/shareCard.test.ts parses globals.css and fails
 * if the two ever drift.
 */
export const SHARE_CARD_COLORS = {
  bg: "#f7f4f2",
  card: "#ffffff",
  fg: "#1a1a1a",
  muted: "#595650",
  faint: "#6b665f",
  accent: "#0b6b47",
  border: "#e3ddd6",
} as const;

const MONO = "ui-monospace, monospace";

/** Deterministic 1200×630 card. Every value comes from the frozen payload. */
export function shareCardElement(payload: SharePayload): ReactElement {
  const lines = shareCardLines(payload);
  const box = (style: Record<string, unknown>, children: unknown) =>
    createElement("div", { style: { display: "flex", ...style } }, children as never);

  return box(
    {
      width: "100%",
      height: "100%",
      flexDirection: "column",
      justifyContent: "space-between",
      background: SHARE_CARD_COLORS.bg,
      color: SHARE_CARD_COLORS.fg,
      padding: "56px 64px",
      fontFamily: "sans-serif",
    },
    [
      box(
        { key: "head", justifyContent: "space-between", alignItems: "center", fontSize: 26, color: SHARE_CARD_COLORS.muted, letterSpacing: 4, fontFamily: MONO },
        [
          box({ key: "e" }, lines.eyebrow),
          box(
            {
              key: "b",
              border: `2px solid ${SHARE_CARD_COLORS.accent}`,
              color: SHARE_CARD_COLORS.accent,
              borderRadius: 999,
              padding: "6px 22px",
              letterSpacing: 2,
            },
            lines.band,
          ),
        ],
      ),
      box({ key: "body", flexDirection: "column" }, [
        box(
          { key: "code", fontSize: 132, fontWeight: 800, letterSpacing: 22, color: SHARE_CARD_COLORS.accent, fontFamily: MONO },
          lines.code,
        ),
        box({ key: "name", fontSize: 58, fontWeight: 700, marginTop: 4 }, lines.name),
        box(
          { key: "tag", fontSize: 30, color: SHARE_CARD_COLORS.muted, marginTop: 10, maxWidth: 900 },
          lines.tagline,
        ),
      ]),
      box({ key: "foot", flexDirection: "column" }, [
        box(
          { key: "tracks", gap: 28, fontSize: 26, fontFamily: MONO, color: SHARE_CARD_COLORS.fg },
          lines.tracks.map((t) =>
            box({ key: t.track, gap: 8 }, [
              box({ key: "k", color: SHARE_CARD_COLORS.accent }, t.track),
              box({ key: "v" }, t.value.toFixed(1)),
            ]),
          ),
        ),
        box(
          { key: "cta", fontSize: 24, color: SHARE_CARD_COLORS.faint, marginTop: 18 },
          "AILX — the AI-literacy exam you can play. Find your type.",
        ),
      ]),
    ],
  );
}
