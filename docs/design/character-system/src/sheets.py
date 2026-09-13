#!/usr/bin/env python3
"""Entry point. Generates every sheet of the Foray Commons character system.

Run from the repo root, then render with render.sh:

    python3 docs/design/character-system/src/sheets.py
    sh docs/design/character-system/src/render.sh
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from build import (  # noqa: E402
    HGT, W, GROUND, CREAM, CREAM_DARK, GREEN, INK, LILAC, LILAC_DARK, PAPER, STROKE, WOOD, WOOD_DARK,
    CORAL_DARK, grid_lines, sheet_silhouette_lineup, sheet_silhouette_sizes, sheet_silhouettes,
    sil_loupe, sil_s1_human, sil_s2_crested_bird, sil_s3_mole, sil_s4_compact_bird, sil_s5_chair,
    svg, text, write,
)
from organizer import (  # noqa: E402
    Style, HEAD_SCALE, SELECTED, COLORWAYS, EXPRESSIONS, POSES, _wing, head_threequarter, organizer_back, organizer_front,
    organizer_side, organizer_threequarter,
)

# ---------------------------------------------------------------------------
# Pass 3, sheet D: the selected direction, revised after critique.
# S4's wings hugged the body, so it had no acting range in silhouette.
# The revision pivots both wings at the shoulder so they break the outline.
# ---------------------------------------------------------------------------


def _s4_revised(pose: str = "neutral") -> str:
    return organizer_threequarter(COLORWAYS["A"], EXPRESSIONS["neutral"], POSES[pose], silhouette=True)


def sheet_s4_revised() -> None:
    sizes = [24, 40, 64, 120, 200]
    rows = [
        ("S4", "as explored", sil_s4_compact_bird),
        ("S4r", "revised: wings pivot at the shoulder", _s4_revised),
        ("S4r", "revised, uncertainty pose", lambda: _s4_revised("uncertainty")),
        ("S4r", "revised, overcommitment pose", lambda: _s4_revised("overcommitment")),
    ]
    row_h = 230
    width = 120 + sum(s * (W / HGT) + 30 for s in sizes) + 160
    body = [text(20, 30, "Pass 3 / S4 before and after the wing revision, at interface heights", 16, weight="bold")]
    for r, (key, label, fn) in enumerate(rows):
        y0 = 60 + r * row_h
        body.append(text(20, y0 + 110, key, 14, weight="bold"))
        body.append(text(20, y0 + 126, label, 9))
        x = 120
        for s in sizes:
            k = s / HGT
            body.append(f'<g transform="translate({x},{y0 + 210 - s}) scale({k})">{fn()}</g>')
            x += s * (W / HGT) + 30 + (60 if s >= 120 else 0)
    write("03-silhouettes-d-s4-revised.svg", svg(int(width), 60 + len(rows) * row_h, "\n".join(body)))


def sheet_lineup_revised() -> None:
    s = 32
    k = s / HGT
    items = [("S1", sil_s1_human), ("S2", sil_s2_crested_bird), ("S3", sil_s3_mole),
             ("S4r", _s4_revised), ("S5", sil_s5_chair), ("LP", sil_loupe)]
    body = [text(16, 24, "Pass 3 / Lineup at 32 px with the revised S4", 12, weight="bold")]
    x = 16
    for key, fn in items:
        body.append(f'<g transform="translate({x},{40}) scale({k})">{fn()}</g>')
        body.append(text(x + s * W / HGT / 2, 40 + s + 12, key, 9, anchor="middle"))
        x += s * (W / HGT) + 12
    write("03-silhouettes-e-lineup32-revised.svg", svg(int(max(x + 8, 300)), 40 + s + 24, "\n".join(body)))


# ---------------------------------------------------------------------------
# Pass 4: proportion and face studies.
# ---------------------------------------------------------------------------


def sheet_proportions() -> None:
    """Same parts, three head/body ratios. Head scale changes, body stays."""
    variants = [("2.0 heads", 1.25), ("2.4 heads (selected)", HEAD_SCALE), ("2.5 heads", 1.0), ("3.0 heads", 0.83)]
    body = [text(30, 34, "Pass 4 / Head-to-body ratio. Same body, same parts, three head sizes.", 16, weight="bold")]
    for i, (label, hs) in enumerate(variants):
        x = 30 + i * (W + 40)
        h = 92 * hs + 8
        top = 160 - 42 * hs - 46 * hs - 8
        heads = (GROUND - top) / h
        body.append(f'<g transform="translate({x},60)">')
        body.append(f'<rect width="{W}" height="{HGT}" fill="none" stroke="{CREAM_DARK}"/>')
        body.append(grid_lines(h, top, heads))
        body.append(organizer_threequarter(COLORWAYS[SELECTED], head_scale=hs))
        body.append("</g>")
        body.append(text(x + W / 2, 60 + HGT + 22, f"{label}  (head scale {hs})", 13, anchor="middle", weight="bold"))
        body.append(text(x + W / 2, 60 + HGT + 38, f"figure is {heads:.2f} H tall", 10, anchor="middle"))
    write("04-a-proportions.svg", svg(30 + 4 * (W + 40), 60 + HGT + 60, "\n".join(body)))


def sheet_eye_line() -> None:
    variants = [("38 % of head height", 0.38), ("50 % (selected)", 0.50), ("62 %", 0.62)]
    body = [text(30, 34, "Pass 4 / Eye line. Lower reads younger, higher reads older.", 16, weight="bold")]
    for i, (label, el) in enumerate(variants):
        x = 30 + i * 220
        body.append(f'<g transform="translate({x + 90},{190})">{head_threequarter(COLORWAYS[SELECTED], EXPRESSIONS["neutral"], eye_line=el)}</g>')
        ey = 190 - 42 - 46 + el * 92
        body.append(f'<line x1="{x}" y1="{ey}" x2="{x + 200}" y2="{ey}" stroke="{LILAC_DARK}" stroke-width="1" stroke-dasharray="3 3"/>')
        body.append(text(x + 100, 250, label, 12, anchor="middle", weight="bold"))
    write("04-b-eye-line.svg", svg(30 + 3 * 220, 280, "\n".join(body)))


EXPR_ORDER = ["neutral", "listening", "uncertainty", "overcommitment", "reconsideration", "satisfaction"]
BLIND_ORDER = ["reconsideration", "satisfaction", "listening", "overcommitment", "neutral", "uncertainty"]


def sheet_expressions(captioned: bool) -> None:
    order = EXPR_ORDER if captioned else BLIND_ORDER
    title = ("Pass 4 / Expressions with captions" if captioned
             else "Pass 4 / Expressions without captions, shuffled. Name each one before reading the key.")
    body = [text(30, 34, title, 16, weight="bold")]
    for i, name in enumerate(order):
        x = 30 + i * 200
        body.append(f'<g transform="translate({x + 90},{190})">{head_threequarter(COLORWAYS[SELECTED], EXPRESSIONS[name])}</g>')
        body.append(text(x + 90, 250, name if captioned else str(i + 1), 12, anchor="middle", weight="bold"))
    for i, name in enumerate(order):
        x = 30 + i * 200
        k = 64 / 100
        body.append(f'<g transform="translate({x + 60},{330}) scale({k})">{head_threequarter(COLORWAYS[SELECTED], EXPRESSIONS[name])}</g>')
    body.append(text(30, 360, "second row: 64 px head height", 10))
    name = "04-c-expressions-captioned.svg" if captioned else "04-d-expressions-blind.svg"
    write(name, svg(30 + 6 * 200, 380, "\n".join(body)))


def sheet_construction() -> None:
    """Head, wing and foot construction with guide lines and notes."""
    c = COLORWAYS[SELECTED]
    body = [text(30, 34, "Pass 4 / Construction. One head unit H = 100. Guides in lilac.", 16, weight="bold")]
    body.append(f'<g transform="translate(150,200)">{head_threequarter(c, EXPRESSIONS["neutral"])}</g>')
    for frac, label in [(0.0, "0  top of skull"), (0.5, "0.5  eye line"), (0.56, "0.56  beak base"), (1.0, "1.0  chin")]:
        y = 200 - 42 - 46 + frac * 92
        body.append(f'<line x1="60" y1="{y}" x2="260" y2="{y}" stroke="{LILAC_DARK}" stroke-width="1" stroke-dasharray="3 3"/>')
        body.append(text(264, y + 3, label, 10, fill=LILAC_DARK))
    body.append(text(60, 300, "Head: ellipse 100 x 92. Tuft adds 8. Eyes: solid ovals, near 14 x 18, far 10 x 18.", 11))
    body.append(text(60, 316, "Near eye sits 16 right of centre, far eye 24 left. Brows: 18-long strokes, 18 above the eye line.", 11))
    body.append(text(60, 332, "Beak base is 36 right of centre. Upper wedge 62 long, fixed. Lower wedge 58 long, opens up to 24 degrees.", 11))
    body.append('<g transform="translate(560,120)">')
    body.append(f'<circle cx="0" cy="0" r="4" fill="{LILAC_DARK}"/>')
    body.append(text(8, -6, "shoulder pivot", 10, fill=LILAC_DARK))
    body.append(_wing(c, 0, False, False))
    body.append(f'<g transform="translate(70,0)" opacity="0.5">{_wing(c, 60, False, False)}</g>')
    body.append(f'<g transform="translate(140,0)" opacity="0.5">{_wing(c, 150, False, False)}</g>')
    body.append("</g>")
    body.append(text(560, 230, "Wing: one teardrop 36 x 80, pivots at the shoulder. Two short primaries.", 11))
    body.append(text(560, 246, "No thumb. Grip is the tip curling around an object. Range 0 to 150 degrees.", 11))
    body.append('<g transform="translate(560,300)">')
    body.append(f'<rect x="20" y="-30" width="8" height="22" fill="{c.beak}" stroke="{INK}" stroke-width="{STROKE}"/>')
    body.append(f'<polygon points="-8,0 54,0 26,-14" fill="{c.beak}" stroke="{INK}" stroke-width="{STROKE}" stroke-linejoin="round"/>')
    body.append("</g>")
    body.append(text(640, 296, "Foot: one wedge 62 wide, 14 tall, no toes drawn. Leg 8 wide.", 11))
    body.append(text(640, 312, "Feet splay outward in front and three-quarter views.", 11))
    write("04-e-construction.svg", svg(1000, 360, "\n".join(body)))


# ---------------------------------------------------------------------------
# Pass 5: costume, material and color.
# ---------------------------------------------------------------------------


def env_panel(x: float, y: float, w: float, h: float) -> str:
    """Forest green wall with a wood table edge, the Commons background."""
    return (
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{GREEN}"/>'
        f'<rect x="{x}" y="{y + h - 70}" width="{w}" height="70" fill="{WOOD}"/>'
        f'<rect x="{x}" y="{y + h - 70}" width="{w}" height="6" fill="{WOOD_DARK}"/>'
    )


GRAY = '<filter id="gray"><feColorMatrix type="saturate" values="0"/></filter>'


def sheet_colorways(grayscale: bool) -> None:
    title = "Pass 5 / Three colorways on paper and against the Commons wall"
    if grayscale:
        title += " (grayscale)"
    body = [GRAY, text(30, 34, title, 16, weight="bold")]
    wrap = 'filter="url(#gray)"' if grayscale else ""
    body.append(f"<g {wrap}>")
    for i, key in enumerate(["A", "B", "C"]):
        c = COLORWAYS[key]
        x = 30 + i * 580
        body.append(f'<g transform="translate({x},60)">{organizer_threequarter(c)}</g>')
        body.append(env_panel(x + 280, 60, W, HGT))
        body.append(f'<g transform="translate({x + 280},60)">{organizer_threequarter(c)}</g>')
        body.append(text(x, 60 + HGT + 22, c.name, 13, weight="bold"))
    body.append("</g>")
    name = "05-b-colorways-grayscale.svg" if grayscale else "05-a-colorways.svg"
    write(name, svg(30 + 3 * 580, 60 + HGT + 50, "\n".join(body)))


def sheet_no_garment() -> None:
    c = COLORWAYS["A"]
    body = [GRAY, text(30, 34, "Pass 5 / Remove the vest. Does the character survive?", 16, weight="bold")]
    cells = [("with vest, color", False, False), ("no vest, color", False, True),
             ("no vest, grayscale", True, True), ("no vest, grayscale, uncertainty", True, True)]
    for i, (label, gray, bare) in enumerate(cells):
        x = 30 + i * 290
        pose = POSES["uncertainty"] if "uncertainty" in label else POSES["neutral"]
        expr = EXPRESSIONS["uncertainty"] if "uncertainty" in label else EXPRESSIONS["neutral"]
        wrap = 'filter="url(#gray)"' if gray else ""
        body.append(f'<g {wrap}>{env_panel(x, 60, W, HGT)}<g transform="translate({x},60)">{organizer_threequarter(c, expr, pose, garment=not bare)}</g></g>')
        body.append(text(x + W / 2, 60 + HGT + 22, label, 12, anchor="middle", weight="bold"))
    write("05-c-no-garment.svg", svg(30 + 4 * 290, 60 + HGT + 50, "\n".join(body)))


# ---------------------------------------------------------------------------
# Pass 6: turnaround.
# ---------------------------------------------------------------------------


def chair(x: float, ground: float) -> str:
    return (
        f'<rect x="{x}" y="{ground - 110}" width="60" height="8" fill="{WOOD}" stroke="{INK}" stroke-width="2"/>'
        f'<rect x="{x + 4}" y="{ground - 102}" width="6" height="102" fill="{WOOD}" stroke="{INK}" stroke-width="2"/>'
        f'<rect x="{x + 50}" y="{ground - 102}" width="6" height="102" fill="{WOOD}" stroke="{INK}" stroke-width="2"/>'
        f'<rect x="{x}" y="{ground - 190}" width="10" height="80" fill="{WOOD}" stroke="{INK}" stroke-width="2"/>'
    )


def sheet_turnaround() -> None:
    c = COLORWAYS[SELECTED]
    views = [("front", organizer_front(c)), ("three-quarter", organizer_threequarter(c)),
             ("side", organizer_side(c)), ("back", organizer_back(c))]
    body = [text(30, 34, "Pass 6 / Turnaround. Selected colorway B2. Ground line and head units shared across views.", 16, weight="bold")]
    h = 92 * HEAD_SCALE + 8
    top = 160 - 88 * HEAD_SCALE - 8
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
    body.append(f'<g transform="translate(0,{GROUND - 200}) scale({200 / HGT})">{sil_loupe()}</g>')
    body.append(chair(160, GROUND))
    body.append("</g>")
    body.append(text(x + W / 2, 60 + HGT + 22, "scale: loupe 1.5 H, chair seat at 1.1 H", 12, anchor="middle", weight="bold"))
    notes = [
        "Materials: plumage is matte painted wood. Vest is folded paper with one crease at the pocket.",
        "Beak and feet are slate-painted wood, matte. Eyes are ink, no highlight. Contour is charcoal, 3.2 units at this scale.",
        "Construction: head ellipse 100 x 92 in head units, scaled 1.15 about the neck pivot 42 below its centre. Body is one egg 144 wide, 142 tall.",
        "Wings pivot at the shoulder, 44 either side of centre, 32 below the neck. Legs 8 wide, 22 tall. Feet 62 wide wedges.",
    ]
    for j, n in enumerate(notes):
        body.append(text(30, 60 + HGT + 50 + j * 16, n, 11))
    write("06-turnaround.svg", svg(30 + 5 * (W + 20), 60 + HGT + 130, "\n".join(body)))


# ---------------------------------------------------------------------------
# Pass 7: expression and pose sheets, plus the collaborative panel.
# ---------------------------------------------------------------------------


def sheet_poses() -> None:
    c = COLORWAYS[SELECTED]
    names = ["listening", "uncertainty", "overcommitment", "reconsideration", "satisfaction"]
    body = [text(30, 34, "Pass 7 / Five poses. Expression and body carry the same state.", 16, weight="bold")]
    for i, n in enumerate(names):
        x = 30 + i * (W + 20)
        body.append(f'<g transform="translate({x},60)"><rect width="{W}" height="{HGT}" fill="none" stroke="{CREAM_DARK}"/>')
        body.append(f'<line x1="0" y1="{GROUND}" x2="{W}" y2="{GROUND}" stroke="{CREAM_DARK}" stroke-width="1"/>')
        body.append(organizer_threequarter(c, EXPRESSIONS[n], POSES[n]))
        if n == "reconsideration":
            body.append(f'<g transform="translate(236,226) rotate(-8)"><rect x="-22" y="-14" width="44" height="30" fill="{PAPER}" stroke="{INK}" stroke-width="2"/><line x1="-14" y1="-4" x2="14" y2="-4" stroke="{INK}" stroke-width="1.2"/><line x1="-14" y1="4" x2="14" y2="4" stroke="{INK}" stroke-width="1.2"/></g>')
        body.append("</g>")
        body.append(text(x + W / 2, 60 + HGT + 22, n, 13, anchor="middle", weight="bold"))
    write("07-a-poses.svg", svg(30 + 5 * (W + 20), 60 + HGT + 50, "\n".join(body)))


def visitor_placeholder(x: float, y: float) -> str:
    """A neutral stand-in for the visitor's own character. Same system, no face detail."""
    return (
        f'<g transform="translate({x},{y})">'
        f'<ellipse cx="0" cy="-150" rx="40" ry="44" fill="{CREAM}" stroke="{INK}" stroke-width="{STROKE}"/>'
        f'<path d="M0,-108 C40,-108 52,-60 48,-20 L-48,-20 C-52,-60 -40,-108 0,-108 Z" fill="{CREAM_DARK}" stroke="{INK}" stroke-width="{STROKE}"/>'
        f'<ellipse cx="-14" cy="-150" rx="6" ry="8" fill="{INK}"/><ellipse cx="14" cy="-150" rx="6" ry="8" fill="{INK}"/>'
        f'<path d="M-40,-90 C-70,-80 -92,-60 -96,-48" stroke="{INK}" stroke-width="{STROKE * 2.2}" stroke-linecap="round" fill="none"/>'
        f'<path d="M-40,-90 C-70,-80 -92,-60 -96,-48" stroke="{CREAM}" stroke-width="{STROKE * 1.2}" stroke-linecap="round" fill="none"/>'
        f"</g>"
    )


def sheet_collaboration() -> None:
    """One panel: the organizer and the visitor at the table, crossing out chairs."""
    c = COLORWAYS[SELECTED]
    body = [text(30, 34, "Pass 7 / Collaborative interaction. The visitor points at the plan. The organizer crosses out chairs.", 16, weight="bold")]
    body.append(f'<rect x="30" y="60" width="760" height="420" fill="{GREEN}"/>')
    body.append(f'<g transform="translate(150,150)">{organizer_threequarter(c, EXPRESSIONS["satisfaction"], POSES["chair"])}</g>')
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
    # the organizer's wing tip rests on the plan, drawn over the table
    body.append(f'<g transform="translate(150,150)"><g transform="translate(176,192)">{_wing(c, 70, False, False)}</g></g>')
    body.append(f'<line x1="530" y1="386" x2="500" y2="404" stroke="{INK}" stroke-width="{STROKE * 2.2}" stroke-linecap="round"/>')
    body.append(f'<line x1="530" y1="386" x2="500" y2="404" stroke="{CREAM}" stroke-width="{STROKE * 1.2}" stroke-linecap="round"/>')
    body.append(text(40, 500, "Both sit at the table. The organizer's wing and the visitor's hand meet on the plan. Neither looks at the camera.", 11))
    body.append(text(40, 516, "Caption is for review only. The scene must read without it.", 11))
    write("07-b-collaboration.svg", svg(820, 530, "\n".join(body)))


def sheet_gesture() -> None:
    """Neutral stance and the characteristic gesture: nudging a chair a few centimetres."""
    c = COLORWAYS[SELECTED]
    body = [text(30, 34, "Pass 7 / Neutral stance, then the habit: nudge a chair, look at it, nudge it back.", 16, weight="bold")]
    frames = [("neutral", "neutral", 0), ("chair", "listening", 0), ("chair", "reconsideration", 6), ("chair", "satisfaction", -6)]
    for i, (pose, expr, chair_dx) in enumerate(frames):
        x = 30 + i * (W + 60)
        body.append(f'<g transform="translate({x},60)"><rect width="{W + 40}" height="{HGT}" fill="none" stroke="{CREAM_DARK}"/>')
        body.append(f'<line x1="0" y1="{GROUND}" x2="{W + 40}" y2="{GROUND}" stroke="{CREAM_DARK}" stroke-width="1"/>')
        if pose == "chair":
            body.append(chair(214 + chair_dx, GROUND))
        body.append(organizer_threequarter(c, EXPRESSIONS[expr], POSES[pose]))
        body.append("</g>")
        body.append(text(x + W / 2 + 20, 60 + HGT + 22, f"{i + 1}", 13, anchor="middle", weight="bold"))
    write("07-c-gesture.svg", svg(30 + 4 * (W + 60), 60 + HGT + 50, "\n".join(body)))



def sheet_value_fixes() -> None:
    """Pass 5, sheet D. Luminance of cobalt is close to the wall, so test fixes."""
    keys = ["A", "A2", "B", "B2"]
    body = [GRAY, text(30, 34, "Pass 5 / Value against the wall. Each colorway in color and grayscale, at 200 and 48 px.", 16, weight="bold")]
    for i, key in enumerate(keys):
        c = COLORWAYS[key]
        x = 30 + i * 420
        for j, gray in enumerate((False, True)):
            gx = x + j * 200
            wrap = 'filter="url(#gray)"' if gray else ""
            body.append(f'<g {wrap}>{env_panel(gx, 60, 190, 250)}')
            body.append(f'<g transform="translate({gx - 20},{60 + 250 - 240}) scale({240 / HGT})">{organizer_threequarter(c)}</g>')
            body.append(f'<g transform="translate({gx + 130},{60 + 250 - 60}) scale({48 / HGT})">{organizer_threequarter(c)}</g>')
            body.append("</g>")
        body.append(text(x, 60 + 250 + 22, c.name, 12, weight="bold"))
    write("05-d-value-fixes.svg", svg(30 + 4 * 420, 60 + 250 + 50, "\n".join(body)))


# ---------------------------------------------------------------------------
# Pass 8: two-dimensional deformation tests. Look for seams at the pivots.
# ---------------------------------------------------------------------------


def sheet_deformation() -> None:
    from organizer import Pose, Expr
    c = COLORWAYS[SELECTED]
    cells = [
        ("head tilt +20", Expr(head_tilt=20), Pose()),
        ("head tilt -20", Expr(head_tilt=-20), Pose()),
        ("head offset 10,8", Expr(), Pose(head_dx=10, head_dy=8)),
        ("wings 0 and 150", Expr(), Pose(wing_near=150, wing_far=0)),
        ("lean +14", Expr(), Pose(lean=14)),
        ("lean -14", Expr(), Pose(lean=-14)),
        ("stance +14", Expr(), Pose(stance=14)),
        ("beak open, tuft up", Expr(beak_open=1, tuft_up=1), Pose()),
    ]
    body = [text(30, 34, "Pass 8 / Deformation. Each cell pushes one control to its limit. Circles mark the pivots.", 16, weight="bold")]
    for i, (label, e, p) in enumerate(cells):
        x = 30 + (i % 4) * (W + 20)
        y = 60 + (i // 4) * (HGT + 50)
        body.append(f'<g transform="translate({x},{y})"><rect width="{W}" height="{HGT}" fill="none" stroke="{CREAM_DARK}"/>')
        body.append(organizer_threequarter(c, e, p))
        for px, py in ((132, 160), (176, 192), (88, 192), (132, 320)):
            body.append(f'<circle cx="{px}" cy="{py}" r="4" fill="none" stroke="{LILAC_DARK}" stroke-width="1.5"/>')
        body.append("</g>")
        body.append(text(x + W / 2, y + HGT + 18, label, 12, anchor="middle", weight="bold"))
    write("08-deformation.svg", svg(30 + 4 * (W + 20), 60 + 2 * (HGT + 50), "\n".join(body)))


# ---------------------------------------------------------------------------
# Pass 10 / deliverable: the system tested on two contrasting supporting concepts.
# ---------------------------------------------------------------------------


def sheet_cast(grayscale: bool) -> None:
    from supporting import keeper, loupe
    from organizer import Expr
    c = COLORWAYS[SELECTED]
    title = "Cast test / organizer, source keeper, loupe companion"
    title += " (grayscale, garments removed)" if grayscale else " (color, in the Commons)"
    body = [GRAY, text(30, 34, title, 16, weight="bold")]
    wrap = 'filter="url(#gray)"' if grayscale else ""
    body.append(f"<g {wrap}>")
    body.append(env_panel(30, 60, 3 * W + 40, HGT))
    body.append(f'<g transform="translate(30,60)">{organizer_threequarter(c, garment=not grayscale)}</g>')
    body.append(f'<g transform="translate({30 + W + 20},60)">{keeper(garment=not grayscale)}</g>')
    body.append(f'<g transform="translate({30 + 2 * W + 40},60)">{loupe()}</g>')
    body.append("</g>")
    body.append(text(30 + W / 2, 60 + HGT + 22, "organizer, 2.4 H, upright family", 12, anchor="middle", weight="bold"))
    body.append(text(30 + W + 20 + W / 2, 60 + HGT + 22, "source keeper, 2.0 H, low/broad family", 12, anchor="middle", weight="bold"))
    body.append(text(30 + 2 * W + 40 + W / 2, 60 + HGT + 22, "loupe companion, 1.5 H, instrument family", 12, anchor="middle", weight="bold"))
    name = "10-b-cast-grayscale-bare.svg" if grayscale else "10-a-cast-color.svg"
    write(name, svg(30 + 3 * W + 70, 60 + HGT + 50, "\n".join(body)))


def sheet_cast_expressions() -> None:
    from supporting import keeper, loupe
    body = [text(30, 34, "Cast test / the shared expression logic on the other two. Listening, uncertainty, overcommitment, reconsideration.", 16, weight="bold")]
    names = ["listening", "uncertainty", "overcommitment", "reconsideration"]
    for i, n in enumerate(names):
        x = 30 + i * (W + 10)
        e = EXPRESSIONS[n]
        body.append(f'<g transform="translate({x},50) scale(0.8)">{keeper(e, hand_near=1.0 if n == "uncertainty" else 0.0)}</g>')
        body.append(f'<g transform="translate({x},300) scale(0.8)">{loupe(e, arm_near=1.0 if n == "uncertainty" else 0.0)}</g>')
        body.append(text(x + W * 0.4, 590, n, 12, anchor="middle", weight="bold"))
    write("10-d-cast-expressions.svg", svg(30 + 4 * (W + 10), 610, "\n".join(body)))


def sheet_family() -> None:
    from supporting import sil_wader, keeper, loupe
    body = [text(20, 30, "Cast test / related shapes stay distinguishable without color or accessories", 16, weight="bold")]
    rows = [("organizer", lambda: organizer_threequarter(COLORWAYS[SELECTED], silhouette=True)),
            ("upright wader (family sibling, 3 H)", sil_wader),
            ("source keeper", lambda: keeper(silhouette=True)),
            ("loupe", lambda: loupe(silhouette=True))]
    sizes = [24, 40, 64, 120]
    for r, (label, fn) in enumerate(rows):
        y0 = 50 + r * 150
        body.append(text(20, y0 + 80, label, 11, weight="bold"))
        x = 260
        for s in sizes:
            body.append(f'<g transform="translate({x},{y0 + 130 - s}) scale({s / HGT})">{fn()}</g>')
            x += s * (W / HGT) + 30
    write("10-c-family-silhouettes.svg", svg(640, 50 + 4 * 150, "\n".join(body)))



def sheet_friendly_variants() -> None:
    """Exploration after review: how far toward a rounder, friendlier read before it turns childish."""
    c = COLORWAYS[SELECTED]
    base = dict(eye_scale=1.0, head_scale=1.0, beak_scale=1.0, body_round=0.0)
    steps = [
        ("pass 5 design, 2.5 H", dict(base)),
        ("eyes 1.4x", dict(base, eye_scale=1.4)),
        ("+ head, 2.4 H", dict(base, eye_scale=1.4, head_scale=1.15)),
        ("+ shorter beak, rounder body (selected)", dict()),
        ("+ eye line 44 %", dict(eye_line=0.44)),
    ]
    body = [text(30, 34, "Revision / rounder and friendlier, one control at a time. Fourth column selected on 2026-09-12.", 16, weight="bold")]
    for i, (label, kw) in enumerate(steps):
        x = 30 + i * (W + 20)
        body.append(f'<g transform="translate({x},60)"><rect width="{W}" height="{HGT}" fill="none" stroke="{CREAM_DARK}"/>')
        body.append(organizer_threequarter(c, **kw))
        body.append("</g>")
        body.append(f'<g transform="translate({x + 40},{60 + HGT + 30}) scale(0.19)">{organizer_threequarter(c, **kw)}</g>')
        body.append(f'<g transform="translate({x + 120},{60 + HGT + 30}) scale(0.19)">{organizer_threequarter(c, EXPRESSIONS["uncertainty"], POSES["uncertainty"], **kw)}</g>')
        body.append(text(x + W / 2, 60 + HGT + 118, label, 12, anchor="middle", weight="bold"))
    body.append(text(30, 60 + HGT + 140, "small row: 64 px, neutral and uncertainty", 10))
    write("11-friendly-variants.svg", svg(30 + 5 * (W + 20), 60 + HGT + 150, "\n".join(body)))


def sheet_rendering_study() -> None:
    """Style study after review: a familiar, friendly finish in the manner of Animal Crossing and Frieren.

    Construction is identical in every column. Only rendering conventions change.
    """
    c = COLORWAYS[SELECTED]
    cols = [
        ("current: solid eyes, one line, one shade", c, Style()),
        ("+ eye highlight", c, Style(shine=True)),
        ("+ iris and thinner line", c, Style(shine=True, iris=True, line=0.8)),
        ("+ hard cel shade", c, Style(shine=True, iris=True, line=0.8, cel=True)),
        ("highlight, thinner line, muted palette", COLORWAYS["M"], Style(shine=True, line=0.8)),
    ]
    body = [GRAY, text(30, 34, "Rendering study / same construction, five finishes. Row 2 is on the wall. Row 3 is 64 px in grayscale.", 16, weight="bold")]
    for i, (label, cw, st) in enumerate(cols):
        x = 30 + i * (W + 20)
        body.append(f'<g transform="translate({x},60)">{organizer_threequarter(cw, EXPRESSIONS["listening"], POSES["listening"], st=st)}</g>')
        body.append(env_panel(x, 60 + HGT + 10, W, 260))
        body.append(f'<g transform="translate({x + 20},{60 + HGT + 10 + 260 - 240}) scale({240 / HGT})">{organizer_threequarter(cw, EXPRESSIONS["satisfaction"], POSES["satisfaction"], st=st)}</g>')
        body.append(f'<g filter="url(#gray)">{env_panel(x, 60 + HGT + 280, 120, 80)}<g transform="translate({x + 20},{60 + HGT + 280 + 80 - 66}) scale({64 / HGT})">{organizer_threequarter(cw, st=st)}</g></g>')
        body.append(f'<g transform="translate({x + 170},{60 + HGT + 350}) scale(0.5)">{head_threequarter(cw, EXPRESSIONS["uncertainty"], st=st)}</g>')
        body.append(text(x + W / 2, 60 + HGT + 398, label, 11, anchor="middle", weight="bold"))
    write("12-rendering-study.svg", svg(30 + 5 * (W + 20), 60 + HGT + 410, "\n".join(body)))

ALL = [
    sheet_silhouettes, sheet_silhouette_sizes, sheet_silhouette_lineup, sheet_s4_revised,
    sheet_lineup_revised, sheet_proportions, sheet_eye_line,
    lambda: sheet_expressions(True), lambda: sheet_expressions(False), sheet_construction,
    lambda: sheet_colorways(False), lambda: sheet_colorways(True), sheet_no_garment,
    sheet_turnaround, sheet_poses, sheet_collaboration, sheet_gesture, sheet_value_fixes,
    sheet_deformation, lambda: sheet_cast(False), lambda: sheet_cast(True), sheet_cast_expressions,
    sheet_family, sheet_friendly_variants, sheet_rendering_study,
]

if __name__ == "__main__":
    for fn in ALL:
        fn()
