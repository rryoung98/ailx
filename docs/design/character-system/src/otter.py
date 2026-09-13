"""Cycle 3 organizer: the sea otter, rebuilt from concept otter-2 under the shared rules.

Same box (260 x 340), ground, pivots, Expr and Pose controls as the bird and the owl.
What is new: a wide head with a cream face mask, small round ears, whisker dots and a
blush, mitten paws, short legs with flipper feet, and a thick tail that trails behind.
Rules kept: eye line at 50 %, lids carry expression, limbs pivot at the shoulder, lean
pivots at the hips, flat fills, one shade tone per hue, charcoal contour.

Deliberate exceptions, declared:
  - Two garments, apron and scarf. The scarf is the one detail.
  - Two fur fills, brown body and cream face and chest. A pattern, not shading.
  - The mouth opens. Overcommitment gets its mouth back.
  - A blush mark on each cheek. It is a flat fill and it is the finish reference's ask.
"""

from __future__ import annotations

import itertools
import re
from dataclasses import dataclass

from organizer import EXPRESSIONS, POSES, Expr, Pose, Style, _brow, _eye, _rot
from palette import INK, STROKE

_ids = itertools.count(9000)

NECK = (132.0, 162.0)
HEAD_C = (132.0, 114.0)
HEAD_RX, HEAD_RY = 56.0, 48.0        # H = 96 without ears
EYE_R = 11.0
EYE_DX = 19.0
SHOULDER_NEAR = (180.0, 190.0)
SHOULDER_FAR = (84.0, 190.0)
HIP = (132.0, 296.0)
GROUND = 320.0
HEADS_TALL = (GROUND - (HEAD_C[1] - HEAD_RY)) / (2 * HEAD_RY)


@dataclass
class OtterColors:
    name: str
    fur: str
    fur_dark: str
    face: str
    face_dark: str
    apron: str
    apron_dark: str
    scarf: str
    blush: str


OTTER = OtterColors(
    name="otter  warm brown, cream face and chest, sage apron, dusk-blue scarf",
    fur="#6E4B33", fur_dark="#54392A",
    face="#F1E6CF", face_dark="#D9CBAA",
    apron="#9BAE91", apron_dark="#7E9276",
    scarf="#4A5C8A", blush="#EFB6A4",
)
# A lighter fur for the wall-value test in the cast sheet.
OTTER_LIGHT = OtterColors("otter, lighter fur", "#8A6548", "#6B4D36", "#F1E6CF", "#D9CBAA", "#9BAE91", "#7E9276", "#4A5C8A", "#EFB6A4")

OTTER_STYLE = Style(shine=True, line=0.8)

BODY = "M132,150 C186,150 206,214 200,262 C196,300 68,300 64,262 C58,214 78,150 132,150 Z"


def _apply_line(svg_text: str, st: Style) -> str:
    if st.line == 1.0:
        return svg_text
    return re.sub(r'stroke-width="([0-9.]+)"', lambda m: f'stroke-width="{float(m.group(1)) * st.line:.2f}"', svg_text)


def _ears(hx, hy, c, silhouette, lift, view="tq"):
    fill = INK if silhouette else c.fur
    stroke = "none" if silhouette else INK
    dy = -6 * lift
    if view == "side":
        pts = [(hx - 8, hy - 40 + dy)]
    else:
        pts = [(hx - 46, hy - 34 + dy), (hx + 46, hy - 34 + dy)]
    out = []
    for x, y in pts:
        out.append(f'<circle cx="{x}" cy="{y}" r="11" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}"/>')
        if not silhouette:
            out.append(f'<circle cx="{x}" cy="{y + 1}" r="5" fill="{c.face_dark}"/>')
    return "\n".join(out)


def _face_marks(hx, hy, c, e: Expr, st: Style, near_shift=0.0, side=False):
    """Nose, mouth, whisker dots and blush. Local origin is the neck pivot."""
    ey = hy + 2
    nx, ny = hx + near_shift, ey + 16
    out = []
    # blush
    for sx in ((1,) if side else (-1, 1)):
        out.append(f'<ellipse cx="{nx + sx * 26}" cy="{ey + 18}" rx="9" ry="5" fill="{c.blush}"/>')
    # whisker dots
    for sx in ((1,) if side else (-1, 1)):
        for dx, dy in ((22, 10), (26, 16)):
            out.append(f'<circle cx="{nx + sx * dx}" cy="{ey + dy}" r="1.7" fill="{INK}"/>')
    # nose
    out.append(f'<path d="M{nx - 7},{ny - 4} L{nx + 7},{ny - 4} L{nx},{ny + 5} Z" fill="{INK}" stroke="{INK}" stroke-width="{STROKE * 0.6}" stroke-linejoin="round"/>')
    # mouth: a w-smile when closed, an oval when open
    if e.beak_open > 0.4:
        h = 6 + 8 * e.beak_open
        out.append(f'<ellipse cx="{nx}" cy="{ny + 8 + h / 2}" rx="{7 + 3 * e.beak_open}" ry="{h / 2}" fill="#D9694F" stroke="{INK}" stroke-width="{STROKE * 0.7}"/>')
    else:
        lift = -2 if e.lid_bottom > 0.3 else 0
        out.append(f'<path d="M{nx - 9},{ny + 6 + lift} q4.5,5 9,0 q4.5,5 9,0" fill="none" stroke="{INK}" stroke-width="{STROKE * 0.75}" stroke-linecap="round"/>')
    return "\n".join(out)


def head_threequarter(c: OtterColors, e: Expr, silhouette=False, st: Style = OTTER_STYLE):
    hx, hy = HEAD_C[0] - NECK[0], HEAD_C[1] - NECK[1]   # (0, -48)
    fill = INK if silhouette else c.fur
    stroke = "none" if silhouette else INK
    ey = hy + 2
    p = [f'<g transform="{_rot(e.head_tilt, 0, 0)}">']
    p.append(_ears(hx, hy, c, silhouette, e.tuft_up))
    p.append(f'<ellipse cx="{hx}" cy="{hy}" rx="{HEAD_RX}" ry="{HEAD_RY}" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}"/>')
    if not silhouette:
        p.append(f'<ellipse cx="{hx + 8}" cy="{hy + 10}" rx="42" ry="34" fill="{c.face}"/>')
        p.append(_eye(hx - EYE_DX + 4, ey, EYE_R - 1, EYE_R, e, c.face, st))
        p.append(_eye(hx + EYE_DX + 8, ey, EYE_R, EYE_R, e, c.face, st))
        p.append(_brow(hx - EYE_DX + 4, ey - 18 - e.brow_lift, e.brow_far, 14))
        p.append(_brow(hx + EYE_DX + 8, ey - 18 - e.brow_lift, e.brow_near, 16))
        p.append(_face_marks(hx, hy, c, e, st, near_shift=8))
    p.append("</g>")
    return "\n".join(p)


def head_front(c: OtterColors, e: Expr, silhouette=False, st: Style = OTTER_STYLE):
    hx, hy = 0.0, -48.0
    fill = INK if silhouette else c.fur
    stroke = "none" if silhouette else INK
    ey = hy + 2
    p = [_ears(hx, hy, c, silhouette, e.tuft_up)]
    p.append(f'<ellipse cx="{hx}" cy="{hy}" rx="{HEAD_RX}" ry="{HEAD_RY}" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}"/>')
    if not silhouette:
        p.append(f'<ellipse cx="{hx}" cy="{hy + 10}" rx="44" ry="34" fill="{c.face}"/>')
        p.append(_eye(hx - EYE_DX, ey, EYE_R, EYE_R, e, c.face, st))
        p.append(_eye(hx + EYE_DX, ey, EYE_R, EYE_R, e, c.face, st))
        p.append(_brow(hx - EYE_DX, ey - 18 - e.brow_lift, -e.brow_near, 16))
        p.append(_brow(hx + EYE_DX, ey - 18 - e.brow_lift, e.brow_near, 16))
        p.append(_face_marks(hx, hy, c, e, st))
    return "\n".join(p)


def head_side(c: OtterColors, e: Expr, silhouette=False, st: Style = OTTER_STYLE):
    hx, hy = 0.0, -48.0
    fill = INK if silhouette else c.fur
    stroke = "none" if silhouette else INK
    ey = hy + 2
    p = [_ears(hx, hy, c, silhouette, e.tuft_up, view="side")]
    p.append(f'<ellipse cx="{hx}" cy="{hy}" rx="{HEAD_RX - 4}" ry="{HEAD_RY}" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}"/>')
    if not silhouette:
        cid = f"om{next(_ids)}"
        p.append(f'<clipPath id="{cid}"><ellipse cx="{hx}" cy="{hy}" rx="{HEAD_RX - 4}" ry="{HEAD_RY}"/></clipPath>')
        p.append(f'<ellipse cx="{hx + 30}" cy="{hy + 12}" rx="36" ry="34" fill="{c.face}" clip-path="url(#{cid})"/>')
        p.append(_eye(hx + 22, ey, EYE_R - 2, EYE_R, e, c.face, st))
        p.append(_brow(hx + 22, ey - 18 - e.brow_lift, e.brow_near, 14))
        p.append(_face_marks(hx, hy, c, e, st, near_shift=40, side=True))
    return "\n".join(p)


def head_back(c: OtterColors, silhouette=False):
    hx, hy = 0.0, -48.0
    fill = INK if silhouette else c.fur
    stroke = "none" if silhouette else INK
    return _ears(hx, hy, c, silhouette, 0.0) + f'<ellipse cx="{hx}" cy="{hy}" rx="{HEAD_RX}" ry="{HEAD_RY}" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}"/>'


def _paw(c: OtterColors, angle: float, mirror: bool, silhouette: bool) -> str:
    """A capsule arm ending in a round mitt. Local origin is the shoulder. 0 hangs down."""
    fill = INK if silhouette else c.fur
    stroke = "none" if silhouette else INK
    sx = -1 if mirror else 1
    arm = (f'<path d="M-11,0 L-11,44 A11,11 0 0 0 11,44 L11,0 Z" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round"/>'
           f'<circle cx="0" cy="52" r="15" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}"/>')
    if not silhouette:
        arm += f'<path d="M-5,58 L-4,66 M3,59 L4,67" stroke="{INK}" stroke-width="{STROKE * 0.6}" stroke-linecap="round"/>'
    return f'<g transform="{_rot(-angle * sx, 0, 0)} scale({sx},1)">{arm}</g>'


def _legs_feet(c: OtterColors, stance: float, silhouette: bool, view: str = "tq") -> str:
    fill = INK if silhouette else c.fur
    stroke = "none" if silhouette else INK
    xs = [128, 146] if view == "side" else [112 - stance, 152 + stance]
    out = []
    for i, x in enumerate(xs):
        out.append(f'<rect x="{x - 8}" y="288" width="16" height="20" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}"/>')
        if view == "side":
            out.append(f'<ellipse cx="{x + 12}" cy="313" rx="24" ry="7" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}"/>')
        elif view == "back":
            out.append(f'<ellipse cx="{x}" cy="313" rx="20" ry="6" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}"/>')
        else:
            spread = -1 if i == 0 else 1
            out.append(f'<ellipse cx="{x + spread * 4}" cy="313" rx="22" ry="7" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}"/>')
    return "\n".join(out)


def _tail(c: OtterColors, silhouette: bool, view: str = "tq") -> str:
    fill = INK if silhouette else c.fur
    stroke = "none" if silhouette else INK
    if view == "front":
        d = "M178,268 C206,274 224,292 232,314 C214,316 190,306 178,290 Z"
    elif view == "side":
        d = "M76,262 C40,268 10,290 0,314 C30,316 68,304 84,286 Z"
    elif view == "back":
        d = "M120,276 C124,296 150,306 176,314 C160,318 128,318 118,300 Z"
    else:
        d = "M84,266 C48,276 20,296 8,316 C40,318 84,306 98,288 Z"
    return f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round"/>'


def _scarf(c: OtterColors, silhouette: bool, view: str = "tq") -> str:
    if silhouette:
        return ""
    band = f'<ellipse cx="132" cy="158" rx="44" ry="13" fill="{c.scarf}" stroke="{INK}" stroke-width="{STROKE}"/>'
    if view == "back" or view == "side":
        return band
    tail = f'<path d="M148,166 L164,168 L160,202 L146,198 Z" fill="{c.scarf}" stroke="{INK}" stroke-width="{STROKE}" stroke-linejoin="round"/>'
    return tail + band


def _body(c: OtterColors, silhouette: bool, garment: bool = True, view: str = "tq") -> str:
    fill = INK if silhouette else c.fur
    stroke = "none" if silhouette else INK
    out = [f'<path d="{BODY}" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}"/>']
    if not silhouette and view != "back":
        bx = 134 if view != "side" else 150
        out.append(f'<ellipse cx="{bx}" cy="230" rx="{44 if view != "side" else 34}" ry="56" fill="{c.face}"/>')
        out.append(f'<path d="M{bx-38},262 C{bx-18},288 {bx+18},288 {bx+38},262 C{bx+34},284 {bx-34},284 {bx-38},262 Z" fill="{c.face_dark}"/>')
    if garment and not silhouette and view != "back":
        if view == "side":
            out.append(f'<path d="M126,206 L170,206 L182,290 L118,290 Z" fill="{c.apron}" stroke="{INK}" stroke-width="{STROKE}" stroke-linejoin="round"/>')
        else:
            out.append(f'<path d="M100,206 L166,206 L178,290 L88,290 Z" fill="{c.apron}" stroke="{INK}" stroke-width="{STROKE}" stroke-linejoin="round"/>')
            out.append(f'<rect x="120" y="240" width="26" height="18" fill="{c.apron}" stroke="{c.apron_dark}" stroke-width="{STROKE * 0.8}"/>')
    return "\n".join(out)


def threequarter(c: OtterColors = OTTER, e: Expr = EXPRESSIONS["neutral"], p: Pose = POSES["neutral"],
                 silhouette=False, garment=True, ids=False, st: Style = OTTER_STYLE) -> str:
    def wrap(name, inner):
        return f'<g class="rig-{name}">{inner}</g>' if ids else inner

    g = (lambda name: f' id="{name}"') if ids else (lambda name: "")
    out = [f'<g{g("organizer")}>']
    out.append(_tail(c, silhouette))
    out.append(_legs_feet(c, p.stance, silhouette))
    out.append(f'<g{g("upper")} transform="{_rot(-p.lean, HIP[0], HIP[1])}">')
    out.append(wrap("upper", "\n".join([
        f'<g{g("far-wing")} transform="translate({SHOULDER_FAR[0]},{SHOULDER_FAR[1]})">{wrap("far-wing", _paw(c, p.wing_far, True, silhouette))}</g>',
        f'<g{g("body")}>{wrap("body", _body(c, silhouette, garment))}</g>',
        _scarf(c, silhouette),
        f'<g{g("head")} transform="translate({NECK[0] + p.head_dx},{NECK[1] + p.head_dy})">{wrap("head", head_threequarter(c, e, silhouette, st) + (_blink(c) if ids else ""))}</g>',
        f'<g{g("near-wing")} transform="translate({SHOULDER_NEAR[0]},{SHOULDER_NEAR[1]})">{wrap("near-wing", _paw(c, p.wing_near, False, silhouette))}</g>',
    ])))
    out.append("</g></g>")
    return _apply_line("\n".join(out), st)


def _blink(c: OtterColors) -> str:
    hy = HEAD_C[1] - NECK[1] + 2
    return (f'<g class="rig-blink"><ellipse cx="{-EYE_DX + 4}" cy="{hy}" rx="{EYE_R}" ry="{EYE_R + 1}" fill="{c.face}"/>'
            f'<ellipse cx="{EYE_DX + 8}" cy="{hy}" rx="{EYE_R + 1}" ry="{EYE_R + 1}" fill="{c.face}"/></g>')


def front(c: OtterColors = OTTER, e: Expr = EXPRESSIONS["neutral"], silhouette=False, st: Style = OTTER_STYLE) -> str:
    out = [_tail(c, silhouette, "front")]
    out.append(f'<g transform="translate({SHOULDER_FAR[0] - 4},{SHOULDER_FAR[1]})">{_paw(c, 4, True, silhouette)}</g>')
    out.append(f'<g transform="translate({SHOULDER_NEAR[0] + 4},{SHOULDER_NEAR[1]})">{_paw(c, 4, False, silhouette)}</g>')
    out.append(_legs_feet(c, 0, silhouette, "front"))
    out.append(_body(c, silhouette, True, "front"))
    out.append(_scarf(c, silhouette, "front"))
    out.append(f'<g transform="translate({NECK[0]},{NECK[1]})">{head_front(c, e, silhouette, st)}</g>')
    return _apply_line("\n".join(out), st)


def side(c: OtterColors = OTTER, e: Expr = EXPRESSIONS["neutral"], silhouette=False, st: Style = OTTER_STYLE) -> str:
    out = [_tail(c, silhouette, "side")]
    out.append(_legs_feet(c, 0, silhouette, "side"))
    out.append(_body(c, silhouette, True, "side"))
    out.append(_scarf(c, silhouette, "side"))
    out.append(f'<g transform="translate({NECK[0] + 6},{NECK[1]})">{head_side(c, e, silhouette, st)}</g>')
    out.append(f'<g transform="translate({NECK[0] + 14},{SHOULDER_NEAR[1]})">{_paw(c, 6, False, silhouette)}</g>')
    return _apply_line("\n".join(out), st)


def back(c: OtterColors = OTTER, silhouette=False, st: Style = OTTER_STYLE) -> str:
    out = [_legs_feet(c, 0, silhouette, "back")]
    out.append(_body(c, silhouette, True, "back"))
    out.append(_tail(c, silhouette, "back"))
    out.append(_scarf(c, silhouette, "back"))
    out.append(f'<g transform="translate({SHOULDER_FAR[0] - 4},{SHOULDER_FAR[1]})">{_paw(c, 4, True, silhouette)}</g>')
    out.append(f'<g transform="translate({SHOULDER_NEAR[0] + 4},{SHOULDER_NEAR[1]})">{_paw(c, 4, False, silhouette)}</g>')
    out.append(f'<g transform="translate({NECK[0]},{NECK[1]})">{head_back(c, silhouette)}</g>')
    return _apply_line("\n".join(out), st)


class Character:
    """The interface char_sheets.py expects. One object per organizer candidate."""
    name = "otter"
    prefix = "15"
    label = "organizer (otter), upright family"
    colors = OTTER
    head_top = HEAD_C[1] - HEAD_RY
    head_h = 2 * HEAD_RY
    pivots = ((132, 162), (180, 190), (84, 190), (132, 296))
    exception_note = "The mouth opens. Ears lift instead of tufts."

    threequarter = staticmethod(threequarter)
    front = staticmethod(front)
    side = staticmethod(side)
    back = staticmethod(back)
    head_threequarter = staticmethod(head_threequarter)
    notes = [
        f"Head: ellipse 112 x 96, centre 48 above the neck pivot. Figure is {HEADS_TALL:.1f} H tall. Ears add 10.",
        "Face mask: one oval 88 x 68 in the face color, set low and toward the near side. Eyes: circles radius 11, 19 either side.",
        "Nose: one triangle 14 wide. Mouth: a w-line closed, an oval open. Two whisker dots per cheek. One blush oval per cheek.",
        "Body: one egg 142 wide, 150 tall. Chest oval 88 x 112 in the face color. Apron trapezoid 66 to 90 wide. Scarf: one band, one tail.",
        "Paws: a capsule 22 wide, 44 long, ending in a mitt radius 15. Legs 16 wide, 20 tall. Feet: flippers 44 x 14.",
        "Tail: one tapered curve from the lower back to the ground, trailing behind the facing direction. It never leaves the ground plane.",
        "Materials: painted wood, matte. Scarf and apron are folded paper. Nose ink. Eyes ink with one highlight.",
    ]
