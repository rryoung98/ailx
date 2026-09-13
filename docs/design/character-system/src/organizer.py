"""The organizer: one parametric construction that serves every sheet.

Construction rules (also written in CHARACTER-SYSTEM.md):
  - Head unit H = 100. Head ellipse rx 50, ry 46. The tuft adds the last 8.
  - Figure is 2.5 H tall. Neck pivot at (132, 160). Ground at y = 320.
  - Eye line sits at 50 % of head height. Adults, not infants.
  - Eyes are solid ink ovals. Lids, not pupils, carry the expression.
  - Beak is two wedges. Only the lower wedge moves.
  - Wings are teardrops that pivot at the shoulder. Three primaries, no thumb.
  - One garment, one pocket. Flat fill plus one shade tone. No gradients.
"""

from __future__ import annotations

import itertools
import math
from dataclasses import dataclass, field

from palette import (
    BRASS, COBALT, COBALT_DARK, CORAL, CORAL_DARK, INK, OCHRE, OCHRE_DARK,
    SLATE, SLATE_DARK, STROKE,
)

_ids = itertools.count(1)

# Friendlier proportion, chosen after review on 2026-09-12 (sheet 11-friendly-variants).
# Head measurements below are head-local; the whole head group is then scaled by HEAD_SCALE.
HEAD_SCALE = 1.15   # figure becomes about 2.4 heads tall
EYE_SCALE = 1.4     # eyes 1.4x
BEAK_SCALE = 0.7    # shorter beak
BODY_ROUND = 1.0    # rounder egg body, widest point higher

NECK = (132.0, 160.0)
HEAD_C = (132.0, 118.0)
HEAD_RX, HEAD_RY = 50.0, 46.0
SHOULDER_NEAR = (176.0, 192.0)
SHOULDER_FAR = (88.0, 192.0)
GROUND = 320.0


@dataclass
class Colorway:
    name: str
    plumage: str
    plumage_dark: str
    garment: str
    garment_dark: str
    beak: str = OCHRE
    beak_dark: str = OCHRE_DARK


SELECTED = "B2"  # decided in pass 5 after the value test

COLORWAYS = {
    "A2": Colorway("A2  lighter cobalt plumage, coral vest", "#4E6DB8", "#3B559A", CORAL, CORAL_DARK),
    "M": Colorway("M  muted ochre plumage, dusk-blue vest, slate beak", "#CBA65C", "#A9884A", "#4A5C8A", "#3B4A70", SLATE, SLATE_DARK),
    "B2": Colorway("B2  ochre plumage, cobalt vest, slate beak", OCHRE, OCHRE_DARK, COBALT, COBALT_DARK, SLATE, SLATE_DARK),
    "A": Colorway("A  cobalt plumage, coral vest", COBALT, COBALT_DARK, CORAL, CORAL_DARK),
    "B": Colorway("B  ochre plumage, cobalt vest", OCHRE, OCHRE_DARK, COBALT, COBALT_DARK, BRASS, "#A8843A"),
    "C": Colorway("C  slate plumage, ochre vest", SLATE, SLATE_DARK, OCHRE, OCHRE_DARK),
}


@dataclass
class Style:
    """Rendering conventions. Construction never changes with these."""
    shine: bool = False        # small highlight in the upper part of each eye
    iris: bool = False         # a lighter inner oval inside the eye
    cel: bool = False          # hard shade crescent on the head and a band under the chin
    line: float = 1.0          # contour width multiplier


STYLE = Style()  # current default; the rendering study compares alternatives


@dataclass
class Expr:
    """Expression parameters. Angles in degrees, coverages 0..1."""
    head_tilt: float = 0.0     # + rotates the beak downward
    brow_lift: float = 0.0     # px upward for both brows
    brow_near: float = 0.0     # + lowers the inner (beak-side) end
    brow_far: float = 0.0
    lid_top: float = 0.0       # coverage of the eye from the top
    lid_bottom: float = 0.0    # coverage from the bottom (a squint)
    beak_open: float = 0.0     # 0 closed .. 1 wide
    beak_tilt: float = 0.0     # + lowers the whole beak
    tuft_up: float = 0.0       # 0..1 raises the tuft


EXPRESSIONS = {
    "neutral": Expr(),
    "listening": Expr(head_tilt=9, brow_lift=6, brow_near=-6, brow_far=-6, beak_tilt=-2),
    "uncertainty": Expr(head_tilt=-7, brow_lift=2, brow_near=-14, brow_far=10, lid_top=0.3, beak_open=0.15),
    "overcommitment": Expr(head_tilt=-12, brow_lift=9, lid_top=0.0, beak_open=1.0, tuft_up=1.0),
    "reconsideration": Expr(head_tilt=16, brow_lift=-2, brow_near=12, brow_far=12, lid_top=0.5, beak_tilt=4),
    "satisfaction": Expr(head_tilt=2, brow_lift=2, brow_near=-3, brow_far=-3, lid_bottom=0.45, beak_tilt=-6),
}


@dataclass
class Pose:
    """Body parameters for pose sheets. Wing angles rotate about the shoulder."""
    lean: float = 0.0          # whole figure rotates about the foot midpoint
    wing_near: float = 0.0     # + swings the near wing forward and up
    wing_far: float = 0.0
    head_dx: float = 0.0
    head_dy: float = 0.0
    stance: float = 0.0        # + spreads the feet


POSES = {
    "neutral": Pose(),
    "listening": Pose(lean=6, wing_near=8, wing_far=-4, head_dx=4),
    "uncertainty": Pose(lean=-4, wing_near=160, wing_far=-10, stance=-6),
    "overcommitment": Pose(lean=-10, wing_near=150, wing_far=150, stance=10),
    "reconsideration": Pose(lean=4, wing_near=60, wing_far=-30, head_dx=6, head_dy=4),
    "satisfaction": Pose(lean=-2, wing_near=35, wing_far=0, stance=4),
    "chair": Pose(lean=10, wing_near=70, wing_far=20, head_dx=6),
}


def _rot(deg: float, cx: float, cy: float) -> str:
    return f"rotate({deg:.2f} {cx:.1f} {cy:.1f})"


def _eye(ex: float, ey: float, rx: float, ry: float, e: Expr, plumage: str, st: Style = None) -> str:
    st = st or STYLE
    cid = f"lid{next(_ids)}"
    top_h = 2 * ry * e.lid_top
    bot_h = 2 * ry * e.lid_bottom
    out = [f'<clipPath id="{cid}"><ellipse cx="{ex}" cy="{ey}" rx="{rx}" ry="{ry}"/></clipPath>']
    out.append(f'<ellipse cx="{ex}" cy="{ey}" rx="{rx}" ry="{ry}" fill="{INK}"/>')
    if st.iris:
        out.append(f'<ellipse cx="{ex}" cy="{ey + ry * 0.15}" rx="{rx * 0.62}" ry="{ry * 0.62}" fill="#4E4034" clip-path="url(#{cid})"/>')
    if st.shine:
        out.append(f'<ellipse cx="{ex + rx * 0.3}" cy="{ey - ry * 0.42}" rx="{rx * 0.34}" ry="{ry * 0.24}" fill="#FFFFFF" clip-path="url(#{cid})"/>')
    if top_h > 0:
        out.append(f'<rect x="{ex-rx-1}" y="{ey-ry-1}" width="{2*rx+2}" height="{top_h+1}" fill="{plumage}" clip-path="url(#{cid})"/>')
        out.append(f'<line x1="{ex-rx}" y1="{ey-ry+top_h}" x2="{ex+rx}" y2="{ey-ry+top_h}" stroke="{INK}" stroke-width="{STROKE*0.6}" clip-path="url(#{cid})"/>')
    if bot_h > 0:
        out.append(f'<rect x="{ex-rx-1}" y="{ey+ry-bot_h}" width="{2*rx+2}" height="{bot_h+1}" fill="{plumage}" clip-path="url(#{cid})"/>')
        out.append(f'<line x1="{ex-rx}" y1="{ey+ry-bot_h}" x2="{ex+rx}" y2="{ey+ry-bot_h}" stroke="{INK}" stroke-width="{STROKE*0.6}" clip-path="url(#{cid})"/>')
    return "\n".join(out)


def _brow(cx: float, cy: float, angle: float, length: float = 18.0) -> str:
    return (
        f'<line x1="{cx-length/2}" y1="{cy}" x2="{cx+length/2}" y2="{cy}" stroke="{INK}" '
        f'stroke-width="{STROKE*1.1}" stroke-linecap="round" transform="{_rot(angle, cx, cy)}"/>'
    )


def head_threequarter(c: Colorway, e: Expr, eye_line: float = 0.5, head_scale: float = HEAD_SCALE,
                      silhouette: bool = False, eye_scale: float = EYE_SCALE, beak_scale: float = BEAK_SCALE,
                      st: Style = None) -> str:
    st = st or STYLE
    """Three-quarter head facing right. Local origin is the neck pivot."""
    hx, hy = HEAD_C[0] - NECK[0], HEAD_C[1] - NECK[1]  # (0, -42)
    fill = INK if silhouette else c.plumage
    stroke = "none" if silhouette else INK
    ey = hy - HEAD_RY + eye_line * 2 * HEAD_RY
    tuft_dy = -8 * e.tuft_up
    parts = [f'<g transform="{_rot(e.head_tilt, 0, 0)} scale({head_scale})">']
    # tuft: one notch of two feathers
    parts.append(f'<path d="M-14,{hy-38} L-8,{hy-64+tuft_dy} L2,{hy-42} L14,{hy-60+tuft_dy} L16,{hy-36} Z" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round"/>')
    parts.append(f'<ellipse cx="{hx}" cy="{hy}" rx="{HEAD_RX}" ry="{HEAD_RY}" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}"/>')
    if st.cel and not silhouette:
        hid = f"cel{next(_ids)}"
        parts.append(f'<clipPath id="{hid}"><ellipse cx="{hx}" cy="{hy}" rx="{HEAD_RX}" ry="{HEAD_RY}"/></clipPath>')
        parts.append(f'<ellipse cx="{hx - 4}" cy="{hy + 14}" rx="{HEAD_RX}" ry="{HEAD_RY}" fill="{c.plumage_dark}" clip-path="url(#{hid})"/>')
        parts.append(f'<ellipse cx="{hx + 2}" cy="{hy - 4}" rx="{HEAD_RX}" ry="{HEAD_RY}" fill="{c.plumage}" clip-path="url(#{hid})"/>')
    # beak: upper wedge fixed, lower wedge rotates open
    bx, by = 36, hy + 6
    parts.append(f'<g transform="{_rot(e.beak_tilt, bx, by)}">')
    lower_fill = INK if silhouette else c.beak_dark
    parts.append(f'<polygon points="{bx},{by} {bx+58*beak_scale},{by} {bx},{by+16}" fill="{lower_fill}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round" transform="{_rot(24*e.beak_open, bx, by)}"/>')
    parts.append(f'<polygon points="{bx},{by-16} {bx+62*beak_scale},{by+1} {bx},{by+1}" fill="{INK if silhouette else c.beak}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round"/>')
    parts.append("</g>")
    if not silhouette:
        parts.append(_eye(hx + 16, ey, 7 * eye_scale, 9 * eye_scale, e, c.plumage, st))
        parts.append(_eye(hx - 24, ey, 5 * eye_scale, 9 * eye_scale, e, c.plumage, st))
        parts.append(_brow(hx + 18, ey - 18 * eye_scale - e.brow_lift, e.brow_near))
        parts.append(_brow(hx - 24, ey - 18 * eye_scale - e.brow_lift, e.brow_far, 14))
    parts.append("</g>")
    return "\n".join(parts)


def head_front(c: Colorway, e: Expr, silhouette: bool = False) -> str:
    hx, hy = 0.0, -42.0
    fill = INK if silhouette else c.plumage
    stroke = "none" if silhouette else INK
    ey = hy
    parts = [f'<g transform="scale({HEAD_SCALE})">', f'<path d="M-16,{hy-38} L-10,{hy-64} L0,{hy-44} L10,{hy-64} L16,{hy-38} Z" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round"/>']
    parts.append(f'<ellipse cx="{hx}" cy="{hy}" rx="{HEAD_RX+2}" ry="{HEAD_RY}" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}"/>')
    # front beak: a diamond seen tip-on, split line across
    parts.append(f'<polygon points="-16,{hy+2} 16,{hy+2} 0,{hy+2+34*BEAK_SCALE}" fill="{INK if silhouette else c.beak_dark}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round"/>')
    parts.append(f'<polygon points="-16,{hy+3} 16,{hy+3} 0,{hy-12}" fill="{INK if silhouette else c.beak}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round"/>')
    if not silhouette:
        parts.append(_eye(hx - 24, ey, 7 * EYE_SCALE, 9 * EYE_SCALE, e, c.plumage))
        parts.append(_eye(hx + 24, ey, 7 * EYE_SCALE, 9 * EYE_SCALE, e, c.plumage))
        parts.append(_brow(hx - 24, ey - 18 * EYE_SCALE - e.brow_lift, -e.brow_near))
        parts.append(_brow(hx + 24, ey - 18 * EYE_SCALE - e.brow_lift, e.brow_near))
    parts.append("</g>")
    return "\n".join(parts)


def head_side(c: Colorway, e: Expr, silhouette: bool = False) -> str:
    hx, hy = 0.0, -42.0
    fill = INK if silhouette else c.plumage
    stroke = "none" if silhouette else INK
    parts = [f'<g transform="scale({HEAD_SCALE})">', f'<path d="M-22,{hy-36} L-14,{hy-62} L-2,{hy-40} L8,{hy-58} L12,{hy-34} Z" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round"/>']
    parts.append(f'<ellipse cx="{hx}" cy="{hy}" rx="{HEAD_RX-4}" ry="{HEAD_RY}" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}"/>')
    bx, by = 40, hy + 6
    parts.append(f'<polygon points="{bx},{by} {bx+66*BEAK_SCALE},{by} {bx},{by+16}" fill="{INK if silhouette else c.beak_dark}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round" transform="{_rot(24*e.beak_open, bx, by)}"/>')
    parts.append(f'<polygon points="{bx},{by-16} {bx+70*BEAK_SCALE},{by+1} {bx},{by+1}" fill="{INK if silhouette else c.beak}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round"/>')
    if not silhouette:
        parts.append(_eye(hx + 18, hy, 6 * EYE_SCALE, 9 * EYE_SCALE, e, c.plumage))
        parts.append(_brow(hx + 20, hy - 18 * EYE_SCALE - e.brow_lift, e.brow_near, 16))
    parts.append("</g>")
    return "\n".join(parts)


def head_back(c: Colorway, silhouette: bool = False) -> str:
    hx, hy = 0.0, -42.0
    fill = INK if silhouette else c.plumage
    stroke = "none" if silhouette else INK
    parts = [f'<g transform="scale({HEAD_SCALE})">', f'<path d="M-16,{hy-38} L-10,{hy-64} L0,{hy-44} L10,{hy-64} L16,{hy-38} Z" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round"/>']
    parts.append(f'<ellipse cx="{hx}" cy="{hy}" rx="{HEAD_RX+2}" ry="{HEAD_RY}" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}"/>')
    parts.append("</g>")
    return "\n".join(parts)


def _wing(c: Colorway, angle: float, mirror: bool, silhouette: bool) -> str:
    fill = INK if silhouette else c.plumage
    stroke = "none" if silhouette else INK
    sx = -1 if mirror else 1
    body = (
        f'<path d="M0,0 C16,6 26,40 18,66 C14,80 -6,80 -10,66 C-16,40 -10,10 0,0 Z" '
        f'fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round"/>'
    )
    primaries = "" if silhouette else (
        f'<path d="M-4,60 L-2,72 M6,62 L8,74" stroke="{INK}" stroke-width="{STROKE*0.7}" stroke-linecap="round"/>'
    )
    return f'<g transform="{_rot(-angle * sx, 0, 0)} scale({sx},1)">{body}{primaries}</g>'


def _legs_feet(c: Colorway, stance: float, silhouette: bool, view: str = "tq") -> str:
    fill = INK if silhouette else c.beak
    stroke = "none" if silhouette else INK
    lw = STROKE
    if view == "side":
        xs = [126, 142]
    else:
        xs = [112 - stance, 152 + stance]
    out = []
    for i, x in enumerate(xs):
        out.append(f'<rect x="{x-4}" y="288" width="8" height="22" fill="{fill}" stroke="{stroke}" stroke-width="{lw}"/>')
        if view == "side":
            out.append(f'<polygon points="{x-16},{GROUND} {x+40},{GROUND} {x-2},{GROUND-14}" fill="{fill}" stroke="{stroke}" stroke-width="{lw}" stroke-linejoin="round"/>')
        elif view == "back":
            out.append(f'<polygon points="{x-26},{GROUND} {x+26},{GROUND} {x},{GROUND-8}" fill="{fill}" stroke="{stroke}" stroke-width="{lw}" stroke-linejoin="round"/>')
        elif view == "front":
            out.append(f'<polygon points="{x-26},{GROUND} {x+26},{GROUND} {x},{GROUND-16}" fill="{fill}" stroke="{stroke}" stroke-width="{lw}" stroke-linejoin="round"/>')
        else:
            spread = -1 if i == 0 else 1
            out.append(f'<polygon points="{x-26+spread*6},{GROUND} {x+28+spread*6},{GROUND} {x+spread*2},{GROUND-14}" fill="{fill}" stroke="{stroke}" stroke-width="{lw}" stroke-linejoin="round"/>')
    return "\n".join(out)


BODY_PATH = "M132,158 C176,158 194,222 190,262 C186,300 78,300 74,262 C70,222 88,158 132,158 Z"
VEST_PATH = "M104,180 L132,210 L160,180 C180,206 184,246 178,284 L86,284 C80,246 84,206 104,180 Z"


def _body_path(r: float) -> str:
    """r = 0 is the pear. r = 1 is a rounder egg with the widest point higher."""
    w = 62 + 10 * r
    a = 44 + 8 * r
    my = 222 - 30 * r
    return (f"M132,158 C{132+a:g},158 {132+w:g},{my:g} {132+w-4:g},262 "
            f"C{132+w-8:g},300 {132-w+8:g},300 {132-w+4:g},262 C{132-w:g},{my:g} {132-a:g},158 132,158 Z")


def _body(c: Colorway, silhouette: bool, garment: bool = True, view: str = "tq", body_round: float = BODY_ROUND,
          st: Style = None) -> str:
    st = st or STYLE
    fill = INK if silhouette else c.plumage
    stroke = "none" if silhouette else INK
    out = [f'<path d="{_body_path(body_round)}" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}"/>']
    if not silhouette:
        # one shade tone on the underside
        out.append(f'<path d="M84,270 C100,296 164,296 180,270 C176,292 88,292 84,270 Z" fill="{c.plumage_dark}"/>')
    if st.cel and not silhouette:
        bid = f"celb{next(_ids)}"
        out.append(f'<clipPath id="{bid}"><path d="{_body_path(body_round)}"/></clipPath>')
        out.append(f'<ellipse cx="132" cy="150" rx="70" ry="34" fill="{c.plumage_dark}" clip-path="url(#{bid})"/>')
    if view == "back":
        out.append(f'<polygon points="120,292 144,292 132,306" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round"/>')
    if view == "side":
        out.append(f'<polygon points="80,262 58,284 86,280" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round"/>')
    if garment and not silhouette:
        if view == "back":
            out.append(f'<path d="M100,178 C92,220 90,250 92,284 L172,284 C174,250 172,220 164,178 C150,172 114,172 100,178 Z" fill="{c.garment}" stroke="{INK}" stroke-width="{STROKE}"/>')
        elif view == "side":
            out.append(f'<path d="M108,178 C96,214 94,250 98,284 L174,284 C182,250 178,214 164,178 C150,172 122,172 108,178 Z" fill="{c.garment}" stroke="{INK}" stroke-width="{STROKE}"/>')
        else:
            out.append(f'<path d="{VEST_PATH}" fill="{c.garment}" stroke="{INK}" stroke-width="{STROKE}"/>')
            out.append(f'<rect x="150" y="238" width="16" height="14" fill="{c.garment}" stroke="{c.garment_dark}" stroke-width="{STROKE*0.8}"/>')
    return "\n".join(out)


def organizer_threequarter(c: Colorway, e: Expr = EXPRESSIONS["neutral"], p: Pose = POSES["neutral"],
                           silhouette: bool = False, garment: bool = True, eye_line: float = 0.5,
                           head_scale: float = HEAD_SCALE, ids: bool = False, eye_scale: float = EYE_SCALE,
                           beak_scale: float = BEAK_SCALE, body_round: float = BODY_ROUND, st: Style = None) -> str:
    st = st or STYLE
    """Full figure, three-quarter view, in the 260 x 340 box.

    With ids=True every moving part gets an id and an inner class="rig-*" group
    that CSS can transform about its local origin. The lean pivots at the hips
    (revised in pass 8: rotating about the feet lifted them off the ground).
    """
    def wrap(name: str, inner: str) -> str:
        return f'<g class="rig-{name}">{inner}</g>' if ids else inner

    g = (lambda name: f' id="{name}"') if ids else (lambda name: "")
    out = [f'<g{g("organizer")}>']
    out.append(_legs_feet(c, p.stance, silhouette))
    out.append(f'<g{g("upper")} transform="{_rot(-p.lean, HIP[0], HIP[1])}">')
    out.append(wrap("upper", "\n".join([
        f'<g{g("far-wing")} transform="translate({SHOULDER_FAR[0]},{SHOULDER_FAR[1]})">{wrap("far-wing", _wing(c, p.wing_far, True, silhouette))}</g>',
        f'<g{g("body")}>{wrap("body", _body(c, silhouette, garment, body_round=body_round, st=st))}</g>',
        f'<g{g("head")} transform="translate({NECK[0]+p.head_dx},{NECK[1]+p.head_dy})">{wrap("head", head_threequarter(c, e, eye_line, head_scale, silhouette, eye_scale, beak_scale, st) + (f'<g transform="scale({head_scale})">{_blink(c, eye_scale)}</g>' if ids else ""))}</g>',
        f'<g{g("near-wing")} transform="translate({SHOULDER_NEAR[0]},{SHOULDER_NEAR[1]})">{wrap("near-wing", _wing(c, p.wing_near, False, silhouette))}</g>',
    ])))
    out.append("</g></g>")
    svg_text = "\n".join(out)
    if st.line != 1.0:
        import re
        svg_text = re.sub(r'stroke-width="([0-9.]+)"', lambda m: f'stroke-width="{float(m.group(1)) * st.line:.2f}"', svg_text)
    return svg_text


def _blink(c: Colorway, eye_scale: float = EYE_SCALE) -> str:
    """Plumage-colored lids that CSS scales down over the eyes. Local origin: neck."""
    hy = HEAD_C[1] - NECK[1]
    return (
        f'<g class="rig-blink">'
        f'<ellipse cx="16" cy="{hy}" rx="{8 * eye_scale}" ry="{10 * eye_scale}" fill="{c.plumage}"/>'
        f'<ellipse cx="-24" cy="{hy}" rx="{6 * eye_scale}" ry="{10 * eye_scale}" fill="{c.plumage}"/>'
        f'</g>'
    )


HIP = (132.0, 296.0)
CX_FEET = 132.0


def organizer_front(c: Colorway, e: Expr = EXPRESSIONS["neutral"], silhouette: bool = False) -> str:
    out = [f'<g transform="translate({SHOULDER_FAR[0]-6},{SHOULDER_FAR[1]})">{_wing(c, 4, True, silhouette)}</g>']
    out.append(f'<g transform="translate({SHOULDER_NEAR[0]+6},{SHOULDER_NEAR[1]})">{_wing(c, 4, False, silhouette)}</g>')
    out.append(_legs_feet(c, 0, silhouette, "front"))
    out.append(_body(c, silhouette, True, "front"))
    out.append(f'<g transform="translate({NECK[0]},{NECK[1]})">{head_front(c, e, silhouette)}</g>')
    return "\n".join(out)


def organizer_side(c: Colorway, e: Expr = EXPRESSIONS["neutral"], silhouette: bool = False) -> str:
    out = [_legs_feet(c, 0, silhouette, "side")]
    out.append(_body(c, silhouette, True, "side"))
    out.append(f'<g transform="translate({NECK[0]+8},{NECK[1]})">{head_side(c, e, silhouette)}</g>')
    out.append(f'<g transform="translate({NECK[0]+10},{SHOULDER_NEAR[1]})">{_wing(c, 6, False, silhouette)}</g>')
    return "\n".join(out)


def organizer_back(c: Colorway, silhouette: bool = False) -> str:
    out = [_legs_feet(c, 0, silhouette, "back")]
    out.append(_body(c, silhouette, True, "back"))
    out.append(f'<g transform="translate({SHOULDER_FAR[0]-6},{SHOULDER_FAR[1]})">{_wing(c, 4, True, silhouette)}</g>')
    out.append(f'<g transform="translate({SHOULDER_NEAR[0]+6},{SHOULDER_NEAR[1]})">{_wing(c, 4, False, silhouette)}</g>')
    out.append(f'<g transform="translate({NECK[0]},{NECK[1]})">{head_back(c, silhouette)}</g>')
    return "\n".join(out)
