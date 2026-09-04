# AILX data-logging audit (2026.1)

This forensic audit covers the data path from Runner UI → session log → score → report → export.
It covers `apps/web/**` and `packages/session/**`, plus read-only inspection of the
track packages. Branch `polish/audit-logging` closes every gap found here and
adds a regression test for each one.

## 1. The data path

Each attempt has one append-only event log in `packages/session/src/machine.ts`.
`packages/session/src/persist.ts` stores it in `localStorage` under
`ailx:attempt:v1`. The log projects into state through a pure function.

| Stage | Mechanism | File |
|---|---|---|
| Runner emission | `props.onEvent(TrackEvent)` | `packages/tracks/*/src/Runner.tsx` |
| Persistence | exam page `onEvent` → `append()` → `saveAttempt()` | `apps/web/app/exam/page.tsx` |
| In-progress state | `onCheckpoint(state)` → `ailx:checkpoint:<attemptId>:<trackId>` | `apps/web/lib/data/checkpoints.ts` |
| Completion | `track_completed` (artifact) + `track_scored` (score, judgments, rubricVersion, scoringDigest, modelManifest) | `apps/web/app/exam/page.tsx`, `apps/web/lib/instrument/registry.ts` |
| Report | projection of the log; verbatim Event log section | `apps/web/app/report/page.tsx` |
| Export | individual tier (own data) + research tier (allowlist) | `apps/web/lib/exportTiers.ts` |

At append time, the machine enforces legal phase transitions and the fixed T1→T4 order.
It requires nondecreasing timestamps. It rejects `track_event` after budget exhaustion.
Budget accounting derives `timedOut`; the machine never trusts the caller's value.

## 2. What IS captured, per track (vs the spec's measurement design)

**T2 — discrimination.** Each item emits a `responded` event with `{itemId, choice,
confidence, latencyMs}`, the item index, and the item type. Lapses are recorded
verbatim as `choice: -1, confidence: 0` (zero calibration credit — F7 fix upstream).
The deck effect sets `shownAt.current = performance.now()` when it renders an item.
This anchors `latencyMs` at ITEM RENDER. It measures response latency from stimulus
onset, not from deck or track start. The instrument config supplies the exposure
shown through `exposureSeconds` per item (F3 fix upstream). The artifact's
`responses[]` contains the same rows as the events — 1:1, tested.

**T1 — creative build.** The log records every assist prompt as `prompted`, with
`result.modelId` + `context.prompt`. It records every apply/reject and manual edit
cycle as `revised`, every preview run as `verified`, and completion as `submitted`.
The artifact's `promptLog` matches the events and includes `clientTs` and `modelId`
for each entry.

**T3 — reasoning.** The log preserves full turn order. Every turn has a runner-side
monotone `seq`. It stores `revision_of` chains in `context.revision_of`, `verified`
events for source checks, claim stances (`challenged` / `accepted`) with
timestamps, and the assistant id in context. The artifact transcript matches the
event stream.

**T4 — generative.** The log records every draft as `prompted` / `regenerated`,
with the prompt + `modelId`. It records every promotion to a final image/video as
`promoted`, with `fromDraftIndex` and the remaining quota. The artifact records
disclosure as `disclosed: boolean` and timestamps each generation.

For scoring provenance, `track_scored` stores the judgment rows consumed by the
scorer. It also stores the snapshot `rubricVersion`, a real `scoringDigest`
(hash of package version + shipped `score()` source), and the model manifest
(F12 fix upstream).

## 3. Findings (what was broken) and fixes

### A1 — Silent event loss while paused  (BLOCKER — fixed)
The F2 fix keeps Runners MOUNTED under the pause veil, so their internal timers
continue to run. A T2 exposure that lapses mid-pause calls `record()` and emits
`responded`. But the exam page's `onEvent` dropped all events when
`phase !== "in_track"`, while the machine rejected `track_event` outside
`in_track`. The response reached the artifact and checkpoint but not the event
log. The artifact and audit trail silently disagreed.

**Fix:** `track_event` is now legal during `paused` for the current track.
Budget accounting still applies, and paused time consumes no budget. The exam
page persists the event. The system still rejects late events after budget
exhaustion by design. That is the documented F13 rule, not silent loss.
**Tests:** `packages/session/test/machine.test.ts` ("paused-phase event
persistence"), and the integration test below.

### A2 — No multi-tab / duplicate-append protection on load  (MAJOR — fixed)
`loadAttempt()` accepted any JSON array shaped like a log. Writes from two tabs
to `ailx:attempt:v1` can interleave. The result can contain duplicated seq, seq
gaps, backwards timestamps, or entries spliced in from a foreign attempt.
`project()` folded all of it without complaint and presented corrupt state as
authoritative.

**Fix:** `validateStoredLog()` replays every stored entry through the SAME
`append()` used by the live session. This re-checks all machine invariants. It
also requires `seq` to be exactly contiguous from 0, which ensures uniqueness +
ordering. The loader returns the longest valid prefix. It truncates and counts
the corrupt tail in `loadAttemptValidated().dropped` instead of silently folding it.
**Tests:** `packages/session/test/persist.test.ts` ("validated load").

### A3 — Checkpoints not bound to their attempt/track  (MAJOR — fixed)
Checkpoint payloads (v1) contained no identity. A multi-tab race, restore tool,
or manual edit could copy a payload under another attempt's or track's key.
The app would then rehydrate work from a foreign attempt. On timeout, it would
SCORE that work as this attempt's partial artifact.

**Fix:** checkpoint shape v2 includes `attemptId` + `trackId`. `loadCheckpoint`
checks both against the requested key. It rejects mismatches and legacy v1
payloads. This fails closed: an absent checkpoint scores as a legitimate missing
response. **Tests:** `apps/web/test/checkpoints.test.ts` ("checkpoint
binding").

### A4 — Research-export `latencyMs` spanned track boundaries  (MINOR — fixed)
`statements[].latencyMs` measured the gap since the previous `track_event` in the
WHOLE log. A track's first event therefore included time spent on the
between-tracks screen, or time after a prior track's last event, as "latency".
That value could mislead downstream analysis.

**Fix:** `latencyMs` now measures time within the SAME track and is null for a
track's first event. **Tests:** `apps/web/test/exports.test.ts`.

### A5 — No audit tally in the research export  (fixed)
Researchers could not verify that the system had kept every emission. **Fix:** the
research tier now includes `eventCounts` per track (`{trackId, total, byVerb}`),
calculated from the persisted log. The rest of the shape is unchanged
(`ailx.research.v2`; additive field). The allowlist still limits the export to
tallies, with no payloads.

### A6 — No user-visible audit trail  (fixed)
The report showed derived narratives but omitted the raw log. **Fix:** `/report`
now has a per-track "Event log" expandable section. It is verbatim and read-only:
`seq · verb · object · t+ since track start · Δ from previous event`.

### A7 — Stale duplicate Runners in the web app  (hygiene — removed)
`apps/web/lib/runners/T{1..4}Runner.tsx` contained dead copies replaced by the
plugin `ui()` loaders (F11). Their event emissions differed from those of the
active runners, which could mislead a future audit. They were deleted because
nothing imported them.

## 4. Regression + reconciliation coverage

- **Integration (zero silent drops):** `apps/web/test/eventflow.test.tsx`
  mounts the REAL T2 Runner under jsdom with fake timers. It connects `onEvent`
  to the exam page's exact persistence semantics. The test confirms that the
  persisted `track_event` count equals the Runner's emission count, including
  a lapse fired mid-pause. It also confirms that every artifact response has a
  matching logged event, 1:1.
- **Latency anchor:** The same test advances fake timers exactly 3 s between item
  render and answer. It then checks `latencyMs ∈ [2900, 3100]`. This proves that
  stimulus onset, not deck/track start, anchors the measurement.
- **Reconciliation (drift fails CI):** `apps/web/test/reconciliation.test.ts`
  runs a scripted full attempt. It uses `JSON.stringify` to check byte-exact
  equality among (a) the live score at completion, (b1) a full-pipeline
  replay from the persisted artifact after a save→load round-trip, (b2)
  `plugin.score()` over the PERSISTED judgment rows alone, and (c) the numbers
  in the research-tier export, including the composite.
- **Multi-tab corruption:** The loader truncates duplicate seq, seq gap,
  backwards ts, and foreign `attempt_started` splices. It reports each one with
  `dropped`.

## 5. Known, documented asymmetries (not bugs)

- The machine rejects events that arrive AFTER budget exhaustion under rule F13.
  A response in the last checkpoint may be too late for the log. On timeout, it
  still contributes to the score through the checkpoint-derived partial artifact.
  The event log shows the rejection boundary. This is the spec's declared budget rule.
- Checkpoints deliberately sit OUTSIDE the session log to keep it lean. The
  authoritative artifact is stored in `track_completed`. Reconciliation proves
  that this artifact reproduces the score.
- `clientTs` in event payloads is the runner's wall clock and is informational.
  The monotonic `ts`/`seq` assigned at append provides authoritative ordering.


## Residual items (Codex re-review, 2026-08-21)
- Fixed: multi-tab CAS (SaveConflictError), duplicate `track_scored` rejection, unknown-entry rejection, validated hydration + visible persistence warnings, honest landing/OG copy, report event-log copy accuracy, disputed item now carries its verified Commons AI category.
- Confirmed false positive: `afc954936e1d…` (Plaza Calderon) IS in Commons "Category:AI-generated images of architecture" (live category query); retained with category evidence embedded.
- Accepted residual: content tests gate id/hash/link-manifest consistency but not live Commons category membership (network-free CI); localStorage quota exhaustion surfaces a warning rather than a durable fallback store; duplicated Commons source files across 3 item pairs deferred to next bank revision.


## Runner faults and the clock (2026-08, exam-integrity fix)

`apps/web/features/exam/RunnerErrorBoundary.tsx` now catches a track Runner that throws.
The route-level `app/error.tsx` / `app/global-error.tsx` also catches these errors.
Before this change, one uncaught render error unmounted the tree. It left the
candidate on a white page while their own clock continued to run.

**Declared timer policy: a fault on OUR side does not consume the candidate's
budget.** When it catches a fault, the exam page appends these entries in order:

1. `track_event` with `verb: "runner_crashed"` — the auditable cause, so a
   later reviewer can see why the attempt has an involuntary pause;
2. `paused` — the track clock stops.

The app appends `resumed` only when the candidate presses "Reload this track and
continue". It never automatically resumes a pause chosen by the candidate before
the crash. The app skips either entry if the machine would reject it. An exhausted
budget legitimately refuses further track events, so recovery cannot itself throw.
The stored log remains authoritative and unchanged. A retry remounts the runner
from its last checkpoint.

**Tests:** `apps/web/test/examCrash.test.tsx` (crash → recovery panel, log
intact, clock frozen across 5 s, retry resumes), `apps/web/test/routeError.test.tsx`.

## Presentation screens and the clock (2026-08, P0 fairness fix)

A dogfood sitting ended while the candidate was reading. The candidate answered
the T2 deck and reached the post-deck REPLAY, the one screen in T2 that teaches.
The exam watchdog ended the track and moved the candidate to "2 of 4 tracks
complete", with no "time up" and no way back. The same live clock ran behind
T3's reveal, a screen that calls itself "this reveal is presentation, not
scoring", and T4's delivery gallery. The report then advised the candidate to
"bank a submission earlier", even though they had not spent that time working.

**Declared timer policy, extended: time after submission is not charged.**
On a post-submit presentation screen, the scored work has already been captured.
Nothing the candidate does can change the score. The system therefore HOLDS the
track clock for exactly that interval. This follows the same principle as the
crash pause above and uses the same auditable mechanism:

1. `track_event` with `verb: "presentation_opened"` (context carries the
   screen id: `t2-replay`, `t3-reveal`, `t4-gallery`) — the recorded cause;
2. `paused` carrying `reason: "presentation"` — the clock stops.

Leaving the screen appends `presentation_closed` + `resumed` when the runner
returns to work. If the runner completes the track instead, the app appends
`track_completed` from the held clock. Budget accounting still DERIVES
`timedOut`; the app never guesses it. The app skips either entry if the machine
would reject it. An exhausted budget legitimately refuses further track events.

The reason lives in the LOG, not in component state. `SessionState.pauseReason`
is a projection. A reload during a replay therefore restores a held clock and
the "clock held · this screen is not timed" chrome instead of a pause veil.
An auditor can see which intervals were never charged. Append rejects `paused`
with an unknown reason.

- **The runner side** uses one effect per track to call the new optional
  `TrackUIProps.onPresentation(screen | null)`. It must never be called while
  a scored input can still change. Working-phase measurement, including T2 exposure,
  `decisionLatency`, and every artifact field, remains unchanged.
- **The watchdog cannot fire over a held clock.** It skips while
  `pauseReason === "presentation"` and re-reads the log before finishing. A
  screen opened in the same commit as the buzzer therefore cannot eject a
  reader. If the track's budget was already spent, it ends when the candidate
  leaves the screen and is correctly flagged `timedOut`.
- **A genuine timeout is stated.** `/exam` now displays an explicit "Time up"
  screen. It says what ran out, that the system kept the work and scored it from
  the last save, and that review screens are never charged. Previously, the app
  moved the candidate directly to the track list. `packages/report` now uses
  the same explanation instead of blaming the candidate.

**Tests:** `apps/web/test/examPresentation.test.tsx` (clock frozen for each of
the three screens, auditable hold appended, no veil and no Resume, watchdog
cannot force-finish, reload restores the hold, explicit time-up state,
working-phase timing unchanged), `packages/session/test/machine.test.ts`
("pause reason"), and `packages/tracks/t{2,3,4}-*/test/clockHold.test.tsx`.

## Content the candidate has not been shown (2026-09-04, TEN-116)

`track_started` starts the clock. The hosted deck fetch
(`GET /attempts/:id/items`) and the runner's dynamic import happen after it.
A fetch that hung therefore spent the whole non-revisitable budget, the
watchdog scored an empty artifact as a zero, and the candidate was told the
clock "ran out while you were working" and that "your work was kept". They
had never seen an item. Both sentences were false.

A wait for OUR content is our fault, and our fault is not charged. The clock
is held while the track has nothing presentable on screen, with the same two
entries the crash and presentation holds use:

1. `track_event` with `verb: "content_hold_opened"`;
2. `paused` carrying `reason: "loading"` — the clock stops.

`content_hold_closed` + `resumed` when the content arrives. Three details:

- **A one-second grace.** Content that appears inside one tick of the 1 Hz
  track clock costs nothing measurable, and holding for it would write a
  pause pair into the log on every track start. The hold is for a wait the
  candidate can see.
- **A fetch timeout.** 20 s, so a dead socket becomes a visible failure with
  a retry instead of an empty screen. The clock is held while it runs.
- **A runner that mounts straight into a presentation screen** (T2 rehydrated
  at `replay` after a reload) opens that screen on the same frame the content
  hold is still in place. `onPresentation` hands the clock from one hold to
  the other rather than dropping it.

**Tests:** `apps/web/test/examDeckHold.test.tsx` (a hang and a 503 both leave
the track sittable and unscored, the held-clock chrome shows, the hang ends
in a retryable failure), plus the presentation suite above, which pins that
the two holds do not fight.

## A pause must not answer the item (2026-09-04, TEN-115)

The host stops the TRACK clock on a pause and veils the workspace, but each
runner may keep a clock of its own. T2's fixed exposure did, and it kept
ticking behind the veil: the item on screen lapsed, was recorded as
`choice: -1` — a miss on a signal item, a false alarm on a noise item — and
the 1600 ms lapse notice expired unseen. The pause dialog said "your work is
kept" the whole time.

`TrackUIProps.paused` now carries the stopped clock to the runner. T2 freezes
its exposure interval and its lapse notice on it, and moves the exposure
anchor forward by the paused interval, so the recorded decision latency stays
the candidate's thinking time. A presentation hold is not a pause for this
purpose: the screen being read is the runner's own and nothing on it is
scored.

**Tests:** `apps/web/test/examT2Pause.test.tsx` (60 s paused mid-item records
no response at all, and the item is still sittable on resume).
