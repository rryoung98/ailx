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
 * never drift from the page it previews — including the opt-in extras: the
 * candidate's own note (or their first strength) becomes the highlight line,
 * and time-on-task / finish day / "built a site" become footnotes. A section
 * the candidate left off simply produces no line.
 */
import { createElement, type ReactElement } from "react";
import { shareCardLines, type SharePayload } from "@ailx/report";

export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;

/**
 * The card is a FIXED 630px box, so long opt-in text is a layout bug, not a
 * cosmetic one: a two-line tagline plus a 240-character note used to push the
 * footer off the bottom edge and the invitation line was rasterized cut in
 * half — on the one image a stranger sees before deciding to click.
 *
 * Two independent guards, because they fail differently:
 *  1. `clampLine` bounds the STRING (pure, testable without a rasterizer);
 *  2. `lineClamp` bounds the BOX in satori, for text that is wide in pixels
 *     rather than long in characters (CJK, caps, a pasted URL).
 *
 * The character budgets below are ~2 lines at the font size each line is
 * drawn at, measured against the widest Latin text the payload can carry.
 */
const TAGLINE_MAX_CHARS = 108;
const HIGHLIGHT_MAX_CHARS = 150;

/**
 * The character portrait, and the width the text beside it may now use.
 * The body row is 1072px wide inside the padding; the portrait and its gap
 * take 240, so the tagline clamp box shrinks by exactly that much. Getting
 * this wrong pushes a two-line tagline into the footer.
 */
const PORTRAIT_PX = 200;
const PORTRAIT_TEXT_MAX_WIDTH = 760;

/** Trim to `max` characters on a word boundary, with a real ellipsis. */
export function clampLine(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}\u2026`;
}

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

/**
 * Deterministic 1200×630 card. Every value comes from the frozen payload.
 *
 * Height budget (630 − 112px padding = 518px of content): head 48 · body 288 ·
 * foot 175. Every font size, margin and clamp below is part of that sum — if
 * you raise one, take it from another, or the footer clips off the card.
 */
export function shareCardElement(payload: SharePayload, portrait: string | null = null): ReactElement {
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
      overflow: "hidden",
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
      box({ key: "body", alignItems: "center", gap: 40 }, [
        box({ key: "text", flexDirection: "column", flexGrow: 1 }, [
          box(
            { key: "code", fontSize: 120, fontWeight: 800, letterSpacing: 22, color: SHARE_CARD_COLORS.accent, fontFamily: MONO },
            lines.code,
          ),
          box({ key: "name", fontSize: 52, fontWeight: 700, marginTop: 4 }, lines.name),
          box(
            { key: "tag", fontSize: 28, color: SHARE_CARD_COLORS.muted, marginTop: 10, maxWidth: PORTRAIT_TEXT_MAX_WIDTH, lineClamp: 2 },
            clampLine(lines.tagline, TAGLINE_MAX_CHARS),
          ),
        ]),
        /* The character, when the caller could load it. Decorative HERE and
           only here: the code, the name and the tagline are on the card as
           text already, and alt text is not a thing a PNG can carry — so a
           missing portrait costs the card nothing but charm. */
        portrait === null
          ? box({ key: "face" }, "")
          : createElement("img", {
              key: "face",
              src: portrait,
              width: PORTRAIT_PX,
              height: PORTRAIT_PX,
              style: {
                width: PORTRAIT_PX,
                height: PORTRAIT_PX,
                borderRadius: 28,
                border: `2px solid ${SHARE_CARD_COLORS.border}`,
              },
            }),
      ]),
      box({ key: "foot", flexDirection: "column" }, [
        lines.highlight === null
          ? box({ key: "hl" }, "")
          : box(
              {
                key: "hl",
                fontSize: 26,
                color: SHARE_CARD_COLORS.fg,
                borderLeft: `4px solid ${SHARE_CARD_COLORS.accent}`,
                paddingLeft: 18,
                marginBottom: 16,
                maxWidth: 1000,
                lineClamp: 2,
              },
              clampLine(lines.highlight, HIGHLIGHT_MAX_CHARS),
            ),
        /* The four-track shape, drawn. Numbers alone read as a receipt; the
           bars are what make the card legible at thumbnail size, and they are
           the SAME four values the page shows. */
        box(
          { key: "tracks", gap: 26, fontSize: 26, fontFamily: MONO, color: SHARE_CARD_COLORS.fg, alignItems: "center" },
          lines.tracks.map((t) =>
            box({ key: t.track, gap: 8, alignItems: "center" }, [
              box({ key: "k", color: SHARE_CARD_COLORS.accent }, t.track),
              box({ key: "v" }, t.value.toFixed(1)),
              box(
                { key: "bar", width: 84, height: 8, borderRadius: 4, background: SHARE_CARD_COLORS.border },
                box({
                  key: "fill",
                  width: `${Math.max(2, Math.min(100, t.value))}%`,
                  height: "100%",
                  borderRadius: 4,
                  background: SHARE_CARD_COLORS.accent,
                }, ""),
              ),
            ]),
          ),
        ),
        box(
          { key: "cta", fontSize: 22, color: SHARE_CARD_COLORS.faint, marginTop: 14, gap: 14, flexWrap: "wrap" },
          [
            box({ key: "t" }, "AILX — the AI-literacy exam you can play. Find your type."),
            ...lines.footnotes.map((f, i) =>
              box({ key: `f${i}`, gap: 14 }, [box({ key: "d" }, "·"), box({ key: "v" }, f)]),
            ),
          ],
        ),
      ]),
    ],
  );
}
