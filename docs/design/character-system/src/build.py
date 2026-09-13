#!/usr/bin/env python3
"""Shared helpers and the pass 3 silhouette alternatives.

sheets.py is the entry point. Run from the repo root:

    python3 docs/design/character-system/src/sheets.py

Outputs land in docs/design/character-system/svg/. Render with render.sh.
"""

from __future__ import annotations

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dataclasses import dataclass

OUT = os.path.join(os.path.dirname(__file__), "..", "svg")

# ---------------------------------------------------------------------------
# Shared construction constants. Every figure lives in a 260 x 340 box.
# The head unit H is 100 for the organizer. Ground is y = 320.
# ---------------------------------------------------------------------------
W, HGT = 260, 340
GROUND = 320
CX = 130

from palette import *  # noqa: F401,F403



def svg(width: int, height: int, body: str, bg: str = PAPER) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">\n'
        f'<rect width="{width}" height="{height}" fill="{bg}"/>\n{body}\n</svg>\n'
    )


def write(name: str, content: str) -> None:
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(content)
    print("wrote", os.path.relpath(path))


def text(x, y, s, size=13, anchor="start", weight="normal", fill=INK) -> str:
    return (
        f'<text x="{x}" y="{y}" font-family="Helvetica, Arial, sans-serif" font-size="{size}" '
        f'text-anchor="{anchor}" font-weight="{weight}" fill="{fill}">{s}</text>'
    )


def grid_lines(h: float, top: float, heads: float) -> str:
    """Head-unit guide lines for proportion sheets."""
    out = []
    for i in range(int(heads) + 1):
        y = top + i * h
        out.append(f'<line x1="10" y1="{y}" x2="{W-10}" y2="{y}" stroke="{LILAC}" stroke-width="0.8" stroke-dasharray="4 4"/>')
        out.append(text(12, y - 3, f"{i}H", 9, fill=LILAC_DARK))
    return "\n".join(out)


# ---------------------------------------------------------------------------
# Silhouette alternatives for pass 3. Solid fills, no props, three-quarter view.
# Each returns SVG in the 260 x 340 box. Labels are S1..S5, not names.
# ---------------------------------------------------------------------------

def sil_s1_human() -> str:
    """S1: tall human host. 3 heads. Bean torso, long legs, angular hair."""
    return f"""
<g fill="{INK}">
  <path d="M112,52 L128,36 L150,44 L172,40 L178,66 L170,74 L118,72 Z"/>
  <ellipse cx="144" cy="82" rx="30" ry="34"/>
  <path d="M132,110 L156,110 L160,122 L128,122 Z"/>
  <path d="M116,120 C96,126 84,180 96,220 L184,220 C198,180 188,126 168,120 Z"/>
  <path d="M98,142 C80,160 72,186 78,206 L92,204 C90,186 96,164 108,150 Z"/>
  <path d="M186,140 C204,152 216,180 214,206 L198,208 C198,186 190,166 178,152 Z"/>
  <path d="M104,220 L124,220 L118,300 L100,300 Z"/>
  <path d="M158,220 L178,220 L178,300 L160,300 Z"/>
  <path d="M92,300 L124,300 L126,320 L84,320 Z"/>
  <path d="M158,300 L188,300 L196,320 L154,320 Z"/>
</g>"""


def sil_s2_crested_bird() -> str:
    """S2: crested bird. 2.75 heads. Narrow pear, long beak, low crest, broad feet."""
    return f"""
<g fill="{INK}">
  <path d="M96,80 L74,60 L104,66 L92,44 L118,62 L124,40 L134,66 Z"/>
  <ellipse cx="136" cy="94" rx="40" ry="38"/>
  <path d="M164,90 L236,104 L166,118 Z"/>
  <path d="M136,126 C170,126 178,190 170,250 C166,286 106,286 100,250 C92,190 102,126 136,126 Z"/>
  <path d="M100,150 C80,170 74,220 84,250 C90,262 100,258 102,244 C104,210 100,178 108,152 Z"/>
  <path d="M170,150 C190,170 196,220 186,250 C180,262 170,258 168,244 C166,210 170,178 162,152 Z"/>
  <path d="M120,282 L126,282 L126,306 L120,306 Z"/>
  <path d="M148,282 L154,282 L154,306 L148,306 Z"/>
  <path d="M96,320 L146,320 L122,304 Z"/>
  <path d="M132,320 L182,320 L152,304 Z"/>
  <path d="M100,250 L78,272 L104,266 Z"/>
</g>"""


def sil_s3_mole() -> str:
    """S3: steady mole. 2 heads. Low trapezoid, blunt snout, spade hands."""
    return f"""
<g fill="{INK}">
  <ellipse cx="140" cy="126" rx="46" ry="42"/>
  <ellipse cx="184" cy="136" rx="14" ry="10"/>
  <path d="M100,160 L180,160 L214,300 L66,300 Z"/>
  <path d="M74,200 C50,220 42,262 56,286 C70,300 96,290 92,268 C88,246 86,222 96,200 Z"/>
  <path d="M188,200 C212,220 220,262 206,286 C192,300 166,290 170,268 C174,246 176,222 166,200 Z"/>
  <path d="M60,286 C38,290 32,310 44,318 L86,318 C92,300 80,284 60,286 Z"/>
  <path d="M202,286 C224,290 230,310 218,318 L176,318 C170,300 182,284 202,286 Z"/>
  <path d="M90,300 L124,300 L124,320 L84,320 Z"/>
  <path d="M156,300 L190,300 L196,320 L156,320 Z"/>
</g>"""


def sil_s4_compact_bird() -> str:
    """S4: compact ground bird. 2.5 heads. Egg body, wedge beak, one tuft, short wings."""
    return f"""
<g fill="{INK}">
  <path d="M118,80 L124,54 L134,76 L146,58 L148,82 Z"/>
  <ellipse cx="132" cy="118" rx="50" ry="46"/>
  <path d="M170,108 L228,122 L170,140 Z"/>
  <path d="M132,158 C176,158 194,222 190,262 C186,300 78,300 74,262 C70,222 88,158 132,158 Z"/>
  <path d="M86,186 C62,196 54,246 68,268 C76,278 90,272 92,258 C96,236 92,206 96,190 Z"/>
  <path d="M176,186 C200,196 208,246 194,268 C186,278 172,272 170,258 C166,236 170,206 166,190 Z"/>
  <path d="M110,290 L116,290 L116,308 L110,308 Z"/>
  <path d="M148,290 L154,290 L154,308 L148,308 Z"/>
  <path d="M84,320 L136,320 L112,306 Z"/>
  <path d="M130,320 L184,320 L152,306 Z"/>
</g>"""


def sil_s5_chair() -> str:
    """S5: folding-chair instrument character. 2 heads. Backrest head, seat body, stick legs."""
    return f"""
<g fill="{INK}">
  <path d="M96,60 L172,60 L180,150 L88,150 Z"/>
  <path d="M84,150 L184,150 L200,200 L68,200 Z"/>
  <path d="M84,200 L96,200 L110,300 L98,300 Z"/>
  <path d="M172,200 L184,200 L180,300 L168,300 Z"/>
  <path d="M110,200 L118,200 L126,262 L118,262 Z"/>
  <path d="M148,200 L156,200 L152,262 L144,262 Z"/>
  <path d="M60,160 C44,180 40,220 50,236 L64,232 C58,214 62,190 74,170 Z"/>
  <path d="M206,160 C222,180 226,220 216,236 L202,232 C208,214 204,190 192,170 Z"/>
  <path d="M86,300 L120,300 L124,320 L78,320 Z"/>
  <path d="M158,300 L192,300 L200,320 L152,320 Z"/>
</g>"""


def sil_loupe() -> str:
    """The storyboard loupe companion, drawn as a silhouette for distinctness tests."""
    return f"""
<g fill="{INK}">
  <circle cx="130" cy="150" r="62"/>
  <path d="M124,210 L136,210 L136,268 L124,268 Z"/>
  <path d="M118,268 L142,268 L146,296 L114,296 Z"/>
  <path d="M100,180 C80,196 70,220 74,244 L86,242 C86,222 94,204 108,190 Z"/>
  <path d="M160,180 C180,196 190,220 186,244 L174,242 C174,222 166,204 152,190 Z"/>
  <path d="M116,296 L122,296 L122,314 L116,314 Z"/>
  <path d="M138,296 L144,296 L144,314 L138,314 Z"/>
  <path d="M104,320 L130,320 L120,310 Z"/>
  <path d="M132,320 L158,320 L142,310 Z"/>
</g>"""


SILHOUETTES = [
    ("S1", "Tall host, 3 heads", sil_s1_human),
    ("S2", "Crested bird, 2.75 heads", sil_s2_crested_bird),
    ("S3", "Low mole, 2 heads", sil_s3_mole),
    ("S4", "Compact bird, 2.5 heads", sil_s4_compact_bird),
    ("S5", "Chair instrument, 2 heads", sil_s5_chair),
]


def sheet_silhouettes() -> None:
    """Pass 3, sheet A: five alternatives at construction scale with labels."""
    cols = len(SILHOUETTES)
    width = 40 + cols * (W + 20)
    body = [text(40, 40, "Pass 3 / Silhouette alternatives for the organizer. Three-quarter view, no props.", 18, weight="bold")]
    for i, (key, label, fn) in enumerate(SILHOUETTES):
        x = 40 + i * (W + 20)
        body.append(f'<g transform="translate({x},60)">')
        body.append(f'<rect width="{W}" height="{HGT}" fill="none" stroke="{CREAM_DARK}"/>')
        body.append(fn())
        body.append(f"</g>")
        body.append(text(x + W / 2, 60 + HGT + 24, f"{key}  {label}", 14, anchor="middle", weight="bold"))
    write("03-silhouettes-a-alternatives.svg", svg(width, 60 + HGT + 50, "\n".join(body)))


def sheet_silhouette_sizes() -> None:
    """Pass 3, sheet B: every alternative at real interface heights.

    Heights in CSS px at 1x: 24 (list avatar), 40 (mobile card), 64 (mobile scene),
    120 (desktop scene), 200 (result panel). The sheet is rendered at 1x so the
    pixels are the pixels the interface would show.
    """
    sizes = [24, 40, 64, 120, 200]
    row_h = 230
    width = 120 + sum(s * (W / HGT) + 30 for s in sizes) + 40
    body = [text(20, 30, "Pass 3 / Recognition at interface heights (CSS px at 1x)", 16, weight="bold")]
    body.append(text(20, 48, "Read left to right: 24, 40, 64, 120, 200 px tall.", 11))
    for r, (key, label, fn) in enumerate(SILHOUETTES + [("LP", "Loupe companion (existing)", sil_loupe)]):
        y0 = 70 + r * row_h
        body.append(text(20, y0 + 110, key, 14, weight="bold"))
        body.append(text(20, y0 + 126, label, 9))
        x = 120
        for s in sizes:
            k = s / HGT
            body.append(f'<g transform="translate({x},{y0 + 210 - s}) scale({k})">{fn()}</g>')
            x += s * (W / HGT) + 30
    write("03-silhouettes-b-sizes.svg", svg(int(width), 70 + 6 * row_h, "\n".join(body)))


def sheet_silhouette_lineup() -> None:
    """Pass 3, sheet C: the whole lineup at 32 px, the harshest common case."""
    s = 32
    k = s / HGT
    body = [text(16, 24, "Pass 3 / Lineup at 32 px. Can you tell them apart with no color and no props?", 12, weight="bold")]
    x = 16
    for key, _label, fn in SILHOUETTES + [("LP", "", sil_loupe)]:
        body.append(f'<g transform="translate({x},{40}) scale({k})">{fn()}</g>')
        body.append(text(x + s * W / HGT / 2, 40 + s + 12, key, 9, anchor="middle"))
        x += s * (W / HGT) + 12
    write("03-silhouettes-c-lineup32.svg", svg(int(max(x + 8, 300)), 40 + s + 24, "\n".join(body)))


