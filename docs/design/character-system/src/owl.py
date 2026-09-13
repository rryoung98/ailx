"""Cycle 2 organizer: the owl, rebuilt from concept owl-2 under the shared rules.

Same box (260 x 340), same ground, same pivots, same Expr and Pose controls as the
first-cycle bird in organizer.py. What changed: a round head with a facial disc and ear
tufts, forward-facing eyes with one highlight, a small fixed beak, a cream belly, a
scarf and an apron. Rules kept: eye line at 50 %, lids carry expression, wings pivot at
the shoulder, lean pivots at the hips, flat fills, one shade tone, charcoal contour.

Deliberate exceptions, declared:
  - The beak does not open. Overcommitment uses brows, wide eyes and raised tufts.
  - Two garments: an apron and a scarf. The scarf is the single "detail".
  - Two plumage fills: ochre back and cream face and belly. A pattern, not shading.
"""

from __future__ import annotations

import itertools
import re
from dataclasses import dataclass

from organizer import (
    EXPRESSIONS, POSES, Expr, Pose, Style, _brow, _eye, _legs_feet, _rot, _wing,
)
from palette import INK, STROKE

_ids = itertools.count(5000)

# ---------------------------------------------------------------------------
# Constants. The Blender blockout reads these too.
# ---------------------------------------------------------------------------
NECK = (132.0, 160.0)
HEAD_C = (132.0, 114.0)
HEAD_R = 52.0                 # head is a circle; H = 104 without tufts
EYE_R = 12.0                  # forward-facing, large
EYE_DX = 19.0                 # either side of centre in the front view
SHOULDER_NEAR = (184.0, 192.0)
SHOULDER_FAR = (80.0, 192.0)
HIP = (132.0, 296.0)
GROUND = 320.0
WING_SCALE = 0.85
HEADS_TALL = (GROUND - (HEAD_C[1] - HEAD_R)) / (2 * HEAD_R)   # about 2.5 with tufts excluded


@dataclass
class OwlColors:
    name: str
    back: str          # ochre plumage: head cap, back, wings
    back_dark: str
    face: str          # cream facial disc and belly
    face_dark: str
    apron: str
    apron_dark: str
    scarf: str
    beak: str
    feet: str


OWL = OwlColors(
    name="owl  muted ochre, cream face, dusk-blue apron, coral scarf",
    back="#CBA65C", back_dark="#A9884A",
    face="#F1E6CF", face_dark="#D9CBAA",
    apron="#4A5C8A", apron_dark="#3B4A70",
    scarf="#D9694F", beak="#4B4F63", feet="#4B4F63",
)

OWL_STYLE = Style(shine=True, line=0.8)


BODY = "M132,150 C192,150 212,214 206,262 C202,300 62,300 58,262 C52,214 72,150 132,150 Z"


def _apply_line(svg_text: str, st: Style) -> str:
    if st.line == 1.0:
        return svg_text
    return re.sub(r'stroke-width="([0-9.]+)"', lambda m: f'stroke-width="{float(m.group(1)) * st.line:.2f}"', svg_text)


def _tufts(hx: float, hy: float, fill: str, stroke: str, up: float, view: str = "tq") -> str:
    lift = 10 * up
    if view == "side":
        return (f'<path d="M{hx-30},{hy-38} L{hx-24},{hy-66-lift} L{hx-6},{hy-46} Z" fill="{fill}" stroke="{stroke}" '
                f'stroke-width="{STROKE}" stroke-linejoin="round"/>')
    return (
        f'<path d="M{hx-40},{hy-30} L{hx-36},{hy-66-lift} L{hx-12},{hy-46} Z" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round"/>'
        f'<path d="M{hx+40},{hy-30} L{hx+36},{hy-66-lift} L{hx+12},{hy-46} Z" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round"/>'
    )


def _disc(hx: float, hy: float, c: OwlColors, near_shift: float = 0.0) -> str:
    """Heart-shaped facial disc: two overlapping ovals in the face color."""
    return (
        f'<ellipse cx="{hx-19+near_shift}" cy="{hy+4}" rx="27" ry="31" fill="{c.face}"/>'
        f'<ellipse cx="{hx+19+near_shift}" cy="{hy+4}" rx="27" ry="31" fill="{c.face}"/>'
    )


def head_threequarter(c: OwlColors, e: Expr, silhouette: bool = False, st: Style = OWL_STYLE) -> str:
    hx, hy = HEAD_C[0] - NECK[0], HEAD_C[1] - NECK[1]   # (0, -46)
    fill = INK if silhouette else c.back
    stroke = "none" if silhouette else INK
    ey = hy + 2  # 50 % of the head height, allowing for the tufts
    parts = [f'<g transform="{_rot(e.head_tilt, 0, 0)}">']
    parts.append(_tufts(hx, hy, fill, stroke, e.tuft_up))
    parts.append(f'<circle cx="{hx}" cy="{hy}" r="{HEAD_R}" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}"/>')
    if not silhouette:
        parts.append(_disc(hx, hy, c, near_shift=6))
        parts.append(_eye(hx - EYE_DX + 4, ey, EYE_R - 1, EYE_R, e, c.face, st))
        parts.append(_eye(hx + EYE_DX + 6, ey, EYE_R, EYE_R, e, c.face, st))
        parts.append(_brow(hx - EYE_DX + 4, ey - 19 - e.brow_lift, e.brow_far, 16))
        parts.append(_brow(hx + EYE_DX + 6, ey - 19 - e.brow_lift, e.brow_near, 18))
    bx = hx + 6
    parts.append(f'<polygon points="{bx-6},{ey+10} {bx+8},{ey+10} {bx+2},{ey+26}" fill="{INK if silhouette else c.beak}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round" transform="{_rot(e.beak_tilt, bx, ey+10)}"/>')
    parts.append("</g>")
    return "\n".join(parts)


def head_front(c: OwlColors, e: Expr, silhouette: bool = False, st: Style = OWL_STYLE) -> str:
    hx, hy = 0.0, -46.0
    fill = INK if silhouette else c.back
    stroke = "none" if silhouette else INK
    ey = hy + 2
    parts = [_tufts(hx, hy, fill, stroke, e.tuft_up)]
    parts.append(f'<circle cx="{hx}" cy="{hy}" r="{HEAD_R}" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}"/>')
    if not silhouette:
        parts.append(_disc(hx, hy, c))
        parts.append(_eye(hx - EYE_DX, ey, EYE_R, EYE_R, e, c.face, st))
        parts.append(_eye(hx + EYE_DX, ey, EYE_R, EYE_R, e, c.face, st))
        parts.append(_brow(hx - EYE_DX, ey - 19 - e.brow_lift, -e.brow_near, 18))
        parts.append(_brow(hx + EYE_DX, ey - 19 - e.brow_lift, e.brow_near, 18))
    parts.append(f'<polygon points="{hx-7},{ey+10} {hx+7},{ey+10} {hx},{ey+26}" fill="{INK if silhouette else c.beak}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round"/>')
    return "\n".join(parts)


def head_side(c: OwlColors, e: Expr, silhouette: bool = False, st: Style = OWL_STYLE) -> str:
    hx, hy = 0.0, -46.0
    fill = INK if silhouette else c.back
    stroke = "none" if silhouette else INK
    ey = hy + 2
    parts = [_tufts(hx, hy, fill, stroke, e.tuft_up, view="side")]
    parts.append(f'<circle cx="{hx}" cy="{hy}" r="{HEAD_R}" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}"/>')
    if not silhouette:
        cid = f"sd{next(_ids)}"
        parts.append(f'<clipPath id="{cid}"><circle cx="{hx}" cy="{hy}" r="{HEAD_R}"/></clipPath>')
        parts.append(f'<ellipse cx="{hx+30}" cy="{hy+6}" rx="30" ry="34" fill="{c.face}" clip-path="url(#{cid})"/>')
        parts.append(_eye(hx + 26, ey, EYE_R - 2, EYE_R, e, c.face, st))
        parts.append(_brow(hx + 26, ey - 19 - e.brow_lift, e.brow_near, 16))
    parts.append(f'<polygon points="{hx+44},{ey+6} {hx+60},{ey+14} {hx+46},{ey+24}" fill="{INK if silhouette else c.beak}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round"/>')
    return "\n".join(parts)


def head_back(c: OwlColors, silhouette: bool = False) -> str:
    hx, hy = 0.0, -46.0
    fill = INK if silhouette else c.back
    stroke = "none" if silhouette else INK
    return _tufts(hx, hy, fill, stroke, 0.0) + f'<circle cx="{hx}" cy="{hy}" r="{HEAD_R}" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}"/>'


def _scarf(c: OwlColors, silhouette: bool, view: str = "tq") -> str:
    if silhouette:
        return ""
    if view == "back":
        return f'<ellipse cx="132" cy="156" rx="46" ry="13" fill="{c.scarf}" stroke="{INK}" stroke-width="{STROKE}"/>'
    tail = "" if view == "side" else f'<path d="M150,164 L166,166 L162,200 L148,196 Z" fill="{c.scarf}" stroke="{INK}" stroke-width="{STROKE}" stroke-linejoin="round"/>'
    return tail + f'<ellipse cx="132" cy="156" rx="46" ry="13" fill="{c.scarf}" stroke="{INK}" stroke-width="{STROKE}"/>'


def _body(c: OwlColors, silhouette: bool, garment: bool = True, view: str = "tq") -> str:
    fill = INK if silhouette else c.back
    stroke = "none" if silhouette else INK
    out = [f'<path d="{BODY}" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}"/>']
    if not silhouette and view != "back":
        bx = 132 if view != "side" else 150
        out.append(f'<ellipse cx="{bx}" cy="236" rx="{52 if view != "side" else 40}" ry="60" fill="{c.face}"/>')
        out.append(f'<path d="M{bx-44},270 C{bx-20},296 {bx+20},296 {bx+44},270 C{bx+40},292 {bx-40},292 {bx-44},270 Z" fill="{c.face_dark}"/>')
    if view == "side":
        out.append(f'<polygon points="70,258 46,282 74,278" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round"/>')
    if view == "back":
        out.append(f'<polygon points="118,292 146,292 132,306" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round"/>')
    if garment and not silhouette and view != "back":
        if view == "side":
            out.append(f'<path d="M126,206 L172,206 L184,290 L118,290 Z" fill="{c.apron}" stroke="{INK}" stroke-width="{STROKE}" stroke-linejoin="round"/>')
        else:
            out.append(f'<path d="M98,206 L166,206 L178,290 L86,290 Z" fill="{c.apron}" stroke="{INK}" stroke-width="{STROKE}" stroke-linejoin="round"/>')
            out.append(f'<rect x="120" y="240" width="26" height="18" fill="{c.apron}" stroke="{c.apron_dark}" stroke-width="{STROKE*0.8}"/>')
    return "\n".join(out)


def owl_threequarter(c: OwlColors = OWL, e: Expr = EXPRESSIONS["neutral"], p: Pose = POSES["neutral"],
                     silhouette: bool = False, garment: bool = True, ids: bool = False,
                     st: Style = OWL_STYLE) -> str:
    def wrap(name: str, inner: str) -> str:
        return f'<g class="rig-{name}">{inner}</g>' if ids else inner

    g = (lambda name: f' id="{name}"') if ids else (lambda name: "")
    wc = _WingColors(c)
    out = [f'<g{g("organizer")}>']
    out.append(_legs_feet(wc, p.stance, silhouette))
    out.append(f'<g{g("upper")} transform="{_rot(-p.lean, HIP[0], HIP[1])}">')
    out.append(wrap("upper", "\n".join([
        f'<g{g("far-wing")} transform="translate({SHOULDER_FAR[0]},{SHOULDER_FAR[1]}) scale({WING_SCALE})">{wrap("far-wing", _wing(wc, p.wing_far, True, silhouette))}</g>',
        f'<g{g("body")}>{wrap("body", _body(c, silhouette, garment))}</g>',
        _scarf(c, silhouette),
        f'<g{g("head")} transform="translate({NECK[0]+p.head_dx},{NECK[1]+p.head_dy})">{wrap("head", head_threequarter(c, e, silhouette, st) + (_blink(c) if ids else ""))}</g>',
        f'<g{g("near-wing")} transform="translate({SHOULDER_NEAR[0]},{SHOULDER_NEAR[1]}) scale({WING_SCALE})">{wrap("near-wing", _wing(wc, p.wing_near, False, silhouette))}</g>',
    ])))
    out.append("</g></g>")
    return _apply_line("\n".join(out), st)


def _blink(c: OwlColors) -> str:
    hy = HEAD_C[1] - NECK[1] + 2
    return (
        f'<g class="rig-blink">'
        f'<ellipse cx="{-EYE_DX + 4}" cy="{hy}" rx="{EYE_R}" ry="{EYE_R + 1}" fill="{c.face}"/>'
        f'<ellipse cx="{EYE_DX + 6}" cy="{hy}" rx="{EYE_R + 1}" ry="{EYE_R + 1}" fill="{c.face}"/>'
        f'</g>'
    )


class _WingColors:
    """Adapter so the shared wing and foot helpers read the owl's colors."""

    def __init__(self, c: OwlColors):
        self.plumage = c.back
        self.plumage_dark = c.back_dark
        self.beak = c.feet
        self.beak_dark = c.feet


def owl_front(c: OwlColors = OWL, e: Expr = EXPRESSIONS["neutral"], silhouette: bool = False, st: Style = OWL_STYLE) -> str:
    wc = _WingColors(c)
    out = [f'<g transform="translate({SHOULDER_FAR[0]-4},{SHOULDER_FAR[1]}) scale({WING_SCALE})">{_wing(wc, 4, True, silhouette)}</g>']
    out.append(f'<g transform="translate({SHOULDER_NEAR[0]+4},{SHOULDER_NEAR[1]}) scale({WING_SCALE})">{_wing(wc, 4, False, silhouette)}</g>')
    out.append(_legs_feet(wc, 0, silhouette, "front"))
    out.append(_body(c, silhouette, True, "front"))
    out.append(_scarf(c, silhouette, "front"))
    out.append(f'<g transform="translate({NECK[0]},{NECK[1]})">{head_front(c, e, silhouette, st)}</g>')
    return _apply_line("\n".join(out), st)


def owl_side(c: OwlColors = OWL, e: Expr = EXPRESSIONS["neutral"], silhouette: bool = False, st: Style = OWL_STYLE) -> str:
    wc = _WingColors(c)
    out = [_legs_feet(wc, 0, silhouette, "side")]
    out.append(_body(c, silhouette, True, "side"))
    out.append(_scarf(c, silhouette, "side"))
    out.append(f'<g transform="translate({NECK[0]+6},{NECK[1]})">{head_side(c, e, silhouette, st)}</g>')
    out.append(f'<g transform="translate({NECK[0]+14},{SHOULDER_NEAR[1]}) scale({WING_SCALE})">{_wing(wc, 6, False, silhouette)}</g>')
    return _apply_line("\n".join(out), st)


def owl_back(c: OwlColors = OWL, silhouette: bool = False, st: Style = OWL_STYLE) -> str:
    wc = _WingColors(c)
    out = [_legs_feet(wc, 0, silhouette, "back")]
    out.append(_body(c, silhouette, True, "back"))
    out.append(_scarf(c, silhouette, "back"))
    out.append(f'<g transform="translate({SHOULDER_FAR[0]-4},{SHOULDER_FAR[1]}) scale({WING_SCALE})">{_wing(wc, 4, True, silhouette)}</g>')
    out.append(f'<g transform="translate({SHOULDER_NEAR[0]+4},{SHOULDER_NEAR[1]}) scale({WING_SCALE})">{_wing(wc, 4, False, silhouette)}</g>')
    out.append(f'<g transform="translate({NECK[0]},{NECK[1]})">{head_back(c, silhouette)}</g>')
    return _apply_line("\n".join(out), st)
