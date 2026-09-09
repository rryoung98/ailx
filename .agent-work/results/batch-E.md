# Batch E — results

Worktree `/Users/rickyyoung/GitHub/ailx.worktrees/rl-e`, branch `rl/batch-e`, from main.
Every fix got a failing test FIRST; the baseline text below was taken on the unmodified code.

---

## TEN-222 — hero fade leaves its drill and both CTAs clickable and focusable

**verdict: FIXED** — commit `57b2df7`

Baseline (test written first, run against unmodified `globals.css`):

```
FAIL apps/web/test/scrollCinema.test.tsx > hero fade leaves nothing clickable behind (TEN-222)
  > heroFadeOut and heroSettle end hidden, not merely transparent
AssertionError: expected 'opacity: 0; transform: translateY(-1.…' to match /visibility:\s*hidden/
+ Received: "opacity: 0; transform: translateY(-1.4rem);"   (scrollCinema.test.tsx:257)

  > the faded drill and both CTAs are unfocusable once the fade has completed
AssertionError: expected 'visible' to be 'hidden' // Object.is equality   (scrollCinema.test.tsx:277)
```

Fix: `@keyframes heroFadeOut` and `@keyframes heroSettle` now carry `visibility: hidden` at
their final stop (`apps/web/app/globals.css:913-921`, `:928-931`). `visibility` interpolates
discretely and stays `visible` until the final stop, so the fade itself looks the same; with
`animation-fill-mode: both` the block is hidden for the rest of the pin, which removes it from
hit testing and from the tab order.

Now covered by `apps/web/test/scrollCinema.test.tsx:243` (describe), assertions at `:257` and
`:277`. The second test plays the fade to its end by applying the keyframe's OWN final
declarations to the `.hero-fade` blocks, then asserts computed `visibility` on the two CTAs and
the drill buttons. Note honestly: jsdom's `focus()` implements no rendering check (probed — it
focuses a `visibility: hidden` link), so the test asserts the spec condition that makes an
element not a focusable area, not `document.activeElement`.

---

## TEN-223 — answering a practice card or a daily card drops focus onto `<body>`

**verdict: FIXED** — commit `804e4eb`

Baseline:

```
FAIL apps/web/test/practiceDrill.test.tsx > does not drop focus on <body> when the answered card is unmounted
AssertionError: expected false to be true   (stage.contains(document.activeElement))

FAIL apps/web/test/dailyChallenge.test.tsx > focus never falls to <body> mid-round (TEN-223)
  > keeps focus in the stage after a call and after Next card
AssertionError: expected false to be true   (dailyChallenge.test.tsx:705)
  > keeps focus in the stage when a card with no picture is skipped
AssertionError: expected false to be true   (dailyChallenge.test.tsx:718)
```

Fix: the recovery the practice drill already had for `drop()` and `retryStimulus()` is now a
shared hook, `apps/web/lib/useFocusRecovery.ts` (two call sites already existed, so it is not a
speculative abstraction; `lib/README.md` names it). `PracticeDrill.answer()` and
`PracticeDrill.next()` call `recoverFocus()`. `DailyChallenge` gained the same: `call()` and
`commit()` recover focus while the round continues — a FINISHED round keeps its existing
heading move (`justFinished`), so the two never fight. The daily's playing stage now carries the
`stageRef`. The daily "Skip this card" path was silently broken the same way and is fixed by
the same change.

Covered by `apps/web/test/practiceDrill.test.tsx:472-482` and
`apps/web/test/dailyChallenge.test.tsx:698-722`.

---

## TEN-231 — T2 exposure counted in interval ticks

**verdict: FIXED** — commit `3143e6a`

Baseline (new test, unmodified `Runner.tsx`):

```
FAIL packages/tracks/t2-discrimination/test/exposureWallClock.test.tsx
  > lapses on the first tick after the window has really passed
AssertionError: expected [] to have a length of 1 but got +0   (:94)
  > does not lapse early: ticks alone never outrun the wall clock
AssertionError: expected [ { verb: 'responded', …(4) } ] to have a length of +0 but got 1   (:107)
```

Fix: `packages/tracks/t2-discrimination/src/Runner.tsx` keeps an `exposureClock` ref
(`{ consumed, at }`). The 1 s interval now only SAMPLES `performance.now()`: it adds the real
elapsed milliseconds when the clock is running and sets `secondsLeft` from
`exposure - consumed / 1000`. It adds nothing while the confidence sheet is open or the host has
paused the track, so both existing pause rules (TEN-115) still hold, and `shownAt` — the
decision-latency anchor — is untouched.

Two existing test files, `exposureLapse.test.tsx` and `exposureAnchor.test.tsx`, had to fake
`performance` as well as the timers (`toFake: [..., "performance"]`, the spelling
`swipedeck.test.tsx` already used). Vitest's default fake clock does NOT move
`performance.now()`, so their clock moved timers while wall time stood still. That change makes
those tests measure real elapsed time; it weakens no assertion — all five assertions in each
file are unchanged and still pass.

Covered by `packages/tracks/t2-discrimination/test/exposureWallClock.test.tsx:86` and `:100`.
The first test advances wall clock with NO timer tick, then allows exactly one tick — what a
throttled background tab gets.

---

## Guard tests

`packages/core/test/frontendOnly.test.ts`, `apps/web/test/bundleSecrecy.test.ts` and
`packages/content-tools/test/public-tree.test.ts` are untouched.

## Gate

`bash .agent-work/gates.sh e` → **GREEN** (log: `.agent-work/gate-e.log`)

```
=== static export build
=== hosted build (AILX_BACKEND=1)
=== test        Test Files  237 passed (237)   Tests  3365 passed | 4 skipped (3369)
=== lint
GATES: GREEN (e)
```

Out of scope, declared not skipped: Playwright e2e is not part of this gate (it needs a private
exam service), so the browser-level proof that a faded CTA is untabbable is not run here.
