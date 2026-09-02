# KPI.md — the eight steps, and what they cannot tell us

The target is ~10,000 players. This document is how we tell traction from
noise before we spend attention on the push. It covers what is measured, the
exact event that marks each step, how return rates are derived, what each
number cannot support, and what would count as no traction.

D7 return matters more than the 10,000 headline. Ten thousand players who
never come back is not traction.

## What is instrumented, and what is not

The schema is `packages/contract/src/funnel.ts`. The browser half is
`apps/web/lib/data/funnel.ts`. There is no third-party analytics script, no
cookie, and no consent banner, because there is nothing here to consent to.
The POST is sent with `credentials: "omit"`, so no cookie travels with it
either. A row carries an anonymous browser-minted id, a session id, the
visitor's own calendar day, and a count of cards in a practice round.

The static GitHub Pages export has no backend. With `NEXT_PUBLIC_AILX_API_BASE`
unset the emitter mints no id, writes no storage and sends nothing. Every
number below therefore describes the HOSTED build only.

**The exam surface emits one funnel step: `sitting_started`.** Nothing inside
a sitting is instrumented. (The session's own `visit_started` still goes out
when the sitting is the first thing a browser does; it says a browser opened
AILX, not anything about the run.) Responses, per-item
timings, judgments and scores are exam evidence. They live in the append-only
store, are content-addressed and are replayable (AGENTS.md, core invariants).
They are not funnel metrics and must never be copied into one.

## The eight steps

| # | Step | Event | Fired from | Means |
|---|---|---|---|---|
| 1 | Session | `visit_started` | the emitter, on the first event of a browsing session | a browser opened AILX. Carries `newClient`. |
| 2 | Landing | `landing_viewed` | `app/page.tsx` | somebody was on the front page. |
| 3 | Play started | `play_started` | `features/practice/PracticeDrill.tsx`, `features/daily/DailyChallenge.tsx` | a person called their FIRST card of a round. |
| 4 | Play completed | `play_completed` | the same two components | the last card of that round was called. Carries `answered`. |
| 5 | Return D1/D7 | derived, see below | (none) | the same client id came back. |
| 6 | Identity | `signed_in` | `lib/auth/FunnelIdentity.tsx` | an account exists and this browser holds it. |
| 7 | Sitting | `sitting_started` | `app/exam/page.tsx` | a scored run began. |
| 8 | Share | `share_created`, then `share_opened` | `features/report/ShareLink.tsx`, `features/share/ShareView.tsx` | a link was minted; a link was opened and the card resolved. |

Two decisions inside those rows are load-bearing.

**A dealt deck is not a play.** The landing hero embeds a real practice drill,
so a deck is dealt to everybody who loads the front page. `play_started` fires
on the first card CALLED. If it fired on the deal, play-started would be a
second, noisier copy of landing-viewed and step 3 would be meaningless.

**A step is counted once per browsing session, keyed in `sessionStorage`, and
a session ends at midnight on the visitor's own device.** A tab left open
overnight opens a new session in the morning, otherwise the return that D1
exists to count would be deduped away. A
reload mid-play resumes the same play id, so it does not count a second play.
A round in the other loop is never a resume: starting the daily while a
practice round sits open is a new play, in the mode it was actually played in.
A second round the same day is a new play id and does count. Idempotency beats
delivery here: a lost event makes a number slightly low, a duplicated one
makes it false.

## How D1/D7 is derived

Return is a property of an id and a calendar, not an event. A browser cannot
know it is about to be a returning visitor, so nothing fires "returned" and
nothing in the browser computes a rate. Every event instead carries
`firstSeenDay` (the day the client id was minted) and `dayIndex` (whole days
from that day to this one).

D1 for a cohort of clients first seen on day D:

    numerator   = clients with firstSeenDay = D that emitted ANY event with dayIndex = 1
    denominator = clients with firstSeenDay = D
    D1          = numerator / denominator

D7 is the same query with `dayIndex = 7`. "D7 window" (returned on any of days
2..7) is a different and larger number; if it is quoted, it must be labelled.
Do not average the two.

The denominator is browsers, not people. One person on a phone and a laptop is
two clients. Two people on one shared browser are one client.

## What these numbers cannot tell us

- **They cannot tell us who.** No name, no email, no account id, no IP, no
  referrer, no user agent. There is no way to segment a cohort by who they
  are, on purpose.
- **They cannot follow anybody past 90 days.** The client id rotates after 90
  days and a rotation starts a new `firstSeenDay`. D1, D7 and D30 are
  measurable. A 6-month retention curve is not.
- **They cannot survive cleared site data, a second browser, or private
  browsing.** Each of those is a new client id, which inflates the denominator
  and depresses every return rate. The bias runs one way: measured retention
  is a FLOOR, not an estimate.
- **They cannot attribute a share open to a share.** `share_opened` carries no
  token, because a share token is a capability and a capability in a metrics
  table is a leak. Click-through is opens over creates, in aggregate, over a
  period, and both sides are counted once per browsing session: a candidate
  who mints two links in one sitting is one create. It cannot say which link
  travelled.
- **They cannot tell us anything about skill, learning or score.** A funnel
  event carries `answered`, never a tally. A rise in play completions is not
  evidence anybody got better at anything.
- **They cannot be trusted at small n.** The arithmetic we already apply to
  reliance rates applies here: a rate estimated on 8 opportunities at p = 0.5
  has SE = sqrt(0.25/8) = 0.177, so a normal-approximation 95% interval is
  about +/-0.35; a +/-0.10 interval needs about 97 opportunities
  (ailx-backend `docs/EVIDENCE-RELIABILITY-AND-TIME-PRESSURE.md` A12, the
  author's own arithmetic rather than a published result). A D7 rate off 30
  clients is a number with an interval wider than any decision it would
  inform.
- **They cannot be blocked-proof.** The POST is a `fetch` with `keepalive`,
  which content blockers stop and which some browsers still drop on a page
  hide. Absent events are under-count, never zero-traffic.

## What would count as no traction

Set before the push, so it cannot be renegotiated afterwards:

- **D7 return below 10% of a weekly cohort of at least 300 new clients.** Ten
  thousand landings with a 3% D7 is a spike, not a product. At n = 300 a 10%
  rate has a 95% interval of roughly +/-3.4 points, which is tight enough to
  act on; below n = 100 the interval is too wide to call either way and the
  honest report is "not yet measurable".
- **Play completion below 50% of plays started.** A round is five to eight
  cards. If half of the people who call one card do not reach the end, the
  loop is broken, and no amount of traffic fixes it.
- **A landing-to-play rate that falls while landings rise.** That is paid or
  borrowed attention arriving at a page that does not convert it.
- **Share opens far below share creates over a full week.** Links are being
  minted and not travelling.

Any of those, and the answer is to fix the loop, not to buy more landings.

## What the evidence base does and does not say

The claim that "engagement interventions decay to nothing at two weeks" is NOT
supported by our three evidence documents. None of
`EVIDENCE-CALIBRATED-RELIANCE.md`, `EVIDENCE-JUDGE-AGREEMENT.md` or
`EVIDENCE-RELIABILITY-AND-TIME-PRESSURE.md` (private repo) reports an
engagement effect decaying over days or weeks, and none reports D1/D7
retention. If we say it in public, we are inventing a citation.

What those documents do say, and it bears on how much weight a return number
can carry:

- Accuracy falls WITHIN a timed session and does not without a timer: "When a
  timer is shown, users maintain a fast pace of answering questions, but
  accuracy reduces later in the study. When there is no timer, users maintain
  a constant accuracy" (Swaroop, Bucinca, Gajos, Doshi-Velez 2023,
  "Accuracy-Time Tradeoffs in AI-Assisted Decision Making under Time
  Pressure", arXiv:2306.07458; EVIDENCE-RELIABILITY-AND-TIME-PRESSURE.md B3).
  That is a within-session effect, not a two-week one.
- Repeated exposure moves a behavioural measure: reliability "was substantially
  impacted by intrinsic measurement noise ... and to a smaller extent by
  practice effects" (Karvelis et al. 2024, "Test-retest reliability of
  behavioral and computational measures of advice taking under volatility",
  PLoS ONE 19(11):e0312255; same file, A1). So a returning player's SCORES are
  not a clean second measurement. Retention counts returns; it says nothing
  about what those returns measure.
- Behavioural measures are far less reliable than survey measures: median ICC
  0.311 for behavioural task DVs against 0.674 for survey DVs (Enkavi et al.
  2019, PNAS, DOI 10.1073/pnas.1818430116; same file, A3).

## Adding a step

Add it to `FUNNEL_STEPS` and give it a parse rule in
`packages/contract/src/funnel.ts`. The switch fails to compile without one.
Then fire it from the surface and add a test that proves it fires ONCE with
the right shape. Update this file in the same commit. A step nobody wrote
down here is a column nobody can interpret in six months.
