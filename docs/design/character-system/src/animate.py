#!/usr/bin/env python3
"""Pass 9: write the animation and runtime test page.

Outputs:
  svg/organizer-rig.svg        the rigged figure, standalone
  animation-test.html          idle, greeting, thinking, correction, transition,
                               reduced-motion cuts and a static fallback

Open animation-test.html in a browser. No build step, no dependencies.
"""

from __future__ import annotations

import gzip
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from build import HGT, W, write  # noqa: E402
from otter import OTTER, threequarter as otter_threequarter  # noqa: E402
from palette import GREEN, INK, PAPER, WOOD, WOOD_DARK  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def rig_svg() -> str:
    body = otter_threequarter(OTTER, ids=True)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {HGT}" width="{W}" height="{HGT}" '
        f'class="rig" role="img" aria-label="The organizer, a round brown sea otter in a scarf and apron">\n{body}\n</svg>'
    )


CSS = f"""
:root {{ color-scheme: light; }}
body {{ margin: 0; padding: 24px 16px; font: 14px/1.4 system-ui, sans-serif; background: {PAPER}; color: {INK}; }}
h1 {{ font-size: 18px; margin: 0 0 4px; }}
p {{ max-width: 60ch; }}
.stage {{ display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-end; }}
.wall {{ position: relative; width: min(100%, 520px); aspect-ratio: 52 / 34; background: {GREEN}; overflow: hidden; }}
.wall::after {{ content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 18%; background: {WOOD}; border-top: 4px solid {WOOD_DARK}; }}
.wall svg {{ position: absolute; bottom: 4%; left: 8%; height: 92%; width: auto; z-index: 1; }}
.small {{ display: flex; gap: 12px; align-items: flex-end; }}
.small svg {{ height: 64px; width: auto; }}
.small .wall {{ width: 120px; }}
.controls {{ display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }}
button {{ font: inherit; padding: 8px 12px; border: 1.5px solid {INK}; background: {PAPER}; color: {INK}; border-radius: 6px; cursor: pointer; }}
button[aria-pressed="true"] {{ background: {INK}; color: {PAPER}; }}
button:focus-visible {{ outline: 3px solid {WOOD}; outline-offset: 2px; }}
table {{ border-collapse: collapse; margin-top: 12px; }}
td, th {{ text-align: left; padding: 4px 12px 4px 0; border-bottom: 1px solid {WOOD_DARK}33; }}
.static {{ display: none; }}

/* Every rig part transforms about its own local origin. */
.rig [class^="rig-"] {{ transform-box: view-box; transform-origin: 0px 0px; }}
.rig .rig-body {{ transform-origin: 132px 300px; }}
.rig .rig-upper {{ transform-origin: 132px 296px; }}
.rig .rig-blink {{ transform-origin: 0px -46px; transform: scaleY(0); }}

/* idle: breathing and a blink every few seconds */
.rig.idle .rig-body {{ animation: breathe 3.2s ease-in-out infinite; }}
.rig.idle .rig-head {{ animation: idle-head 3.2s ease-in-out infinite; }}
.rig.idle .rig-blink {{ animation: blink 4.5s linear infinite; }}
@keyframes breathe {{ 0%, 100% {{ transform: scale(1, 1); }} 50% {{ transform: scale(1.012, 0.985); }} }}
@keyframes idle-head {{ 0%, 100% {{ transform: rotate(0deg); }} 50% {{ transform: rotate(1.5deg) translateY(1px); }} }}
@keyframes blink {{ 0%, 92%, 100% {{ transform: scaleY(0); }} 94%, 98% {{ transform: scaleY(1); }} }}

/* greeting: near wing up and down once, a small nod */
.rig.greeting .rig-near-wing {{ animation: wave 1.1s ease-in-out 1; }}
.rig.greeting .rig-head {{ animation: nod 1.1s ease-in-out 1; }}
@keyframes wave {{ 0% {{ transform: rotate(0); }} 35% {{ transform: rotate(-115deg); }} 55% {{ transform: rotate(-100deg); }} 75% {{ transform: rotate(-115deg); }} 100% {{ transform: rotate(0); }} }}
@keyframes nod {{ 0%, 100% {{ transform: rotate(0); }} 40% {{ transform: rotate(6deg); }} }}

/* thinking: wing to the beak, head tilts up, held */
.rig.thinking .rig-near-wing {{ transform: rotate(-160deg); transition: transform .5s ease-out; }}
.rig.thinking .rig-head {{ transform: rotate(-7deg); transition: transform .5s ease-out; }}
.rig.thinking .rig-blink {{ transform: scaleY(.45); transform-origin: 0px -58px; transition: transform .4s; }}

/* correction: stop, look at the plan, act. Neutral about right or wrong. */
.rig.correction .rig-upper {{ animation: pause-then-act 2.2s ease-in-out 1 forwards; }}
.rig.correction .rig-head {{ animation: look-down 2.2s ease-in-out 1 forwards; }}
.rig.correction .rig-near-wing {{ animation: reach 2.2s ease-in-out 1 forwards; }}
@keyframes pause-then-act {{ 0%, 30% {{ transform: rotate(0); }} 55%, 100% {{ transform: rotate(-4deg); }} }}
@keyframes look-down {{ 0%, 30% {{ transform: rotate(0); }} 50%, 80% {{ transform: rotate(16deg); }} 100% {{ transform: rotate(4deg); }} }}
@keyframes reach {{ 0%, 30% {{ transform: rotate(0); }} 55%, 100% {{ transform: rotate(-60deg); }} }}

/* transition: lean and step off toward the activity */
.rig.transition {{ animation: step-off 1.2s ease-in 1 forwards; }}
.rig.transition .rig-upper {{ animation: lean-in 1.2s ease-in 1 forwards; }}
@keyframes step-off {{ 0% {{ transform: translateX(0); opacity: 1; }} 100% {{ transform: translateX(60%); opacity: 0; }} }}
@keyframes lean-in {{ 0% {{ transform: rotate(0); }} 100% {{ transform: rotate(-10deg); }} }}

/* Reduced motion: no animation, no transition. States become cuts to their end pose. */
@media (prefers-reduced-motion: reduce) {{
  .rig *, .rig {{ animation: none !important; transition: none !important; }}
  .rig.greeting .rig-near-wing {{ transform: rotate(-110deg); }}
  .rig.correction .rig-head {{ transform: rotate(16deg); }}
  .rig.correction .rig-near-wing {{ transform: rotate(-60deg); }}
  .rig.transition {{ opacity: .35; }}
}}
body.force-reduced .rig *, body.force-reduced .rig {{ animation: none !important; transition: none !important; }}
body.force-reduced .rig.greeting .rig-near-wing {{ transform: rotate(-110deg); }}
body.force-reduced .rig.correction .rig-head {{ transform: rotate(16deg); }}
body.force-reduced .rig.correction .rig-near-wing {{ transform: rotate(-60deg); }}
body.force-reduced .rig.transition {{ opacity: .35; }}
body.show-static .rig {{ display: none; }}
body.show-static .static {{ display: block; position: absolute; bottom: 4%; left: 8%; height: 92%; width: auto; }}
"""

JS = """
const rigs = Array.from(document.querySelectorAll('svg.rig'));
const states = ['idle', 'greeting', 'thinking', 'correction', 'transition'];
const buttons = Array.from(document.querySelectorAll('[data-state]'));
function setState(s) {
  rigs.forEach(r => { states.forEach(x => r.classList.remove(x)); void r.getBoundingClientRect(); r.classList.add(s); });
  buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.state === s)));
  document.getElementById('live').textContent = 'State: ' + s;
}
buttons.forEach(b => b.addEventListener('click', () => setState(b.dataset.state)));
document.getElementById('reduced').addEventListener('change', e => document.body.classList.toggle('force-reduced', e.target.checked));
document.getElementById('static').addEventListener('change', e => document.body.classList.toggle('show-static', e.target.checked));
setState('idle');
// one-off states return to idle when they finish
rigs[0].addEventListener('animationend', e => {
  if (['wave', 'pause-then-act', 'step-off'].includes(e.animationName)) setTimeout(() => setState('idle'), 400);
});
// rough frame-time sample while idle: a budget check, not a benchmark
let frames = 0, start = performance.now();
function tick(t) { frames++; if (t - start < 3000) requestAnimationFrame(tick); else {
  document.getElementById('fps').textContent = (frames / ((t - start) / 1000)).toFixed(0) + ' frames per second over 3 s, ' + rigs.length + ' rigs';
} }
requestAnimationFrame(tick);
document.getElementById('nodes').textContent = rigs[0].querySelectorAll('*').length + ' elements in one rig';
"""


def static_svg() -> str:
    """The neutral pose without rig groups. The static fallback renders from this."""
    body = otter_threequarter(OTTER)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {HGT}" width="{W}" height="{HGT}">\n{body}\n</svg>'
    )


def main() -> None:
    rig = rig_svg()
    write("organizer-rig.svg", rig + "\n")
    write("organizer-static.svg", static_svg() + "\n")
    raw = len(rig.encode("utf-8"))
    gz = len(gzip.compress(rig.encode("utf-8")))
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Organizer rig test</title>
<style>{CSS}</style>
</head>
<body>
<h1>Pass 9 / Animation and runtime test</h1>
<p>One inline SVG, transformed by CSS. Idle runs on its own. The other four are triggered here and by the interface later. Correction is a pause, then a look at the plan, then action. It never signals right or wrong.</p>
<div class="controls" role="group" aria-label="Rig state">
  <button type="button" data-state="idle" aria-pressed="true">Idle</button>
  <button type="button" data-state="greeting" aria-pressed="false">Greeting</button>
  <button type="button" data-state="thinking" aria-pressed="false">Thinking</button>
  <button type="button" data-state="correction" aria-pressed="false">Correction</button>
  <button type="button" data-state="transition" aria-pressed="false">Transition into activity</button>
  <label><input type="checkbox" id="reduced"> Force reduced motion</label>
  <label><input type="checkbox" id="static"> Static fallback</label>
</div>
<p id="live" aria-live="polite">State: idle</p>
<div class="stage">
  <div class="wall">{rig}<img class="static" src="png/organizer-static.png" alt="The organizer, standing still" width="{W}" height="{HGT}"></div>
  <div class="small"><div class="wall">{rig}<img class="static" src="png/organizer-static.png" alt="" width="{W}" height="{HGT}"></div><p>64 px, the mobile scene size</p></div>
</div>
<table>
<tr><th>Budget</th><th>Measured</th><th>Limit proposed</th></tr>
<tr><td>Rig SVG bytes</td><td>{raw} raw, {gz} gzip</td><td>12 000 gzip per character</td></tr>
<tr><td>Elements per rig</td><td id="nodes"></td><td>120</td></tr>
<tr><td>Idle frame rate</td><td id="fps">measuring</td><td>60, and no layout work per frame</td></tr>
<tr><td>Animated properties</td><td>transform and opacity only</td><td>never width, height, d or filter</td></tr>
<tr><td>Concurrent idle rigs on one screen</td><td>2 on this page</td><td>4 in the square, 1 at the table</td></tr>
</table>
<p>Reduced motion turns every state into a cut to its end pose. The static fallback is a PNG of the neutral pose. Nothing here touches a scored input: the character reacts to the plan, not to the answer.</p>
<script>{JS}</script>
</body>
</html>
"""
    with open(os.path.join(ROOT, "animation-test.html"), "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"wrote animation-test.html  rig={raw} bytes raw, {gz} gzip")


if __name__ == "__main__":
    main()
