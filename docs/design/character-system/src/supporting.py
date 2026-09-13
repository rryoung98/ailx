"""Two supporting concepts that test the system, not a cast.

Both obey the shared rules from organizer.py: eye line at 50 % of head height,
solid ink eyes, lids carry expression, one garment, one shade tone, charcoal
contour, flat fills. Each breaks one rule on purpose and says so.

  Source keeper  low/broad family, 2.0 heads. Exception: eyes are dots, so the
                 brows do the acting. Spade hands are the largest hands in the cast.
  Loupe          instrument family, 1.5 heads. Exception: no brows and no mouth.
                 The rim tilt and the lids do all the acting.
"""

from __future__ import annotations

import itertools

from organizer import Expr, _brow, _eye
from palette import (
    BRASS, CORAL, CREAM, CREAM_DARK, INK, LILAC_DARK, STROKE, WOOD, WOOD_DARK,
)

# Fur is the darker lilac. Slate matched the wall's luminance and vanished at 48 px.
FUR = LILAC_DARK
FUR_DARK = "#66568A"

GROUND = 320.0
_ids = itertools.count(1000)


# ---------------------------------------------------------------------------
# Source keeper
# ---------------------------------------------------------------------------

KEEPER_HEAD = (136.0, 182.0)
KEEPER_RX, KEEPER_RY = 46.0, 40.0


def keeper(e: Expr = Expr(), silhouette: bool = False, garment: bool = True,
           hand_near: float = 0.0) -> str:
    """Three-quarter view facing right. hand_near lifts the near hand, 0..1."""
    fill = INK if silhouette else FUR
    stroke = "none" if silhouette else INK
    hx, hy = KEEPER_HEAD
    out = []
    # far hand, hanging
    out.append(f'<path d="M84,228 C60,236 48,270 58,292 C66,306 92,302 94,284 C96,266 92,246 96,232 Z" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round"/>')
    # legs and flat feet
    for x in (108, 160):
        out.append(f'<rect x="{x-8}" y="292" width="16" height="16" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}"/>')
        out.append(f'<rect x="{x-20}" y="306" width="44" height="14" rx="4" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}"/>')
    # body trapezoid
    out.append(f'<path d="M100,214 L176,214 L206,300 L70,300 Z" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round"/>')
    if garment and not silhouette:
        out.append(f'<path d="M104,214 L138,236 L172,214 L196,270 L80,270 Z" fill="{CREAM}" stroke="{INK}" stroke-width="{STROKE}" stroke-linejoin="round"/>')
        out.append(f'<path d="M80,270 L196,270 L200,282 L76,282 Z" fill="{CREAM_DARK}" stroke="{INK}" stroke-width="{STROKE}" stroke-linejoin="round"/>')
    elif not silhouette:
        out.append(f'<path d="M78,276 L198,276 L206,300 L70,300 Z" fill="{FUR_DARK}"/>')
    # head
    out.append(f'<g transform="rotate({e.head_tilt:.1f} {hx} {hy+40})">')
    out.append(f'<ellipse cx="{hx}" cy="{hy}" rx="{KEEPER_RX}" ry="{KEEPER_RY}" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}"/>')
    # blunt snout, one shape, pointing right
    out.append(f'<ellipse cx="{hx+44}" cy="{hy+8}" rx="14" ry="10" fill="{INK if silhouette else CORAL}" stroke="{stroke}" stroke-width="{STROKE}"/>')
    if not silhouette:
        ey = hy  # 50 % of head height
        # dot eyes: lids still apply through the shared helper
        out.append(_eye(hx + 16, ey, 4, 5, e, FUR))
        out.append(_eye(hx - 14, ey, 3.5, 5, e, FUR))
        out.append(_brow(hx + 16, ey - 14 - e.brow_lift, e.brow_near, 22))
        out.append(_brow(hx - 14, ey - 14 - e.brow_lift, e.brow_far, 18))
    out.append("</g>")
    # near hand: a spade, lifts from the shoulder
    out.append(f'<g transform="rotate({-70*hand_near:.1f} 188 230)">')
    out.append(f'<path d="M188,228 C212,236 224,270 214,292 C206,306 180,302 178,284 C176,266 180,246 176,232 Z" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round"/>')
    if not silhouette:
        out.append(f'<path d="M196,262 L200,290 M206,262 L208,290" stroke="{INK}" stroke-width="{STROKE*0.7}" stroke-linecap="round"/>')
    out.append("</g>")
    return "\n".join(out)


# ---------------------------------------------------------------------------
# Loupe companion
# ---------------------------------------------------------------------------

LOUPE_C = (130.0, 222.0)
LOUPE_R = 46.0


def loupe(e: Expr = Expr(), silhouette: bool = False, arm_near: float = 0.0) -> str:
    """Front view. The rim tilts with head_tilt. arm_near raises the near arm, 0..1."""
    cx, cy = LOUPE_C
    fill = INK if silhouette else CREAM
    stroke = "none" if silhouette else INK
    out = []
    # stem and grip
    out.append(f'<rect x="{cx-6}" y="{cy+40}" width="12" height="30" fill="{INK if silhouette else BRASS}" stroke="{stroke}" stroke-width="{STROKE}"/>')
    out.append(f'<path d="M{cx-12},{cy+70} L{cx+12},{cy+70} L{cx+16},{cy+98} L{cx-16},{cy+98} Z" fill="{INK if silhouette else WOOD}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round"/>')
    if not silhouette:
        out.append(f'<rect x="{cx-16}" y="{cy+92}" width="32" height="6" fill="{WOOD_DARK}"/>')
    # stick legs and small wedge feet
    for sx in (-1, 1):
        x = cx + sx * 8
        out.append(f'<line x1="{x}" y1="{cy+98}" x2="{x}" y2="{GROUND-4}" stroke="{INK}" stroke-width="{STROKE*1.6}" stroke-linecap="round"/>')
        out.append(f'<polygon points="{x-4},{GROUND} {x+sx*22},{GROUND} {x+sx*4},{GROUND-8}" fill="{INK if silhouette else BRASS}" stroke="{stroke}" stroke-width="{STROKE}" stroke-linejoin="round"/>')
    # arms: brass sticks from the rim
    for sx, lift in ((-1, 0.0), (1, arm_near)):
        ax, ay = cx + sx * 40, cy + 22
        ang = -sx * (20 + 90 * lift)
        out.append(f'<g transform="rotate({ang:.1f} {ax} {ay})">')
        out.append(f'<line x1="{ax}" y1="{ay}" x2="{ax + sx*6}" y2="{ay+50}" stroke="{INK}" stroke-width="{STROKE*1.6}" stroke-linecap="round"/>')
        out.append(f'<circle cx="{ax + sx*6}" cy="{ay+50}" r="6" fill="{INK if silhouette else BRASS}" stroke="{stroke}" stroke-width="{STROKE}"/>')
        out.append("</g>")
    # lens with rim, tilts as a head
    out.append(f'<g transform="rotate({e.head_tilt:.1f} {cx} {cy+40})">')
    out.append(f'<circle cx="{cx}" cy="{cy}" r="{LOUPE_R}" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE}"/>')
    if not silhouette:
        out.append(f'<circle cx="{cx}" cy="{cy}" r="{LOUPE_R}" fill="none" stroke="{BRASS}" stroke-width="7"/>')
        out.append(f'<circle cx="{cx}" cy="{cy}" r="{LOUPE_R+3.5}" fill="none" stroke="{INK}" stroke-width="{STROKE}"/>')
        out.append(f'<circle cx="{cx}" cy="{cy}" r="{LOUPE_R-3.5}" fill="none" stroke="{INK}" stroke-width="{STROKE*0.8}"/>')
        # eyes on the 50 % line of the lens. No brows, no mouth.
        out.append(_eye(cx - 14, cy, 6, 8, e, CREAM))
        out.append(_eye(cx + 14, cy, 6, 8, e, CREAM))
    out.append("</g>")
    return "\n".join(out)


# ---------------------------------------------------------------------------
# A related upright bird, used only to test that the family stays distinguishable.
# ---------------------------------------------------------------------------

def sil_wader() -> str:
    """Silhouette of a taller upright bird: 3 heads, straight thin beak, long legs."""
    return f"""
<g fill="{INK}">
  <ellipse cx="138" cy="72" rx="34" ry="32"/>
  <path d="M166,66 L232,74 L166,82 Z"/>
  <path d="M132,100 L146,100 L150,150 L128,150 Z"/>
  <path d="M138,146 C176,146 190,196 186,232 C182,262 96,262 92,232 C88,196 100,146 138,146 Z"/>
  <path d="M96,170 C74,180 70,220 82,238 C88,246 100,240 100,228 C102,206 100,184 104,172 Z"/>
  <path d="M116,258 L122,258 L122,308 L116,308 Z"/>
  <path d="M154,258 L160,258 L160,308 L154,308 Z"/>
  <path d="M94,320 L142,320 L118,306 Z"/>
  <path d="M136,320 L184,320 L158,306 Z"/>
</g>"""
