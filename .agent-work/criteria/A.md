# Batch A — FROZEN acceptance criteria (written before implementation; a worker may NOT edit this file)

## TEN-207 — [P0] A failed runner chunk import silently swaps a demo placeholder into a real scored track

The exam page refuses to mount a `placeholder: true` module for a real attempt and shows the deck-error panel with a retry (`page.tsx:989`), plus a test that makes `loadTrackModule` fail and asserts no placeholder is mounted on a scored track.

## TEN-211 — [P1] Start has no timeout and no pending state, so a hung POST /attempts leaves a dead Start button

The create is wrapped in `withTimeout` (the copy already exists, `startFailureCopy` at `page.tsx:103`), the pill renders a pending state, and a fake-timer test asserts the failure copy appears after the bound.

## TEN-219 — [P1] Checkpoint write failures are swallowed, and the timeout watchdog then scores the stale checkpoint

`saveCheckpoint` reports failure to the host, the host raises the persistence banner or holds the clock, and a test asserts a failed checkpoint write is visible.

## TEN-224 — [P1] Exam phase changes never move focus to the new view while the clock runs

Each phase view owns a `tabIndex={-1}` heading focused on entry, like `TimeUpNotice`, with a test per transition asserting `document.activeElement` is the new heading.

## TEN-232 — [P2] Time with the browser closed or asleep is charged to the track budget, while the copy says only working time is charged

The page records a `paused` entry on `pagehide` and the resume path decides explicitly what an unattended gap costs, with a test.

## TEN-116 — A hosted deck fetch that hangs or fails burns the whole track budget and reports the zero as "you were working"

(NONE STATED — coordinator must write one)

## TEN-118 — The stale-build guard in the exam start gate is dead code

(NONE STATED — coordinator must write one)

## TEN-127 — Only the LAST failed track can be retried — T2 stays unscored forever

(NONE STATED — coordinator must write one)

## TEN-115 — Pause during T2 destroys the item on screen and scores it as a miss

(NONE STATED — coordinator must write one)
