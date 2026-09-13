# Pass 9 / Animation and runtime tests

Author: AI in the role of animator.
Reviewer: AI in the role of technical artist, in a separate step. Not human professional review.

Open `animation-test.html` in a browser. It has no dependencies and no build step.

## States

| State | What moves | Duration | Returns to idle |
|---|---|---|---|
| idle | body breathes 1.5 %, head sways 1.5 degrees, blink every 4.5 s | loops | yes |
| greeting | near wing up to 115 degrees and back, small nod | 1.1 s | yes |
| thinking | near wing to the beak, head up 7 degrees, lids to 45 % | held | on next state |
| correction | pause for 0.7 s, look down 16 degrees, wing reaches 60 degrees, settle | 2.2 s | yes |
| transition | lean 10 degrees and step off to the right, fade | 1.2 s | yes |

Correction is a pause, then a look at the plan, then action. It carries no information
about whether the visitor's choice matched the key. The animator tried a wince and a nod
and rejected both. The reviewer checked the keyframes for any upward or downward beat that
could be read as approval. There is none.

## Measurements

Taken in Chrome on a laptop on 2026-09-12. A budget check, not a benchmark.

| Budget | Measured | Proposed limit |
|---|---|---|
| rig SVG | 3 626 bytes raw, 1 008 gzip | 12 000 gzip per character |
| elements per rig | 43 | 120 |
| idle frame rate, two rigs | 58 to 60 frames per second over 3 s | 60, no layout per frame |
| animated properties | transform and opacity only | never width, height, path data or filter |
| concurrent idle rigs | 2 on the test page | 4 in the square, 1 at the table |

## Mobile legibility

The test page shows the same rig at 64 px beside the large one. Idle and greeting read.
Thinking reads as a wing near the head. Correction reads as a head drop. Transition reads.
The blink does not read at 64 px and costs nothing, so it stays.

## Reduced motion

With `prefers-reduced-motion: reduce`, every animation and transition is removed. A
state becomes a cut to its end pose. The page has a checkbox to force this for testing.

Finding: the greeting end pose was first set to 140 degrees. That placed the wing at the
beak and looked like thinking. It is now 110 degrees, wing raised outward. The motion
version was lowered to match.

## Static fallback

`png/organizer-static.png` is the neutral pose rendered on the wall color. The page has a
checkbox that swaps the rig for it. The interface uses the same swap when scripting is
unavailable or when a decorative asset fails to load. A decorative asset must never block
starting an activity.

## Guardrails carried from the product docs

- Character motion belongs to the playful surface. It never appears in a scored input and
  never reacts to the scoring key.
- The camera stays still during decisions. The character moves, the frame does not.
- Every state has a keyboard path on the test page and must have one in the interface.
- The page announces the current state to assistive technology through a live region.

## Reviewer notes

Accepted with two limits recorded. First, the frame rate figure was measured with two rigs
on an otherwise empty page. A scene with scenery needs its own measurement. Second, the
blink and the breathing run forever. The interface must pause them when the tab is
hidden or when the character is off screen.
