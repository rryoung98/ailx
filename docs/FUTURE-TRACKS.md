# Future tracks — the frontier/agentic direction

Status: captured direction, not scheduled work. Recorded 2026-08-29.

## Why this exists

The founding observation for AILX's commercial wedge: forward-deployed engineers and
sales engineers know how to *use* AI, but they are not doing what frontier practitioners
do — running agents persistently for hours, orchestrating many agents at once, and
keeping long autonomous runs on the rails. Research done for `docs/POSITIONING.md`
confirmed the gap is real and unserved: FDE postings rose sharply through 2025, hiring
guides name eval-harness discipline as the differentiator, and ~80% of measured AI usage
is shallow writing and info-seeking. No incumbent credential touches any of it.

Every existing certification tests declarative knowledge about a tool, frozen at
authoring time. Frontier practice is procedural and moves every few months. AILX's
annual re-versioning already exists to chase that; these tracks are what it chases.

## The shape of the challenge

A long-horizon agentic task. The candidate builds and runs something that operates
autonomously for an extended period (12h+) toward a specified goal, then submits the
artifact plus the run's telemetry.

What it would actually measure — none of which a timed multiple-choice sitting can reach:

- Harness design: can they build a loop that survives failure without a human nannying it.
- Eval discipline: do they instrument success, or just hope.
- Recovery: what happens when the agent goes off the rails at hour seven.
- Cost and efficiency: tokens and money spent per unit of goal achieved.
- Intervention profile: how often a human had to step in, and why.
- Judgement: knowing when to kill a run versus steer it.

## The hard problems (unsolved — solve before building)

1. **It breaks the sitting model.** The current instrument is a 4h20m supervised sitting.
   A 12-hour autonomous run is asynchronous by nature: submission-based, more like a
   take-home with telemetry than a timed exam. Comparability across candidates and the
   secure-anchor equating story both need rethinking for this shape.
2. **Verification is the crux.** How do we know the agent ran as claimed, and the output
   was not hand-written? Options to evaluate: an instrumented harness we provide,
   signed run logs, reproducible replay from stored trajectories, or attested compute.
   Without a credible answer this track cannot be scored, only demonstrated.
3. **Scoring a trajectory, not an answer.** The artifact alone is insufficient — the
   run's shape is the evidence. That likely means rubric-scored trajectory review plus
   objective telemetry metrics, and it must stay recomputable from stored inputs like
   every other AILX score.
4. **Cost.** Long runs cost real money. Decide who pays for candidate compute, and how
   cost limits avoid becoming a wealth filter that biases the measurement.
5. **Anti-collusion at long horizons.** Take-home style work is easier to outsource.
   The trajectory data helps here — a bought result has a suspiciously clean one.

## Product principle to preserve

T1 stays a scored build task with a hosted artifact. AILX is **not** a site builder or an
agent-hosting platform: when a candidate wants to go further, offboard them (export the
artifact, point them at real tools) rather than growing an IDE. The same discipline
applies here — we measure the run, we do not become the runtime.

## Fit with the existing design

- Annual re-versioning is already the mechanism for "whatever is cutting edge" (spec §14).
- The T1 pipeline already proves the artifact half: content-addressed submission,
  validated, stored, hosted, recomputable.
- The gap is trajectory capture and verification, not artifact handling.
