# Batch B — FROZEN acceptance criteria (written before implementation; a worker may NOT edit this file)

## TEN-212 — [P1] A model call cannot time out or be cancelled, so a hung request burns the track clock behind a disabled button

Model requests carry a timeout and a cancel control, a stall renders an explicit `the model did not answer` state, and a test with a never-settling fetch asserts the track is not silently burned.

## TEN-213 — [P1] The server-rendered share, verify and card reads have no timeout, so a slow exam service becomes a platform 504

All three server reads carry an explicit `AbortSignal.timeout` inside the platform function limit, and a test with a never-settling fetch asserts the not-found metadata or 404 card returns within the budget.

## TEN-214 — [P1] An identity that never resolves has no bound, so every service page loads for ever with no error

`pending` gets a deadline, after which the store publishes anonymous or asserted and the pages ask with what the browser has. A test mounts /report with Clerk enabled, never calls `publishIdentity`, and asserts a rendered sentence and a control instead of a spinner.

## TEN-216 — [P1] Only /gallery validates its response body, so a 200 with an unknown shape crashes /progress, /world and /s/<token>

`progress`, `aggregates`, `shareView` and `credentialView` have schemas, the four call sites pass them, and each page has a test that feeds a 200 with a missing key and asserts `SERVICE_INVALID_COPY` instead of a throw.

## TEN-217 — [P1] finishConnect casts an unvalidated 200 body, so a successful model connection can be shown as not connected

`finishConnect` routes the body through `readStatusBody`, and a test asserts a 200 with `{}` becomes a refusal message, not a silent disconnect.

## TEN-218 — [P1] A hung mirror POST blocks flush() for ever, so the T1 site upload never starts

`flush()` is bounded, or the upload does not await it unboundedly, and a test with a never-settling fetch asserts a visible error with a retry.

## TEN-229 — [P2] A 200 that is not JSON tells the reader their own connection is broken

The HTML-on-200 test asserts `SERVICE_INVALID_COPY`.

## TEN-230 — [P2] created.attempt is read with no shape check, so a 200 with an unknown body shows a raw TypeError to the candidate

A shape check yields a typed failure, with a test that uses `{}` as the create body.

## TEN-123 — Nothing wires onSyncError - a hosted sitting can fail to mirror for its whole duration, silently

(NONE STATED — coordinator must write one)

## TEN-124 — One SaveConflictError poisons persistence for the rest of the sitting

(NONE STATED — coordinator must write one)

## TEN-122 — Hosted T3 transcript turns are fire-and-forget; one failed POST silently drops a scored stance

(NONE STATED — coordinator must write one)

## TEN-220 — [P1] A stored log that fails to replay from entry 0 returns null, so the candidate silently starts over with no notice

A fully dropped log produces the same visible notice as a partial truncation (a distinct return, not null), with a test that feeds a log whose first entry is unreplayable and asserts a notice rather than a silent fresh start.
