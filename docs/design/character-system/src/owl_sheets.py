#!/usr/bin/env python3
"""Cycle 2 sheets for the owl organizer. Numbered 13-* so cycle 1 stays readable."""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from build import HGT, W, GROUND, CREAM_DARK, INK, LILAC_DARK, PAPER, STROKE, grid_lines, svg, text, write  # noqa: E402
from organizer import EXPRESSIONS, POSES, Expr, Pose  # noqa: E402
from owl import HEAD_C, HEAD_R, OWL, owl_back, owl_front, owl_side, owl_threequarter, head_threequarter  # noqa: E402
from sheets import GRAY, chair, env_panel, visitor_placeholder  # noqa: E402
from supporting import keeper, loupe, sil_wader  # noqa: E402


def sheet_owl_silhouettes() -> None:
    sizes = [24, 40, 64, 120, 200]
    rows = [("neutral", "neutral"), ("uncertainty", "uncertainty"), ("overcommitment", "overcommitment")]
    row_h = 230
    body = [text(20, 30, "13-a / Owl silhouette at interface heights, three poses", 16, weight="bold")]
    for r, (label, pose) in enumerate(rows):
        y0 = 60 + r * row_h
        body.append(text(20, y0 + 118, label, 12, weight="bold"))
        x = 120
        for s in sizes:
            body.append(f'<g transform="translate({x},{y0 + 210 - s}) scale({s / HGT})">{owl_threequarter(OWL, EXPRESSIONS[pose], POSES[pose], silhouette=True)}</g>')
            x += s * (W / HGT) + 30 + (60 if s >= 120 else 0)
    # lineup at 32 px next to the cast and the old bird
    from organizer import COLORWAYS, SELECTED, organizer_threequarter
    y0 = 60 + 3 * row_h + 20
    body.append(text(20, y0 + 10, "lineup at 32 px: owl, cycle-1 bird, wader, keeper, loupe", 11, weight="bold"))
    x = 120
    for fn in (lambda: owl_threequarter(silhouette=True), lambda: organizer_threequarter(COLORWAYS[SELECTED], silhouette=True),
               sil_wader, lambda: keeper(silhouette=True), lambda: loupe(silhouette=True)):
        body.append(f'<g transform="translate({x},{y0 + 20}) scale({32 / HGT})">{fn()}</g>')
        x += 32 * (W / HGT) + 16
    write("13-a-owl-silhouettes.svg", svg(760, y0 + 70, "\n".join(body)))


EXPR_ORDER = ["neutral", "listening", "uncertainty", "overcommitment", "reconsideration", "satisfaction"]


def sheet_owl_expressions() -> None:
    body = [text(30, 34, "13-b / Owl expressions. Same five controls. The beak is fixed, so overcommitment uses brows, eyes and tufts.", 16, weight="bold")]
    for i, name in enumerate(EXPR_ORDER):
        x = 30 + i * 200
        body.append(f'<g transform="translate({x + 90},{190})">{head_threequarter(OWL, EXPRESSIONS[name])}</g>')
        body.append(text(x + 90, 262, name, 12, anchor="middle", weight="bold"))
        body.append(f'<g transform="translate({x + 60},{340}) scale(0.64)">{head_threequarter(OWL, EXPRESSIONS[name])}</g>')
    body.append(text(30, 372, "second row: 64 px head height", 10))
    write("13-b-owl-expressions.svg", svg(30 + 6 * 200, 390, "\n".join(body)))


def sheet_owl_turnaround() -> None:
    views = [("front", owl_front()), ("three-quarter", owl_threequarter()), ("side", owl_side()), ("back", owl_back())]
    body = [text(30, 34, "13-c / Owl turnaround. Head units shared across views. Tufts excluded from H.", 16, weight="bold")]
    h = 2 * HEAD_R
    top = HEAD_C[1] - HEAD_R
    for i, (label, fig) in enumerate(views):
        x = 30 + i * (W + 20)
        body.append(f'<g transform="translate({x},60)">')
        body.append(grid_lines(h, top, (GROUND - top) / h))
        body.append(f'<line x1="0" y1="{GROUND}" x2="{W}" y2="{GROUND}" stroke="{INK}" stroke-width="1"/>')
        body.append(fig)
        body.append("</g>")
        body.append(text(x + W / 2, 60 + HGT + 22, label, 13, anchor="middle", weight="bold"))
    x = 30 + 4 * (W + 20)
    body.append(f'<g transform="translate({x},60)">')
    body.append(f'<line x1="0" y1="{GROUND}" x2="{W}" y2="{GROUND}" stroke="{INK}" stroke-width="1"/>')
    body.append(f'<g transform="translate(0,0)">{loupe()}</g>')
    body.append(chair(170, GROUND))
    body.append("</g>")
    body.append(text(x + W / 2, 60 + HGT + 22, "scale: loupe and chair", 12, anchor="middle", weight="bold"))
    notes = [
        f"Head: circle, radius {HEAD_R:g}, centre 46 above the neck pivot. Figure is {(GROUND - top) / h:.1f} H tall. Tufts add 14.",
        "Facial disc: two ovals 54 x 62 in the face color, 19 either side of centre. Eyes: circles radius 12 on the disc, 19 either side.",
        "Beak: one fixed wedge 14 wide, 16 tall, below the eye line. It does not open.",
        "Body: one egg 154 wide, 150 tall. Belly oval 104 x 120 in the face color. Apron trapezoid 68 to 92 wide. Scarf: one band plus one tail.",
        "Wings: the shared teardrop at 0.85 scale, shoulders 52 either side of centre. Legs and feet shared with cycle 1.",
        "Materials: painted wood, matte. Scarf and apron are folded paper. Beak and feet are slate-painted wood. Eyes ink with one highlight.",
    ]
    for j, n in enumerate(notes):
        body.append(text(30, 60 + HGT + 50 + j * 16, n, 11))
    write("13-c-owl-turnaround.svg", svg(30 + 5 * (W + 20), 60 + HGT + 160, "\n".join(body)))


def sheet_owl_poses() -> None:
    names = ["listening", "uncertainty", "overcommitment", "reconsideration", "satisfaction"]
    body = [text(30, 34, "13-d / Owl poses. Same pose table as cycle 1.", 16, weight="bold")]
    for i, n in enumerate(names):
        x = 30 + i * (W + 20)
        body.append(f'<g transform="translate({x},60)"><rect width="{W}" height="{HGT}" fill="none" stroke="{CREAM_DARK}"/>')
        body.append(f'<line x1="0" y1="{GROUND}" x2="{W}" y2="{GROUND}" stroke="{CREAM_DARK}" stroke-width="1"/>')
        body.append(owl_threequarter(OWL, EXPRESSIONS[n], POSES[n]))
        if n == "reconsideration":
            body.append(f'<g transform="translate(240,226) rotate(-8)"><rect x="-22" y="-14" width="44" height="30" fill="{PAPER}" stroke="{INK}" stroke-width="2"/><line x1="-14" y1="-4" x2="14" y2="-4" stroke="{INK}" stroke-width="1.2"/><line x1="-14" y1="4" x2="14" y2="4" stroke="{INK}" stroke-width="1.2"/></g>')
        body.append("</g>")
        body.append(text(x + W / 2, 60 + HGT + 22, n, 13, anchor="middle", weight="bold"))
    write("13-d-owl-poses.svg", svg(30 + 5 * (W + 20), 60 + HGT + 50, "\n".join(body)))


def sheet_owl_cast(grayscale: bool) -> None:
    title = "13-e / Cast with the owl" + (" (grayscale, garments removed)" if grayscale else " (color, in the Commons)")
    body = [GRAY, text(30, 34, title, 16, weight="bold")]
    wrap = 'filter="url(#gray)"' if grayscale else ""
    body.append(f"<g {wrap}>")
    body.append(env_panel(30, 60, 3 * W + 40, HGT))
    body.append(f'<g transform="translate(30,60)">{owl_threequarter(garment=not grayscale)}</g>')
    body.append(f'<g transform="translate({30 + W + 20},60)">{keeper(garment=not grayscale)}</g>')
    body.append(f'<g transform="translate({30 + 2 * W + 40},60)">{loupe()}</g>')
    body.append("</g>")
    for i, label in enumerate(["organizer (owl), upright family", "source keeper, low/broad family", "loupe companion, instrument family"]):
        body.append(text(30 + i * (W + 20) + W / 2, 60 + HGT + 22, label, 12, anchor="middle", weight="bold"))
    write("13-f-owl-cast-grayscale.svg" if grayscale else "13-e-owl-cast-color.svg", svg(30 + 3 * W + 70, 60 + HGT + 50, "\n".join(body)))


def sheet_owl_collaboration() -> None:
    from palette import GREEN, WOOD, WOOD_DARK, CORAL_DARK
    from organizer import _wing
    from owl import _WingColors, SHOULDER_NEAR, WING_SCALE
    body = [text(30, 34, "13-g / Owl at the table with the visitor", 16, weight="bold")]
    body.append(f'<rect x="30" y="60" width="760" height="420" fill="{GREEN}"/>')
    body.append(f'<g transform="translate(150,150)">{owl_threequarter(OWL, EXPRESSIONS["satisfaction"], POSES["chair"])}</g>')
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
    body.append(f'<g transform="translate(150,150)"><g transform="translate({SHOULDER_NEAR[0]},{SHOULDER_NEAR[1]}) scale({WING_SCALE})">{_wing(_WingColors(OWL), 70, False, False)}</g></g>')
    write("13-g-owl-collaboration.svg", svg(820, 500, "\n".join(body)))


def sheet_owl_deformation() -> None:
    cells = [
        ("head tilt +20", Expr(head_tilt=20), Pose()), ("head tilt -20", Expr(head_tilt=-20), Pose()),
        ("wings 0 and 150", Expr(), Pose(wing_near=150, wing_far=0)), ("lean +14", Expr(), Pose(lean=14)),
    ]
    body = [text(30, 34, "13-h / Owl deformation limits. Circles mark the pivots.", 16, weight="bold")]
    for i, (label, e, p) in enumerate(cells):
        x = 30 + i * (W + 20)
        body.append(f'<g transform="translate({x},60)"><rect width="{W}" height="{HGT}" fill="none" stroke="{CREAM_DARK}"/>')
        body.append(owl_threequarter(OWL, e, p))
        for px, py in ((132, 160), (184, 192), (80, 192), (132, 296)):
            body.append(f'<circle cx="{px}" cy="{py}" r="4" fill="none" stroke="{LILAC_DARK}" stroke-width="1.5"/>')
        body.append("</g>")
        body.append(text(x + W / 2, 60 + HGT + 18, label, 12, anchor="middle", weight="bold"))
    write("13-h-owl-deformation.svg", svg(30 + 4 * (W + 20), 60 + HGT + 40, "\n".join(body)))


ALL = [sheet_owl_silhouettes, sheet_owl_expressions, sheet_owl_turnaround, sheet_owl_poses,
       lambda: sheet_owl_cast(False), lambda: sheet_owl_cast(True), sheet_owl_collaboration, sheet_owl_deformation]

if __name__ == "__main__":
    for fn in ALL:
        fn()
