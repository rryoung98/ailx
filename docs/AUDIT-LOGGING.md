# AILX data-logging audit (2026.1)

Forensic audit of the data path: Runner UI → session log → score → report → export.
Scope: `apps/web/**` and `packages/session/**`, with read-only inspection of the
track packages. Every gap found here is closed on branch `polish/audit-logging`,
each with a regression test.

## 1. The data path

One attempt is one append-only event log (`packages/session/src/machine.ts`),
persisted in `localStorage` under `ailx:attempt:v1`
(`packages/session/src/persist.ts`). State is a pure projection of the log.

| Stage | Mechanism | File |
|---|---|---|
| Runner emission | `props.onEvent(TrackEvent)` | `packages/tracks/*/src/Runner.tsx` |
| Persistence | exam page `onEvent` → `append()` → `saveAttempt()` | `apps/web/app/exam/page.tsx` |
| In-progress state | `onCheckpoint(state)` → `ailx:checkpoint:<attemptId>:<trackId>` | `apps/web/lib/checkpoints.ts` |
| Completion | `track_completed` (artifact) + `track_scored` (score, judgments, rubricVersion, scoringDigest, modelManifest) | `apps/web/app/exam/page.tsx`, `apps/web/lib/registry.ts` |
| Report | projection of the log; verbatim Event log section | `apps/web/app/report/page.tsx` |
| Export | individual tier (own data) + research tier (allowlist) | `apps/web/lib/exportTiers.ts` |

Machine invariants (append time): legal phase transitions, fixed T1→T4 order,
nondecreasing timestamps, `track_event` rejected after budget exhaustion,
`timedOut` derived from budget accounting (never trusted from the caller).

## 2. What IS captured, per track (vs the spec's measurement design)

**T2 — discrimination.** Per item: `responded` event with `{itemId, choice,
confidence, latencyMs}` plus item index and type. Lapses recorded verbatim as
`choice: -1, confidence: 0` (zero calibration credit — F7 fix upstream).
`latencyMs` is anchored at ITEM RENDER (`shownAt.current = performance.now()`
in the deck effect), i.e. true response latency from stimulus onset, not from
deck or track start. Exposure actually shown comes from the instrument config
(`exposureSeconds` per item, F3 fix upstream). The artifact (`responses[]`)
carries the same rows the events carry — 1:1, tested.

**T1 — creative build.** Every assist prompt is logged (`prompted` with
`result.modelId` + `context.prompt`), every apply/reject and manual edit cycle
as `revised` with byte counts, `verified` for preview runs, `submitted` on
completion. The artifact's `promptLog` mirrors the events with `clientTs` and
`modelId` per entry.

**T3 — reasoning.** Full turn ordering: every turn carries a runner-side
monotone `seq`, `revision_of` chains in `context.revision_of`, `verified`
events for source checks, claim stances (`challenged` / `accepted`) with
timestamps, assistant id in context. Transcript in the artifact mirrors the
event stream.

**T4 — generative.** Every draft (`prompted` / `regenerated` with prompt +
`modelId`), every promote to final image/video (`promoted` with
`fromDraftIndex`, remaining quota), disclosure recorded in the artifact
(`disclosed: boolean`), timestamps per generation.

Scoring provenance: `track_scored` persists the judgment rows the scorer
consumed, the snapshot `rubricVersion`, a real `scoringDigest`
(hash of package version + shipped `score()` source), and the model manifest
(F12 fix upstream).

## 3. Findings (what was broken) and fixes

### A1 — Silent event loss while paused  (BLOCKER — fixed)
Runners stay MOUNTED under the pause veil (the F2 fix), so runner-internal
timers keep firing: a T2 exposure that lapses mid-pause calls `record()` and
emits `responded`. But the exam page's `onEvent` dropped any event when
`phase !== "in_track"`, and the machine rejected `track_event` outside
`in_track`. Result: the response entered the artifact and the checkpoint but
NOT the event log — artifact and audit trail silently disagreed.

**Fix:** `track_event` is now legal while `paused` for the current track
(budget accounting still applies; paused time consumes no budget), and the
exam page persists it. Late (budget-exhausted) events remain rejected by
design — that is the documented F13 rule, not silent loss.
**Tests:** `packages/session/test/machine.test.ts` ("paused-phase event
persistence"), and the integration test below.

### A2 — No multi-tab / duplicate-append protection on load  (MAJOR — fixed)
`loadAttempt()` accepted any JSON array shaped like a log. Two tabs writing
`ailx:attempt:v1` can interleave: duplicated seq, seq gaps, backwards
timestamps, or a foreign attempt's entries spliced in. `project()` would fold
all of it without complaint — corrupt state presented as authoritative.

**Fix:** `validateStoredLog()` replays every stored entry through the SAME
`append()` the live session uses (all machine invariants re-checked) and
requires `seq` to be exactly contiguous from 0 (uniqueness + ordering). The
longest valid prefix is returned; the corrupt tail is truncated and counted
(`loadAttemptValidated().dropped`), never silently folded.
**Tests:** `packages/session/test/persist.test.ts` ("validated load").

### A3 — Checkpoints not bound to their attempt/track  (MAJOR — fixed)
Checkpoint payloads (v1) carried no identity: a payload copied under another
attempt's or track's key (multi-tab race, restore tooling, manual edit) would
rehydrate a foreign attempt's work — and on timeout, be SCORED as this
attempt's partial artifact.

**Fix:** checkpoint shape v2 embeds `attemptId` + `trackId`; `loadCheckpoint`
verifies both against the requested key and rejects mismatches and legacy v1
payloads (fail closed: an absent checkpoint scores as a legitimate missing
response). **Tests:** `apps/web/test/checkpoints.test.ts` ("checkpoint
binding").

### A4 — Research-export `latencyMs` spanned track boundaries  (MINOR — fixed)
`statements[].latencyMs` was the gap since the previous `track_event` in the
WHOLE log — so a track's first event reported the between-tracks screen time
(or a prior track's tail) as "latency". Misleading for any downstream
analysis.

**Fix:** `latencyMs` is now anchored within the SAME track (null for a
track's first event). **Tests:** `apps/web/test/exports.test.ts`.

### A5 — No audit tally in the research export  (fixed)
Researchers could not verify that no emission was dropped. **Fix:** research
tier gains `eventCounts` per track (`{trackId, total, byVerb}`), computed from
the persisted log. Shape otherwise unchanged (`ailx.research.v2`; additive
field). Allowlist discipline intact — tallies only, no payloads.

### A6 — No user-visible audit trail  (fixed)
The report showed derived narratives but not the raw log. **Fix:** `/report`
gains a per-track "Event log" expandable section — verbatim, read-only:
`seq · verb · object · t+ since track start · Δ from previous event`.

### A7 — Stale duplicate Runners in the web app  (hygiene — removed)
`apps/web/lib/runners/T{1..4}Runner.tsx` were dead copies superseded by the
plugin `ui()` loaders (F11). Their event emissions differed from the real
runners — a trap for any future audit. Deleted (nothing imported them).

## 4. Regression + reconciliation coverage

- **Integration (zero silent drops):** `apps/web/test/eventflow.test.tsx`
  mounts the REAL T2 Runner under jsdom with fake timers, wires `onEvent`
  through the exam page's exact persistence semantics, and asserts the
  persisted `track_event` count equals the Runner's emission count — including
  a lapse fired mid-pause — and that every artifact response has a matching
  logged event, 1:1.
- **Latency anchor:** same test advances fake timers exactly 3 s between item
  render and answer and asserts `latencyMs ∈ [2900, 3100]` — proving the
  anchor is stimulus onset, not deck/track start.
- **Reconciliation (drift fails CI):** `apps/web/test/reconciliation.test.ts`
  runs a scripted full attempt and asserts byte-exact (`JSON.stringify`)
  equality between (a) the live score at completion, (b1) a full-pipeline
  replay from the persisted artifact after a save→load round-trip, (b2)
  `plugin.score()` over the PERSISTED judgment rows alone, and (c) the numbers
  in the research-tier export, including the composite.
- **Multi-tab corruption:** duplicate seq, seq gap, backwards ts, and foreign
  `attempt_started` splices are each truncated with `dropped` reported.

## 5. Known, documented asymmetries (not bugs)

- Events arriving AFTER budget exhaustion are rejected (machine rule F13). A
  response captured in the last checkpoint but too late for the log still
  scores via the checkpoint-derived partial artifact on timeout; the event log
  will show the rejection boundary. This is the spec's declared budget rule.
- Checkpoints are deliberately OUTSIDE the session log (kept lean); the
  authoritative artifact is the one in `track_completed`, which reconciliation
  proves reproduces the score.
- `clientTs` inside event payloads is the runner's wall clock (informational);
  the authoritative ordering is the monotonic `ts`/`seq` assigned at append.


## Residual items (Codex re-review, 2026-08-21)
- Fixed: multi-tab CAS (SaveConflictError), duplicate `track_scored` rejection, unknown-entry rejection, validated hydration + visible persistence warnings, honest landing/OG copy, report event-log copy accuracy, disputed item now carries its verified Commons AI category.
- Confirmed false positive: `afc954936e1d…` (Plaza Calderon) IS in Commons "Category:AI-generated images of architecture" (live category query); retained with category evidence embedded.
- Accepted residual: content tests gate id/hash/link-manifest consistency but not live Commons category membership (network-free CI); localStorage quota exhaustion surfaces a warning rather than a durable fallback store; duplicated Commons source files across 3 item pairs deferred to next bank revision.


## Runner faults and the clock (2026-08, exam-integrity fix)

A track Runner that throws is now caught by `apps/web/lib/RunnerErrorBoundary.tsx`
(plus route-level `app/error.tsx` / `app/global-error.tsx`). Before that, one
uncaught render error unmounted the tree and left a candidate on a white page
while their own clock ran on.

**Declared timer policy: a fault on OUR side does not consume the candidate's
budget.** On catch, the exam page appends, in this order:

1. `track_event` with `verb: "runner_crashed"` — the auditable cause, so a
   later reviewer can see why the attempt has an involuntary pause;
2. `paused` — the track clock stops.

`resumed` is appended only when the candidate presses "Reload this track and
continue"; a pause the candidate chose before the crash is never auto-resumed.
Either entry is skipped when the machine would reject it (an exhausted budget
legitimately refuses further track events), so recovery can never itself throw.
The stored log stays authoritative and untouched: retry remounts the runner
from its last checkpoint.

**Tests:** `apps/web/test/examCrash.test.tsx` (crash → recovery panel, log
intact, clock frozen across 5 s, retry resumes), `apps/web/test/routeError.test.tsx`.
