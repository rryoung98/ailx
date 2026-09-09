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

---

## Review findings (PR #69)

Four findings from an adversarial review of this branch, each closed with a failing baseline
first and one commit of its own.

### 1. The `dailyChallenge` focus test could skip itself — `d4959f5`

**Baseline.** The test wrapped its whole body in `if (img !== null)`. Inverting that condition
to `if (img === null)` — the body then runs never — left the suite GREEN:
`Test Files 1 passed (1) · Tests 1 passed | 40 skipped (41)`. A test that can silently not run
proves nothing.

**Fix.** The deck is dealt deterministically from the fixture day, so the test now finds the
first card whose `material.kind === "image"`, plays the round forward to it, ASSERTS the card
type and that an `<img>` is present, and only then breaks the picture. No branch remains.
Reverting `recoverFocus()` in `DailyChallenge.commit()` now fails it:
`AssertionError: expected false to be true` at `dailyChallenge.test.tsx:732`.

**Adjacent path checked.** The sibling test in the same describe ("after a call and after Next
card") drives `deck[0].options[0]` unconditionally — not vacuous. Both TEN-223 tests in
`practiceDrill.test.tsx` are unconditional too. `practiceDrill.test.tsx:226-231` does carry
conditional `expect`s (`if (first.credit.model)`), but they are pre-existing, outside this PR's
diff, and guard a credit-leak assertion whose condition is a property of the corpus; left
alone rather than widened silently.

### 2. `useFocusRecovery` could no-op on a disabled control — `8d9822e`

**Baseline.** New `apps/web/test/useFocusRecovery.test.tsx` (5 cases). Three failed against the
branch as it stood:

```
× skips a disabled button and takes the first enabled one
  → expected 'swapSending…Another round' to be 'Another round'   (activeElement was <body>)
× takes a link when the only button is disabled
  → expected 'BODY' to be 'A'
× falls back to a focusable stage when the stage holds no control
  → expected <body>…</body> to be <div tabindex="-1">…</div>
```

The first is the reachable case named in review: `focus()` on the retry button while it reads
"Sending…" does nothing at all, which is the same outcome as never calling the hook.

**Fix.** The hook now takes the first ENABLED focusable element, in two passes: a CONTROL
(`button, input, select, textarea`) first, then anything else focus() can land on
(`a[href], [tabindex]`), then the stage itself when it carries `tabindex`. The two passes are
not decoration — the feedback panel puts the picture's CREDIT LINK ahead of "Next card" in
document order, and a single document-order pass moved focus to a source link, failing the
existing guard with `expected 'A' to be 'BUTTON'`. `isFocusable` rejects `disabled`, `hidden`
and `aria-hidden="true"`. `recoverFocus` is now `useCallback`-stable so a caller may list it in
a dependency array (finding 3 needs that).

**Adjacent path checked.** Every other `.focus()` in `apps/web`: `app/exam/page.tsx:281-282`
(`resumeRef`, `pauseBtnRef`) and the three `headingRef` calls all point at a NAMED element, not
at a query, and none of those elements ever carries `disabled` — the Resume button only exists
while paused. No other `querySelector("button")` focus path exists outside tests.

### 3. TEN-223's own defect was still present in `PracticeDrill` — `48fde38`

**Baseline.** Two new tests failed on the branch, both with
`AssertionError: expected <body>… not to be <body>…` — focus was literally on `<body>`:

```
× does not drop focus on <body> when 'Another round' re-deals          practiceDrill.test.tsx:495
× does not drop focus on <body> when 'Try again' re-deals after a failed deal        :511
```

A third test then pins the step the first pass could not see: with the deal held in flight
(`fetch` that never settles), the drill shows only "Dealing a round…", and against the old
markup that also failed — `expected <body><div><p …></p></div></body> not to be` itself.

**Fix.** `deal()` takes `resumeFocus`, true only when a PERSON asked: it calls `recoverFocus()`
before the round is torn down, and again after the deal has landed, because the loading line is
itself replaced. The loading branch is now a stage with `ref={stageRef} tabIndex={-1}` — it
holds no control, which is why finding 2's stage fallback exists — and the error branch got the
missing `ref` so "Try again" is a real landing place.

**Every re-deal / remount path in `PracticeDrill.tsx`, and what was found on each:**

| path | finding |
|---|---|
| mount effect `void deal()` | correct as-is: nobody pressed anything and the drill is embedded in the landing hero, so taking focus would be a defect of its own. Now PINNED by "takes no focus at all on the first deal" |
| the same effect re-firing when `recorded` flips (a sign-in in another tab) | same rule, same verdict: not user-initiated, takes no focus. Guarded by `roundBegun` besides |
| "Another round" (`done` → `loading` → `card`) | **BROKEN — the reported bug. Fixed.** |
| "Try again" (`error` → `loading` → `card`) | **BROKEN — the same shape, not reported. Fixed.** |
| `answer()` (`card` → `feedback`) | already correct |
| `next()` (`feedback` → next card) | already correct |
| `drop()` (skip an unloadable card) | already correct |
| `retryStimulus()` (remounts the `<img>` by `key`) | already correct; the stage itself is not replaced |
| `advance()` reaching `done` | not the hook's job: the phase effect focuses the `<h2 tabIndex={-1}>`. Effect order keeps it that way — the hook's effect is declared first, the heading's second, so the heading wins |
| "Try sending it again" (submit retry, `done` stage) | NOT a remount: the element stays mounted and is `disabled` while sending. A browser blurs a focused control when it is disabled, so focus is dropped there too — but the repair is a UX decision, not a mechanical one (moving focus to "Another round" mid-send invites a keypress that discards the round), so it is REPORTED here rather than changed under a review fix. Finding 2's fix at least means no recovery ever targets it |

### 4. The TEN-222 test pinned the keyframe, not the property — `4940e87`

**Baseline.** Deleting `both` from `animation: heroFadeOut linear both` and
`animation: heroSettle linear both` in `globals.css` left `scrollCinema.test.tsx` GREEN:
`Test Files 1 passed (1) · Tests 21 passed (21)`. The existing pair could not see it: one reads
the keyframe text, the other APPLIES the final stop by hand.

**Fix.** A new case reads the fill mode off every rule that RUNS each animation — shorthand, or
an `animation-fill-mode` longhand overriding it in the same block — and requires `both`, plus
`animation-timeline: --hero-scrub` on the same block so "the range is over" is a state the page
really sits in. With `both` deleted it now fails:
`AssertionError: heroFadeOut fill mode: expected 'animation: heroFadeOut linear;' to match /\bboth\b/`.

**Adjacent path checked.** The other three hero-scrub rules — `heroLineOut`, `heroPhaseB` and
the pinned wrapper — all declare `both` already. Only the two whose final stop carries
`visibility: hidden` are pinned, because they are the only ones where the fill mode carries an
accessibility behaviour rather than a visual one.

### Gate

`bash .agent-work/gates.sh e2` → **GREEN** (log: `.agent-work/gate-e2.log`)

```
=== static export build
=== hosted build (AILX_BACKEND=1)
=== test        Test Files  238 passed (238)   Tests  3375 passed | 4 skipped (3379)
=== lint
GATES: GREEN (e2)
```

No guard was loosened. `frontendOnly`, `bundleSecrecy` and `public-tree` are untouched.
