# Batch E — FROZEN acceptance criteria (written before implementation; a worker may NOT edit this file)

## TEN-222 — [P1] The landing hero fades its drill and both CTAs to opacity 0 but leaves them clickable and in the tab order

The fade keyframes carry `visibility: hidden` at the final stop, or the block is `inert`, and a test asserts a `.hero-fade` control is not focusable once the fade has completed.

## TEN-223 — [P1] Answering a practice card or a daily card drops focus onto <body>

`answer()` and `next()` use the same focus recovery as `drop()`, and the practice and daily tests assert `document.activeElement` stays inside the stage after a call and after Next card.

## TEN-231 — [P2] T2's fixed exposure window is counted in interval ticks, so a background tab stretches it in wall-clock time

Remaining exposure is derived from `performance.now()` deltas, with a test that advances time without advancing timers.
