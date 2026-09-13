#!/usr/bin/env python3
"""Review sheets for any organizer candidate that exposes the Character interface.

    python3 src/char_sheets.py otter      # writes svg/15-*
    python3 src/char_sheets.py owl        # writes svg/13-*

The sheet set is the same for every candidate, which is the point: a new character is
judged on the same tests as the last one.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from build import HGT, W, GROUND, CREAM_DARK, INK, LILAC_DARK, PAPER, grid_lines, svg, text, write  # noqa: E402
from organizer import COLORWAYS, EXPRESSIONS, POSES, SELECTED, Expr, Pose, organizer_threequarter  # noqa: E402
from sheets import GRAY, chair, env_panel, visitor_placeholder  # noqa: E402
from supporting import keeper, loupe, sil_wader  # noqa: E402

EXPR_ORDER = ["neutral", "listening", "uncertainty", "overcommitment", "reconsideration", "satisfaction"]


def sheet_silhouettes(ch) -> None:
    sizes = [24, 40, 64, 120, 200]
    rows = ["neutral", "uncertainty", "overcommitment"]
    row_h = 230
    body = [text(20, 30, f"{ch.prefix}-a / {ch.name} silhouette at interface heights, three poses", 16, weight="bold")]
    for r, pose in enumerate(rows):
        y0 = 60 + r * row_h
        body.append(text(20, y0 + 118, pose, 12, weight="bold"))
        x = 120
        for s in sizes:
            body.append(f'<g transform="translate({x},{y0 + 210 - s}) scale({s / HGT})">{ch.threequarter(ch.colors, EXPRESSIONS[pose], POSES[pose], silhouette=True)}</g>')
            x += s * (W / HGT) + 30 + (60 if s >= 120 else 0)
    y0 = 60 + 3 * row_h + 20
    body.append(text(20, y0 + 10, f"lineup at 32 px: {ch.name}, cycle-1 bird, wader, keeper, loupe", 11, weight="bold"))
    x = 120
    for fn in (lambda: ch.threequarter(ch.colors, silhouette=True), lambda: organizer_threequarter(COLORWAYS[SELECTED], silhouette=True),
               sil_wader, lambda: keeper(silhouette=True), lambda: loupe(silhouette=True)):
        body.append(f'<g transform="translate({x},{y0 + 20}) scale({32 / HGT})">{fn()}</g>')
        x += 32 * (W / HGT) + 16
    write(f"{ch.prefix}-a-{ch.name}-silhouettes.svg", svg(760, y0 + 70, "\n".join(body)))


def sheet_expressions(ch) -> None:
    body = [text(30, 34, f"{ch.prefix}-b / {ch.name} expressions. Same five controls. {ch.exception_note}", 16, weight="bold")]
    for i, name in enumerate(EXPR_ORDER):
        x = 30 + i * 200
        body.append(f'<g transform="translate({x + 90},{190})">{ch.head_threequarter(ch.colors, EXPRESSIONS[name])}</g>')
        body.append(text(x + 90, 262, name, 12, anchor="middle", weight="bold"))
        body.append(f'<g transform="translate({x + 60},{340}) scale(0.64)">{ch.head_threequarter(ch.colors, EXPRESSIONS[name])}</g>')
    body.append(text(30, 372, "second row: 64 px head height", 10))
    write(f"{ch.prefix}-b-{ch.name}-expressions.svg", svg(30 + 6 * 200, 390, "\n".join(body)))


def sheet_turnaround(ch) -> None:
    views = [("front", ch.front(ch.colors)), ("three-quarter", ch.threequarter(ch.colors)), ("side", ch.side(ch.colors)), ("back", ch.back(ch.colors))]
    body = [text(30, 34, f"{ch.prefix}-c / {ch.name} turnaround. Head units shared across views.", 16, weight="bold")]
    for i, (label, fig) in enumerate(views):
        x = 30 + i * (W + 20)
        body.append(f'<g transform="translate({x},60)">')
        body.append(grid_lines(ch.head_h, ch.head_top, (GROUND - ch.head_top) / ch.head_h))
        body.append(f'<line x1="0" y1="{GROUND}" x2="{W}" y2="{GROUND}" stroke="{INK}" stroke-width="1"/>')
        body.append(fig)
        body.append("</g>")
        body.append(text(x + W / 2, 60 + HGT + 22, label, 13, anchor="middle", weight="bold"))
    x = 30 + 4 * (W + 20)
    body.append(f'<g transform="translate({x},60)"><line x1="0" y1="{GROUND}" x2="{W}" y2="{GROUND}" stroke="{INK}" stroke-width="1"/>{loupe()}{chair(170, GROUND)}</g>')
    body.append(text(x + W / 2, 60 + HGT + 22, "scale: loupe and chair", 12, anchor="middle", weight="bold"))
    for j, n in enumerate(ch.notes):
        body.append(text(30, 60 + HGT + 50 + j * 16, n, 11))
    write(f"{ch.prefix}-c-{ch.name}-turnaround.svg", svg(30 + 5 * (W + 20), 60 + HGT + 60 + 16 * len(ch.notes) + 10, "\n".join(body)))


def sheet_poses(ch) -> None:
    names = ["listening", "uncertainty", "overcommitment", "reconsideration", "satisfaction"]
    body = [text(30, 34, f"{ch.prefix}-d / {ch.name} poses. Same pose table as cycle 1.", 16, weight="bold")]
    for i, n in enumerate(names):
        x = 30 + i * (W + 20)
        body.append(f'<g transform="translate({x},60)"><rect width="{W}" height="{HGT}" fill="none" stroke="{CREAM_DARK}"/>')
        body.append(f'<line x1="0" y1="{GROUND}" x2="{W}" y2="{GROUND}" stroke="{CREAM_DARK}" stroke-width="1"/>')
        body.append(ch.threequarter(ch.colors, EXPRESSIONS[n], POSES[n]))
        if n == "reconsideration":
            body.append(f'<g transform="translate(238,228) rotate(-8)"><rect x="-22" y="-14" width="44" height="30" fill="{PAPER}" stroke="{INK}" stroke-width="2"/><line x1="-14" y1="-4" x2="14" y2="-4" stroke="{INK}" stroke-width="1.2"/><line x1="-14" y1="4" x2="14" y2="4" stroke="{INK}" stroke-width="1.2"/></g>')
        body.append("</g>")
        body.append(text(x + W / 2, 60 + HGT + 22, n, 13, anchor="middle", weight="bold"))
    write(f"{ch.prefix}-d-{ch.name}-poses.svg", svg(30 + 5 * (W + 20), 60 + HGT + 50, "\n".join(body)))


def sheet_cast(ch, grayscale: bool, alt_colors=None) -> None:
    title = f"{ch.prefix}-{'f' if grayscale else 'e'} / Cast with the {ch.name}" + (" (grayscale, garments removed)" if grayscale else " (color, in the Commons)")
    body = [GRAY, text(30, 34, title, 16, weight="bold")]
    wrap = 'filter="url(#gray)"' if grayscale else ""
    cols = 4 if alt_colors else 3
    body.append(f"<g {wrap}>")
    body.append(env_panel(30, 60, cols * W + (cols - 1) * 20, HGT))
    body.append(f'<g transform="translate(30,60)">{ch.threequarter(ch.colors, garment=not grayscale)}</g>')
    labels = [ch.label]
    x = 30 + W + 20
    if alt_colors:
        body.append(f'<g transform="translate({x},60)">{ch.threequarter(alt_colors, garment=not grayscale)}</g>')
        labels.append(alt_colors.name)
        x += W + 20
    body.append(f'<g transform="translate({x},60)">{keeper(garment=not grayscale)}</g>')
    body.append(f'<g transform="translate({x + W + 20},60)">{loupe()}</g>')
    labels += ["source keeper, low/broad family", "loupe companion, instrument family"]
    body.append("</g>")
    for i, label in enumerate(labels):
        body.append(text(30 + i * (W + 20) + W / 2, 60 + HGT + 22, label, 12, anchor="middle", weight="bold"))
    write(f"{ch.prefix}-{'f' if grayscale else 'e'}-{ch.name}-cast{'-grayscale' if grayscale else '-color'}.svg",
          svg(30 + cols * W + (cols - 1) * 20 + 30, 60 + HGT + 50, "\n".join(body)))


def sheet_collaboration(ch) -> None:
    from palette import GREEN, WOOD, WOOD_DARK, CORAL_DARK
    body = [text(30, 34, f"{ch.prefix}-g / {ch.name} at the table with the visitor", 16, weight="bold")]
    body.append(f'<rect x="30" y="60" width="760" height="420" fill="{GREEN}"/>')
    body.append(f'<g transform="translate(150,150)">{ch.threequarter(ch.colors, EXPRESSIONS["satisfaction"], POSES["chair"])}</g>')
    body.append(visitor_placeholder(600, 430))
    body.append(f'<rect x="30" y="380" width="760" height="100" fill="{WOOD}"/>')
    body.append(f'<rect x="30" y="380" width="760" height="8" fill="{WOOD_DARK}"/>')
    body.append('<g transform="translate(360,398) skewX(-12)">')
    body.append(f'<rect x="0" y="0" width="200" height="66" fill="{PAPER}" stroke="{INK}" stroke-width="2"/>')
    for r in range(2):
        for k in range(8):
            cx, cy = 16 + k * 24, 18 + r * 30
            body.append(f'<rect x="{cx - 7}" y="{cy - 7}" width="14" height="14" fill="none" stroke="{INK}" stroke-width="1.5"/>')
            if k >= 5:
                body.append(f'<path d="M{cx - 8},{cy - 8} L{cx + 8},{cy + 8} M{cx + 8},{cy - 8} L{cx - 8},{cy + 8}" stroke="{CORAL_DARK}" stroke-width="2.5"/>')
    body.append("</g>")
    write(f"{ch.prefix}-g-{ch.name}-collaboration.svg", svg(820, 500, "\n".join(body)))


def sheet_deformation(ch) -> None:
    cells = [("head tilt +20", Expr(head_tilt=20), Pose()), ("head tilt -20", Expr(head_tilt=-20), Pose()),
             ("limbs 0 and 150", Expr(), Pose(wing_near=150, wing_far=0)), ("lean +14", Expr(), Pose(lean=14))]
    body = [text(30, 34, f"{ch.prefix}-h / {ch.name} deformation limits. Circles mark the pivots.", 16, weight="bold")]
    for i, (label, e, p) in enumerate(cells):
        x = 30 + i * (W + 20)
        body.append(f'<g transform="translate({x},60)"><rect width="{W}" height="{HGT}" fill="none" stroke="{CREAM_DARK}"/>')
        body.append(ch.threequarter(ch.colors, e, p))
        for px, py in ch.pivots:
            body.append(f'<circle cx="{px}" cy="{py}" r="4" fill="none" stroke="{LILAC_DARK}" stroke-width="1.5"/>')
        body.append("</g>")
        body.append(text(x + W / 2, y := 60 + HGT + 18, label, 12, anchor="middle", weight="bold"))
    write(f"{ch.prefix}-h-{ch.name}-deformation.svg", svg(30 + 4 * (W + 20), 60 + HGT + 40, "\n".join(body)))


def run(ch, alt_colors=None) -> None:
    sheet_silhouettes(ch)
    sheet_expressions(ch)
    sheet_turnaround(ch)
    sheet_poses(ch)
    sheet_cast(ch, False, alt_colors)
    sheet_cast(ch, True, alt_colors)
    sheet_collaboration(ch)
    sheet_deformation(ch)


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "otter"
    if which == "otter":
        import otter
        run(otter.Character, otter.OTTER_LIGHT)
    else:
        raise SystemExit("owl sheets are produced by owl_sheets.py")
