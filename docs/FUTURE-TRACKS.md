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

### The offboarding ramp — built, 2026-08-31

The export half of that principle is no longer a promise. A candidate's T1 site can leave
AILX by three routes, deliberately ordered by how certain each one is:

1. **Download** — `GET /api/attempts/:id/site/export` returns the stored snapshot as a
   deterministic ZIP. Always available in server mode, needs no third party, and adds
   NOTHING to the archive: re-uploading the download re-derives the same content address
   it was scored under, which is the export's own integrity check. Everything else
   degrades to this rung.
2. **GitHub** — `POST /api/attempts/:id/site/github/start` then
   `POST /api/attempts/:id/site/github` create ONE public repository in the candidate's
   own account and push the site plus a generated README in a single commit. Auth is
   GitHub's DEVICE flow with the single scope `public_repo`, chosen because it needs no
   client secret and no registered redirect URI (the frontend and the exam service can be
   different origins). The access token is redeemed inside the export request, is never
   returned to the browser, never stored and never logged.
3. **Vercel** — a "Deploy with Vercel" link built from Vercel's documented
   `vercel.com/new/clone?repository-url=…` contract. It clones a public git repository, so
   it cannot exist before rung 2 and is offered only after it.

**There is no "Open in v0" button, on purpose.** v0 has no supported programmatic import
for a multi-file *plain static* site into someone else's account: its Platform API is
keyed by an API key (ours, which would put the candidate's site in OUR account), and the
shadcn "Open in v0" URL takes a React/shadcn registry item that says nothing about plain
HTML. What v0 does document is a ZIP upload in its own UI — which is exactly what rung 1
produces, so the panel says that instead of shipping a button that half works.

Three rules the export must not break, all covered by tests:

- **Ownership, not capability, authorizes it.** `/api/site/<digest>/…` is unauthenticated
  by design — the digest is what lets a share link render a site. That is enough to LOOK
  at a site and nowhere near enough to copy one into somebody's GitHub account, so every
  export entry point is attempt-scoped and goes through `withOwnedAttempt`.
- **Export READS.** No `responses` row, snapshot object or score is written. The
  reachability gate, one-submission-per-attempt and content addressing are untouched.
- **No marking material travels.** A snapshot holds only the candidate's own static
  assets; the generated README states what the sitting was, claims no score, and names
  the rubric and judge prompts only as things that are absent.

Code: `packages/backend/src/t1/export.ts` (download + handlers),
`packages/backend/src/t1/github.ts` (device flow, single-commit push, Vercel link),
`apps/web/lib/siteExport.ts` and `apps/web/lib/SiteExportPanel.tsx` (client).
Configuration: `AILX_GITHUB_CLIENT_ID`. Unset, rungs 2 and 3 answer 501 and the panel
offers Download alone.

## Fit with the existing design

- Annual re-versioning is already the mechanism for "whatever is cutting edge" (spec §14).
- The T1 pipeline already proves the artifact half: content-addressed submission,
  validated, stored, hosted, recomputable.
- The gap is trajectory capture and verification, not artifact handling.

## Candidates, ranked — and why eval design leads

A 2026-08-30 sweep of what this audience actually does with AI turned up three tasks the
four tracks do not reach. Ranked by what it would cost to close them.

**1. Injection detection — a T2 item family, not a track, and cheap.** The authored corpus
already has a `message-hostility` family, but every one of its items is phishing aimed at
a PERSON: fake bank alert, CEO wire request, credential harvest. No item asks whether a
document was written to deceive the MODEL the candidate is about to hand it to. That is
the skill this audience needs. There is a published measurement of hidden injections in
real resumes at scale behind this proposal, and the numbers that were quoted here carried
no citation, so they have been removed rather than left standing: name the study, with its
sample and its design, before any figure goes back in. The design point survives without
them — DATA injection (false facts that change what the model concludes) and PROMPT
injection (instructions that change what it does) are two item families, not one. Authoring them needs no new runner, no new scorer and no new track.

**2. Where the check belongs — a T3 rubric dimension, not a track.** T3 already seeds
`fabricated-citation` and `wrong-calculation` errors, and measures an individual catching
a planted one. Deloitte Australia returned part of a $290,000 fee for a client report
whose citations and quotes were fabricated by an Azure OpenAI agent; the reported root
cause was not one missed citation but the ABSENCE of a two-person check on citation claims
and of a structured review step for numerical assertions. Nobody is currently measured on
where a verification checkpoint belongs in a workflow. That is a rubric dimension.

**3. Eval design — the leading fifth-track candidate for 2027, ahead of the long-horizon
agentic run above.** `docs/POSITIONING.md` names eval-harness discipline as the
differentiator, and AILX tests no version of it: writing the scenarios before the agent is
useful, covering the production range and its edges, watching pass rate the way latency is
watched, catching what broke when something else was fixed. It leads the agentic run for
one reason — hard problem 2 (proving the agent ran as claimed) does not apply. A harness is
an ARTEFACT: submitted and inspected, like a T1 submission.

Its own hard problem, stated up front: **scoring a harness properly means RUNNING it, and
spec §12 forbids running candidate code on our infrastructure.** T1 escapes this because a
static ZIP is never executed; an eval harness is meaningful only when executed. Solve that
before scheduling the track — by scoring the harness by inspection against a rubric, or by
running it against a fixed model stub inside the same sandbox discipline `score()` already
has, or not at all.

## Cadence: challenges are researched and updated quarterly

The four tracks are not a fixed structure. Every quarter, research feeds an update to the
challenges themselves — not only the items inside them. "Whatever is cutting edge" is a
rolling target, and the instrument is expected to move with it.

This is a stronger claim than the spec's annual re-versioning (§14), and it changes what
the architecture has to make cheap.

### The distinction that decides the cost

- **New content inside an existing interaction shape** — a new item bank, new briefs, new
  rubrics, new judge prompts. This must stay DATA. It is already content-as-data,
  content-addressed, and swappable without shipping code. Quarterly updates should land
  here almost every time.
- **A genuinely new interaction shape** — e.g. a long-horizon agentic run, which no
  current track models. This requires a new TrackPlugin implementation. That is real
  engineering and should be rare by design.

The failure mode to avoid: treating every quarterly refresh as a new code package. If
each quarter needs hand-written track code, the cadence becomes the bottleneck and the
instrument stops tracking the frontier — the exact failure the product exists to fix.
So: push as much of a "new challenge" as possible into content, parameters and rubrics,
and reserve new plugins for genuinely new shapes of interaction.

### What this demands of the architecture

1. **Keep the TrackPlugin seam honest.** It is the only thing that makes a new shape
   additive rather than a rewrite. Do not let app code accumulate track-specific special
   cases that a new track would have to reproduce.
2. **Do not hardcode "four tracks" or "timed sitting" anywhere.** Composite scoring, the
   report, sharing payloads, progression and the gallery must all tolerate a changing set
   of tracks, including asynchronous ones.
3. **Recomputability is what makes rotation safe.** Because `score()` source is now
   content-addressed into the snapshot, and item banks are content-addressed, a score from
   an old quarter stays recomputable after the challenges move on. This is the property
   that lets us change the instrument without invalidating history — protect it.
4. **Comparability needs an explicit plan.** Quarterly rotation makes year-over-year
   comparison harder than annual re-versioning did. The secure anchor block must not
   rotate on the quarterly cadence; decide which parts rotate (operational forms) and
   which are held fixed (anchor), and state it before the first quarterly update ships.
5. **Publishing follows the cadence.** The public aggregates ("how is the world doing")
   must label which instrument version produced them, or trends across quarters will
   silently compare different instruments.

## Archive, replay, and additional "games"

As quarters advance, the instrument improves and previous quarters are ARCHIVED rather than
deleted. The gallery persists across versions, and people can still take archived forms.
Alongside the canonical scored sitting there is room for lighter game modes.

This is the released-past-paper model, and it is a real asset: archived quarters teach,
they are shareable, they give newcomers a low-stakes way in, and they make the library
grow with every cycle instead of being thrown away.

### The one-way door — decide this before the first archive

Publishing an archived quarter BURNS its items for scoring, permanently. Once a form is
publicly playable, its answers circulate, and any score derived from it stops meaning
anything. That is an acceptable and normal trade, but it must be explicit:

- **Archived forms are practice, never certification.** They can be played, shared and
  enjoyed; they must never produce a score presented as comparable to a live sitting.
- **Archiving is irreversible.** An item released to an archived form can never return to
  a secure operational form. Track item state explicitly (secure / operational / released)
  so this cannot happen by accident.
- **The secure anchor block is never archived.** Comparability across quarters depends on
  it; releasing it would destroy year-over-year equating (spec §14).
- **Label everything with its instrument version.** Gallery entries, shared results and
  public aggregates must all state which version produced them, or trends silently compare
  different instruments and archived play contaminates live statistics.
- **Separate the statistics.** Archived/practice play must be excluded from the public
  "how is the world doing" distributions, or the barometer measures the wrong population.

### Additional game modes

Beyond the canonical scored sitting, the natural surface includes: short daily practice
(the T2 Mastery loop), archived-quarter replays, and lighter challenge formats built on
existing track shapes. The discipline from `docs/FUTURE-TRACKS.md` applies — prefer new
CONTENT and parameters over new plugin code, and keep the tone of a well-made instrument
rather than a mobile game (spec: no currency, no cosmetic unlocks).

The product line that results: one canonical scored instrument, a growing archive people
can play and share, and a practice loop that brings them back between sittings.
