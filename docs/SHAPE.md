# SHAPE.md — which of the three things Foray is

Status: **decision proposed, awaiting the founder on four of its nine steps** (§11).
Date: 2026-09-05. Branch: `w/product-shape`.
Yardstick: `docs/ADR-orpc.md` and `docs/ADR-redis.md`. Both decided a question by
measuring something and then wrote down what would reverse the answer. There is no
build to measure here, so the measured quantities are somebody else's: the two
research memos commissioned on 2026-09-05 (`foray-research-engagement.md`,
`foray-research-virality.md`), the filed accounts collected in the private
`strategy/` corpus, and the state of this repository tonight.

Marking convention, as `docs/SAMPLING.md` and `docs/ADR-problem-exchange.md` use it:
**VERIFIED** is somebody's published or filed number, **ESTIMATE** is our arithmetic on
our own assumptions, **UNKNOWN** is a quantity nobody has.

---

## 0. The answer, in five sentences

**The daily is the product. The sitting is the instrument behind it. The credential is
a bet on a gate that does not exist.**

1. The unit of value people can have today is **a tell** — one artefact in one picture
   they could not see this morning and can see tonight — and the daily is the only
   surface that delivers one at zero marginal cost, with no account, no model key and no
   backend.
2. The scored sitting is not a product and should stop being sold as one: nobody can
   start one tonight (TEN-149), no score of record has ever been issued, and the
   judging pipeline that would issue one is unbuilt.
3. The credential asserts a completed sitting and no ability (`docs/CREDENTIAL.md`);
   the strategy corpus's own strongest sentence against itself is that *"Somebody pays,
   unprompted, for a capability proof no institution requires. No case of this was
   found"* (`strategy/MARKET.md` §10).
4. So the next twelve months are a consumer daily game that acquires a cohort and an
   item bank, funded by a research cheque rather than by candidates, and the exam is
   the reason the game is honest rather than the thing being sold.
5. That is the inconvenient half: **on this evidence the credential is years away and
   is not the near-term business, and pretending otherwise costs us the one asset we
   have, which is that our numbers survive being checked.**

Everything below is the argument, and §7 is the list of things that may never be traded
for engagement, so a future decision can be checked against it.

---

## 1. The question, stated properly

Foray is one codebase wearing three costumes.

| Costume | Who it is for | Unit of value | Reason to exist | Works tonight? |
|---|---|---|---|---|
| the free daily | anyone curious, arriving from a friend's grid | a **tell** — a thing you can now see | entertainment that happens to be true | **yes**, 5 cards, no account, static export |
| the scored sitting | a candidate who wants a number | a **result** about themselves | measurement | **no** — TEN-149, and no judging pipeline |
| the credential | somebody the candidate has to convince | a **claim to a third party** | proof | **no** — no score of record has been issued |

Three users, three units, three reasons. A company can carry three surfaces. It cannot
carry three products, because each one implies a different next hire, a different next
cheque and a different definition of a good week. The failure mode is not that any of
the three is wrong. It is that with all three live, every week can be described as
progress and no week can be described as a loss.

**The test used below.** For each costume, three questions: who is the user, what do
they do the day after, and who pays. A costume that cannot answer all three is a
surface, not a product.

---

## 2. Who is the user, and what do they do the day after

### 2.1 The daily

The user is a person who saw somebody else's grid. The day after, they can do one thing
they could not do the day before: **look at a picture and check a specific thing**. That
is not a metaphor, it is the corpus (`PROGRESSION.md` §2.2) — every card ends with a
one-line tell naming the artefact actually visible in that picture, and for a photograph
naming the suspicious-looking feature and why it is genuine.

This is the strongest mechanic in either memo, and it is not close. Kluger & DeNisi
1996, 607 effect sizes, 12,652 participants, mean **d = 0.41** (VERIFIED,
doi 10.1037/0033-2909.119.2.254): of everything they tested, exactly two moderators
*augmented* the effect across every exclusion the authors ran — feedback that supplies
the **correct solution**, and **velocity** feedback. Corroborated by Wisniewski, Zierer
& Hattie 2020, 435 studies, k = 994, N > 61,000, **d = 0.48** (VERIFIED,
doi 10.3389/fpsyg.2019.03087).

Two properties make the tell the right thing to build a product on, rather than merely
the right thing to keep:

- **It has no volume channel.** Seeing more tells raises no number about you. It is the
  only mechanic in the engagement memo of which that is true, and it is therefore the
  only one that cannot fail the TEN-80 test (the 25-point component removed on
  2026-09-02 for being monotone in how much the candidate did).
- **It is useful on its own terms.** A daily game is useful as entertainment, and that
  is a real use. But a tell is *also* the smallest possible unit of the thing this
  company claims to measure. The daily is not a funnel that happens to teach. It is the
  product delivering its own construct, five cards at a time.

### 2.2 The sitting

The user is a candidate who wants a number about themselves. The day after, on today's
build, they do **nothing**, because they never started.

TEN-149, measured on staging 2026-09-05 from a fresh Clerk account: the start pill on
`/exam` renders `aria-disabled="true"` with the label "Connect a model to start";
`apps/web/app/exam/page.tsx` gates the whole run on the single `foray:llm-base-url`
slot; `attempts` gained 0 rows that night and the last row is 2026-08-30. T2 and T3 need
no model and are unreachable anyway, because the gate is per-run and not per-track.

Set the bug aside and the question is still open: what would a person have the day after
a 90-minute sitting that is worth 90 minutes? On the current design the honest answers
are **the T1 artefact** (they built a site; they still have the site) and, for T3,
**a 1,200-word analysis of a document they did not choose**. One of those is worth
ninety minutes to the person who did it. The other is worth ninety minutes to us.

### 2.3 The credential

The user is not the candidate. It is whoever the candidate shows it to, and that person
does not exist yet in any evidence we hold.

`strategy/MARKET.md` establishes the mechanism and the evidence is filed, not inferred:
every audited proof-of-capability market sits downstream of an institution that
*requires* the score, and the tracked ones are shrinking. GRE takers 366,686 →
206,004 between 2020-21 and 2024-25, a **44% fall**, over a window in which US
law-school applications hit a 14-year high (VERIFIED). IELTS volumes down 18% two years
running (VERIFIED, IDP filings). CFA administrations 262,400 → 200,000 (VERIFIED).
Duolingo English Test revenue $42.006M, **−8%**, 4.05% of company revenue (VERIFIED,
FY2025 10-K). The memo's line is the right one: *the GRE is not losing candidates, it is
losing requirements.*

Foray has no requirement. `docs/CREDENTIAL.md` is careful and correct about what the
artefact asserts — a completed sitting, never a score — which means that today the
credential is a receipt. A receipt is a fine thing to issue and a bad thing to organise
a company around.

**Verdict on §2.** The daily answers all three questions. The sitting answers "who" and
"what next" only for T1, and answers "who pays" for nobody. The credential answers none
of the three. **The daily is the product; the sitting and the credential are surfaces of
it, and one of the two is a surface that does not exist yet.**

---

## 3. The smallest loop that is fun without the sitting

It already ships. `/daily` deals the same five cards to everyone on the same calendar
date, from published practice material, writes no scored row, and produces a
hit/miss/skip grid that is safe by construction and by mutation test
(`packages/report/src/daily.ts`, `docs/SHARING.md` §8, `PROGRESSION.md` §6).

**The loop, in the order a person meets it:**

1. Five cards. One question — is this a photograph or was it generated?
2. Answer locked, **then the tell**. Not before; spec §13 forbids feedback inside a
   scored block and the daily inherits the discipline for free because it is unscored.
3. The grid, with the day number and the run.
4. **The consensus line: "Card 3 got 71% of us."** This is the one thing missing.
5. Tomorrow there are five more, and there is no way to play ahead.

Item 4 is the whole recommendation of the virality memo and it is one line of copy on an
artefact that already ships. It is legal under `docs/SAMPLING.md` §11 because its
grammatical subject is the item and the cohort, never the poster — the two green-ticked
Stage 0/1 forms are a statement about takers and a statement about an item property, and
"card 3 got 71% of us" is both at once with no population noun in it. It leaks nothing:
`daily.ts` rule 1 already establishes that grid *position* is publishable, because the
day's deck is the same for everybody.

Why it matters more than it looks. Barasch & Berger 2014 (VERIFIED, doi
10.1509/jmr.13.0238, six studies): broadcasting to many recipients **suppresses content
that makes the sender look bad**. A 2-of-5 is never posted. Make the item the subject
and the poster becomes a witness, and a 2-of-5 becomes postable. Duolingo ran the
adjacent experiment and published the result: the **top 10% of XP earners contributed
more than half of all shares** (VERIFIED, blog.duolingo.com 2022-12-08), and they had to
build a second, non-performance card to reach the other 90%. A rank travels for winners.
A disagreement travels for everyone.

**What changes if the daily is the product.**

- **`/daily` becomes the front door.** Today the site's centre of gravity is `/exam`, a
  page that renders a disabled button. The landing surface should be the thing that
  works, and the exam should be reachable from it rather than the reverse. This is a
  routing and copy change, not an architecture change.
- **The tell gets louder and the streak gets quieter.** This is the engagement memo's
  single change recommendation and it costs nothing: the tell is the reason to come
  back, the streak is only the record that you did. Duolingo's own causal streak
  numbers are **+0.38% to +3.3% relative** (VERIFIED); the famous 2.4× and 3.6× are
  cross-sectional selection. Budget for the small numbers.
- **Say Lally out loud.** Lally et al. 2010, 96 volunteers, 12 weeks (VERIFIED, doi
  10.1002/ejsp.674): time to 95% of the automaticity asymptote ranged **18 to 254
  days**, and missing one opportunity "did not materially affect the habit formation
  process". `DAILY_STREAK_MEANING` is already in the right register. One more sentence
  in it — missing a day does not break a habit — is true, differentiating, and free.
- **The four-letter player type is demoted.** The virality memo measured our own
  version: on `demoCohortRows()`/`cohortMedians()`, **62.2% of the 44-person demo cohort
  has at least one of its four letters within 0.25 SD of its own cutline, and 33.4%
  within 0.10 SD** (MEASURED, in-repo). Those letters are coin flips on a cohort of 44.
  MBTI's own manual concedes 35% get a different type after four weeks (VERIFIED, Myers
  et al. 1998 via Pittenger 2005). Lead with the character and the evidence sentence,
  keep the code as small print, and render a pole under a strength threshold as
  undecided. This makes the card *more* shareable, not less — the NYT dialect quiz got
  21M pageviews partly because it was legibly, arguably wrong about people and had never
  promised otherwise (VERIFIED, Nieman Lab 2014-05-15, Katz to Knight Lab 2014-01-20).

**What the loop must never grow.** §7. In particular it must not grow a leaderboard, and
the consensus line must be watched for becoming one: the falsification test the virality
memo wrote for itself is the right one and should ship with the feature — *compare the
score distribution of players who share against players who do not; if sharing
concentrates in high scorers the way Duolingo's did, the design failed at the exact
thing it was for.*

**Cost.** The consensus line needs a backend (the static export cannot count today's
players, so the line must be **absent**, not zero, on Pages), a floor
(`MIN_COHORT_SIZE` is already 10 in `packages/report/src/aggregates.ts`) and one
relaxation of `SHARE_TEXT_FORBIDDEN` with a test that pins the predicate: a percentage
may appear only when its grammatical subject is an item or the cohort, never the poster.
If that predicate cannot be pinned in a test, ship the words instead ("most of us missed
card 3") and lose only precision. ESTIMATE: days, not weeks.

---

## 4. What the sitting has to become to be worth ninety minutes

### 4.1 First, it has to be startable

TEN-149 is not a bug in the roadmap sense. It is the roadmap: a signed-in candidate
cannot begin, and two of the four tracks need no model at all. Option (a) in that issue —
let a run start with the model-free tracks and gate T1/T4 at their own start — is the
one that matches this document, because it makes the sitting reachable from the daily by
the shortest path: *the daily is five cards of T2; the sitting is the hard version.*

Until this is fixed, every other sentence about the sitting is hypothetical, including
the rest of this section.

### 4.2 And "ninety minutes" understates it

The founder's question was what makes the sitting worth ninety minutes. The spec's answer
is worse than that: **the sitting is 4h 20m across two sessions, plus an untimed 48-hour
T1 build window.** Ninety minutes is T3's slot alone.

At the same time, most of the points do not exist. T1's 40 gate points and its 60
blinded Bradley-Terry pairwise points are **not implemented** — Bradley-Terry appears
nowhere in either repository — and T3's 45-point LLM-jury `analysis` component is not
implemented either. T4 already carries 0 points and `compositeWeight: 0` by design. So
**145 of the instrument's 375 points have no implementation behind them**, on a run
nobody can start, feeding a `scores` table that is empty.

This is the strongest single argument in this document. A four-and-a-half-hour
unsupervised event, with 39% of its points unbuilt, competing for a Saturday, is not a
product with a bug in it. It is a research instrument that has been described as a
product, and the description is what has to change.

### 4.3 What would make the time worth it to the person doing it

The measurement literature says the sitting must be **capped and constant** regardless of
what else changes. Debeer et al., *JEBS* 2014, PISA 2009 reading, **N = 467,819 across 65
countries** (VERIFIED, doi 10.3102/1076998614558485): test-taking effort declines during
the assessment, and both the decline and its variance are more pronounced in
lower-performing groups. Pools & Monseur 2021: the correlation between effort and
proficiency rises above 0.5 toward the end of the test (VERIFIED, doi
10.1186/s40536-021-00104-6). A variable-length sitting makes candidates non-comparable
and the bias falls hardest on the people who are already doing worst. So the answer to
"worth ninety minutes" is never "make it shorter for the people who are flagging".

The available answer is the take-away. Two of the four tracks already have one:

- **T1 leaves the candidate a built artefact.** They keep the site. That is worth ninety
  minutes independent of any score, and it is the only track where the current design
  passes the day-after test.
- **T3, today, leaves them a 1,200-word analysis of a 50–70 page document somebody else
  chose.** Nobody wants that on Sunday.

### 4.4 So PR #15 stops being a research ADR and becomes the roadmap — with one edit

`docs/ADR-problem-exchange.md` (PR #15, branch `w/t3-adr`, status *"direction accepted
(TEN-84); nothing it depends on has been measured"*) proposes replacing T3 with an
expert-posted problem exchange: a real problem a real expert owns, in a domain the
candidate does not work in, with AI assistance and open retrieval, inside a declared time
budget.

**Under this document's thesis, that ADR is the answer to §4.2 and should be sequenced as
product work.** The reason is not psychometric. It is that "an expert-posted problem you
actually wanted to solve" is the only proposal on the table where the candidate's day
after contains something they would have wanted anyway.

**The edit is that it ships unscored first, and the ADR already contains the mechanism.**
§5: *"Everything that falls out at any stage becomes a showcase item"*, and
`packages/core/src/allocation.ts` already marks T4 `scored: false` with
`compositeWeight: 0` — the track "is still run, still recorded and still reported, but it
contributes no points and no composite weight". That is Option A in §9 of the ADR, and it
is the right one for a company whose product is the daily, for four reasons the ADR
itself supplies:

1. **The cost is in the marking, and the marking scales with candidates, not items.**
   ESTIMATE, from the ADR §8: 9–20 expert-hours per validated item, and for a
   100-candidate wave at 8 items, **135–270 hours of poster marking on 800 attempts —
   more than the authoring**. An unscored showcase can run at a tenth of that because a
   showcase answer does not need a defensible key.
2. **The supply is unpaid experts.** GPQA paid ~$95/hour over 61 contractors; HLE needed
   a **$500,000 prize pool** (both VERIFIED). Our posters are unpaid summit contacts, so
   the cash cost is lower and the availability cost is higher. A showcase asks a poster
   for a problem. A scored track asks them for a marking obligation of 10–20 minutes per
   attempt, forever.
3. **The reliability is UNKNOWN and cannot be faked.** Spec §09 sets α ≥ .80 satisfactory
   and below .667 unusable. Shavelson's single-task G = .04 implies a sitting needs at
   least 8 items and 8 is a floor, not a target (ADR §7.1). None of this blocks a
   showcase. All of it blocks a score.
4. **It gives the daily somewhere to point.** A published, retired expert problem with
   its key and its attempts is the best content this company could own, and it is
   shareable under exactly the rule §3 uses: the subject is the problem, not the poster.

**What is given up by shipping unscored first, said plainly.** T3's two-tailed reliance
measure (`errorCatchRate`, `adviceUptakeRate`) is the thing `docs/TRACK-REVIEW.md` §0
calls the track to keep if only one could be kept, and the ADR's own flip condition §11
names it: if the reliance tails are what a sponsor is buying, the exchange should be a
fifth track and not a replacement. Under this document, that flip condition is *more*
likely to bite, not less, because §5 concludes the near-term payer is a research funder.
**So: keep T3 scored as it is, add the exchange as a showcase, and do not spend the
points until the funnel has published a per-stage yield.**

---

## 5. Who pays, and for what

I asked a reader to go through all 32 files of the private `strategy/` corpus for a
single question: name a payer. The finding is unambiguous and the corpus says it about
itself, repeatedly and in its own words.

**Nobody pays today, and nobody has been asked.**

- `strategy/PIPELINE.md` §4.5: *"No institution is named because none has been
  approached."* §5: *"No lab, foundation or programme has been approached and no amount
  has been discussed with anyone."* §6, on the pipeline table: *"This table is empty on
  purpose. Nothing has been sent."*
- `strategy/GTM.md` §2, the buyer table: individual — *"not yet: nothing to buy"*; SMB —
  *"only through Kien, unvalidated"*; anchor institution — no; government — no;
  healthcare — no. §5, on the score of record: *"today this is zero"*.
- `strategy/INTERVIEWS.md` is a plan for 30 interviews, zero conducted, and says so:
  *"This is a plan, not a finding."* Its §0 reports that across 24 practitioner threads,
  the searches `benchmark my`, `test my skills`, `how good am i` and `rate my` return
  **zero hits**.

There is no waitlist number, no signup number, no revenue, no LOI and no priced
conversation anywhere in the corpus.

### 5.1 What the evidence does not support

**A paid individual credential.** The $40–90 figure is labelled a PLANNING FIGURE in its
own file, derived from the Duolingo English Test's ~$65 as a comparable, not from a quote
or a price test. Against it: a judging cost floor of **$3–8 per sitting** (PLANNING
FIGURE, `docs/SAMPLING.md` §13.2), which the corpus reads correctly — *"any individual
price under roughly $25 is a loss per sitting before a single salary"*. And the demand
side is worse than untested, it is negative:

- Every hiring manager in the tracked thread said they had **never hired because of a
  certificate**; the recurring sentence is that a certificate passes one HR filter and
  *"no amount of certs get you past the second gate"*.
- The vendors are pricing the category to zero on purpose: OpenAI certifications (goal
  10M Americans by 2030), Microsoft Elevate (20M), vendor exams clustered at $99–200.
  *"Certification is customer acquisition for them, not a product."*
- **No sourced salary premium for an AI certificate was found anywhere.** The
  circulating "+30–40%" traces to a self-promotional post.
- The consumer identity artefact has no standalone revenue anywhere: 16Personalities has
  **1.57 billion tests taken and net assets of £196,513** (VERIFIED, filed accounts);
  23andMe reached 15M customers and 550k subscribers and filed Chapter 11 (VERIFIED).

**A regulatory hook.** This one was retracted inside the corpus and the retraction is
correct. Regulation (EU) 2026/1744 replaced AI Act Art. 4's duty with "take measures to
support"; the Commission's own Q&A says it *"does not entail an obligation to measure the
knowledge of AI of employees"*; there are six "AI literacy" notices in all of TED, and
the one Art. 4 tender was awarded on price with no exam. The corpus's own line:
**"The price floor for an Article 4 certificate is €0."**

**Insurers, professional bodies, governments.** Zero hits across 31 tracked carriers. No
US state mandates AI-specific CLE, and the remedial channel is ~67 court-ordered CLEs,
about **$33,500 of addressable revenue a year**. Federal AI procurement is priced near
zero (GSA OneGov: Claude to all three branches for $1). A population statistic is
*funded*, not sold.

### 5.2 What the evidence does support

Two things, and both are cheques rather than customers.

1. **A research cheque for a research deliverable.** The corrected ask in
   `strategy/FUNDING.md` is a first lab cheque of **$100k–$500k** against a raise of
   $0.8M–$1.2M (both PLANNING FIGURES, but the *shape* is supported: METR reports
   program service revenue of $0 on $13.6M of contributions — VERIFIED — which is
   exactly what a funded measurement body looks like on paper). What such a funder buys
   is an item bank, a published funnel yield, a calibration cohort and a method other
   people can check. Every one of those is produced faster by a daily game with a large
   Track A cohort than by an exam nobody can start.
2. **Selling measurement infrastructure into somebody else's statistics programme.**
   `strategy/MARKET.md` §8 Move 2 (OECD CFT 3552 / a TALIS 2030 lot). No bid has been
   made. This is the one route where the buyer already has the gate, the budget and the
   requirement, and we supply the instrument. It is also the route most obviously
   compatible with §7's rules.

### 5.3 The number that dates the credential

`docs/SAMPLING.md` prices a first population statistic at **$1.26M–$2.39M**, recommended
shape US+UK at n = 2,000 each: **$1.38M**, including operator and 20% contingency. And
the blocker is not only money: *"The Foray sitting is 4h 20m across two sessions plus an
untimed T1 build window... No probability panel will field that."* Track B needs a
45–60 minute matrix-sampled short form with plausible values, and T1 does not compress.
None of it is built.

So the honest sequence is: judging pipeline → issued scores → a short form → $1.38M →
a fielded panel → a defensible statistic → a reason for anybody to require the
credential. **That is years, and it is fine that it is years, provided nobody plans this
quarter as though it were months.**

### 5.4 The direct competitor with the distribution

Recorded because it is the fastest way to be wrong about all of the above: Nowcoder
(牛客) shipped "AI能力考核" in spring 2026 with thousands of enterprise customers. The
corpus's own reading — *"That is our product, with the enterprise distribution we do not
have"* — is a reason to build the consumer loop, not the enterprise one. We cannot win a
distribution race we have not entered against an incumbent that has.

---

## 6. What this decision gives up

A decision that costs nothing is not a decision.

- **We stop describing the sitting as available.** `/exam` today implies a run is
  available and then refuses it (TEN-149). Under this document, the honest page says the
  full run needs a model, offers the model-free tracks, and stops being the front door.
  That is a visible retreat and it should be published as one.
- **We defer the thing the founder cares most about.** The examiner seat is the
  strategic prize and `docs/POSITIONING.md` argues for it well. This document does not
  argue against it. It says the base rate for that path is **3–7 years** (POSITIONING's
  own formation table), and that the assets it needs — a cohort, an item bank, a
  published method, a reputation for numbers that survive checking — are exactly what a
  daily game accumulates.
- **We accept a smaller ceiling for now.** `strategy/MARKET.md` §9 already concedes it:
  selling sittings has a ceiling of *"$10M–$50M... not a venture outcome"*, and the
  consumer daily's own direct revenue is, on the filed evidence, close to zero. The
  daily is being chosen for what it produces (a cohort, a bank, distribution and the
  right to say something true), not for what it bills.
- **We risk building a good game and never getting back to the exam.** That is the real
  danger of this recommendation, and §9's flip conditions are written against it.

---

## 7. What may never be traded for engagement

The instrument removed a 25-point component on 2026-09-02 (TEN-80) for rewarding volume
where we claim to measure skill, and the points were **removed, not redistributed**,
because the evidence supported deleting a component and said nothing about the others
being worth more. That is the standard. This is the list a future decision gets checked
against. Each line has a test that can be run, or a file that already fails.

| # | The line | How a violation is caught |
|---|---|---|
| 1 | **No game mechanic enters `score()`.** Mechanics live in onboarding, pacing, reveal and social layers only. | spec §13; `runPure` (`packages/core/src/purity.ts`) |
| 2 | **No ranking of one person against another. Anywhere.** No leaderboard, league, XP total, division or weekly reset — not in the daily, not in the report, not in a share card. | `PROGRESSION.md` §6; `apps/web/test/progressPage.test.tsx` |
| 3 | **No component that is monotone in how much the candidate did may carry points.** If a term counts events, it is evidence, not score. | TEN-80 precedent; TEN-86 is the outstanding case (T3's 35 process points) |
| 4 | **No randomised or variable reward, ever, including the practice tier.** No loot, no surprise bonus, no unpredictable reinforcement schedule. | review; the mechanic has no channel from correctness to reward, so any implementation is a violation |
| 5 | **No scored item may appear in the daily or in practice, and no practised item may be scored.** A practised bank item is a dead item and there is no way to un-teach an answer. | `packages/report/test/practice.test.ts` against the real `bank.jsonl`; the `practice:` id prefix |
| 6 | **No feedback inside a scored block.** The tell is the product; it arrives after the deck is closed. | spec §13 |
| 7 | **No percentile, rank or "top N%" with a population noun in it, from a self-selected cohort.** Statements about items and about takers only. | `docs/SAMPLING.md` §11; `SHARE_TEXT_FORBIDDEN` in `packages/report/src/shareText.ts` |
| 8 | **No display signal may touch a score.** Upvotes, shares, consensus lines and streaks are displayed and never scored. | `ADR-problem-exchange.md` §6.2; the daily writes no scored row |
| 9 | **The credential's claim is never widened to buy demand.** `docs/CREDENTIAL.md`: if a completion-only credential is not worth issuing, the answer is to build judging first — not to widen the claim. | `packages/report/test/credential.test.ts`, `CREDENTIAL_LIMITS` |
| 10 | **A sitting's length is constant and is never cut, split or paced for engagement.** If it is ever split, split at a saved scored boundary and record the split in provenance. | Debeer et al. N = 467,819: effort decay is worse in lower-performing groups, so a length change is a differential bias |
| 11 | **A score is byte-identically recomputable, and no model call is on the recompute path.** | `AGENTS.md` core invariants; `assertJudgmentsAttested`, `replayTrackScore` |
| 12 | **Nobody who pays chooses what is measured.** No placement, disclosed membership, recusal, and refusals published. | `docs/POSITIONING.md`, "Rules that keep it defensible" |

Two of these are under live pressure and should be named so the pressure is visible.
**Line 2** is under pressure because a ladder is the most viral form available and every
comparable product has one; the answer is that two studies measured learning under a
leaderboard and found exam scores **fell** (Hanus & Fox 2015, 71 students, 16 weeks,
doi 10.1016/j.compedu.2014.08.019; *Learning and Individual Differences* 2024, doi
10.1016/j.lindif.2024.102572), and Duolingo's own reported win from leagues was learning
**time +17%**, denominated in hours. **Line 7** is under pressure because a percentile is
the single most shareable sentence a test can write; the answer is that Open-Source
Psychometrics measured the same raw Machiavellianism score at the **62nd percentile
against site visitors and the 94th against general-population samples** — a 32-point
swing produced by nothing but the choice of norm group.

A leaderboard would rank candidates by hours. That is the sentence that ends the examiner
claim, and it would be handed to a critic by us.

---

## 8. What to build, in order

Nine steps. Each says what it unlocks, what it costs (ESTIMATE, engineer-days unless
stated), and **who has to decide it** — a step marked **FOUNDER** is a positioning or
money decision that an engineer must not make alone.

**1. Decide TEN-149, option (a): let a run start with the model-free tracks; gate T1 and
T4 at their own start; say on the page what needs a model.**
*Unlocks:* the first `attempts` row since 2026-08-30, `sitting_started`, and any funnel
data at all. Nothing downstream of a sitting can be measured until this exists.
*Costs:* 2–4 days. *Who:* engineer. **This is first regardless of everything else in
this document.**

**2. Make `/daily` the front door, make the tell louder, make the streak quieter, and add
the Lally sentence to `DAILY_STREAK_MEANING`.** **FOUNDER** — this is a positioning
change, not a routing change: it moves the site's first claim from "sit an examination"
to "see what you missed today".
*Unlocks:* the product thesis of this document becomes visible to a visitor. Also the
cheapest possible test of it.
*Costs:* 3–5 days plus a copy pass.

**3. Ship the consensus line — "Card 3 got 71% of us" — with its floor, its share-text
predicate test, and its own falsification check.**
*Unlocks:* the first shareable artefact whose subject is the item rather than the poster;
this is the acquisition mechanism, and there is no other one.
*Costs:* 5–8 days. Hosted mode only; **absent**, not zero, on the Pages export.
Requires relaxing one regex in `SHARE_TEXT_FORBIDDEN` with a test that pins the
predicate — subject must be item or cohort, never the poster — and if that test cannot be
made to hold, ship the words and not the number.
*Check that ships with it:* the share-versus-non-share score distribution. If sharing
concentrates in high scorers, it is a leaderboard with extra steps and it comes out.

**4. Demote the four-letter player type.** **FOUNDER** — the sixteen characters are the
most distinctive thing we have made and this changes how they are presented.
Lead with the character and its evidence sentence; render a pole below a strength
threshold as undecided; keep the code as small print; say the retest fact in the product
before a journalist says it for us. A sibling test to `characters.test.ts` bans a pole
rendered as certain under threshold.
*Unlocks:* removes the one thing in the product a critic can dismantle in an afternoon —
62.2% of the demo cohort has a letter within 0.25 SD of its cutline, on a cohort of 44.
*Costs:* 4–6 days.

**5. Publish the loop's own noise on the page, not in the docs.** `PRACTICE_EFFICACY_NOTE`
and `PROGRESS_BASIS` already say the true thing; Human Benchmark's statistics page is the
model — it prints the ~30 ms of irreducible display and input latency next to its own
273 ms headline.
*Unlocks:* the only durable differentiator available before there is a norm.
*Costs:* 1–2 days.

**6. Merge PR #15 as written, with the sequencing note from §4.4: showcase first (its own
Option A), no points moved, no spec edit.** **FOUNDER** — moving T3's points, now or
later, is an instrument decision.
*Unlocks:* TEN-85, the posting interface, and a reason for a summit contact to be
involved at all.
*Costs:* the merge is free; the posting interface is private-repo work, and the key must
never have a path into this repository or into a browser.

**7. Run one wave of the exchange as showcase and publish the funnel's per-stage yield,
item by item.**
*Unlocks:* the three UNKNOWNs that gate everything psychometric — funnel yield,
poster/second-expert agreement, and a single-item G. Until these have values, no
allocation decision is available.
*Costs:* 145–320 expert-hours if run at the ADR's scored spec; materially less as a
showcase, because a showcase answer needs no defensible key. Mostly other people's time,
which is the constraint money does not immediately relieve.

**8. Take one funding conversation to one named funder, for the item bank and the
published method — not for a credential.** **FOUNDER**, and it is the only step on this
list that nobody else can do.
*Unlocks:* the $100k–$500k that pays for steps 7 and 9. The pipeline table is empty on
purpose; this is the step that makes it not empty.
*Costs:* founder time. No engineering.

**9. Do not start Track B panel work until a funder is named.** The recommended shape is
$1.38M and the panel cannot sit the instrument as designed; a 45–60 minute matrix-sampled
short form has to exist first. Starting this early converts a real research asset into a
sunk cost.
*Unlocks:* nothing today. It is on the list so that "when" has an answer that is not
"soon".

**The first three steps, if only three are done:** TEN-149, the daily as the front door
with the tell louder, and the consensus line. Those three convert a site that refuses its
own main action into a loop that works, is honest, and can be shared by somebody who
scored 2 out of 5.

---

## 9. What would make this the wrong call

Revisit, and reverse, if any of these becomes true.

- **A named institution requires a Foray result.** One employer in hiring, or one
  ministry procurement, and the credential becomes the product the same week. This is
  the single condition that reorders everything: `POSITIONING.md`'s own go-big sequence
  is right that the exam has no value until somebody requires it, and its value compounds
  quickly afterwards.
- **The daily's own return numbers are flat once the loop is complete.** If, with the
  tell prominent and the consensus line live, D7 return is indistinguishable from a
  static page, then the daily is not a product either, and the honest shape is a funded
  research group that publishes an instrument and a statistic — no consumer surface at
  all. `docs/KPI.md` already defines the events; they are silent with no backend, so
  step 1 and step 3 are also the measurement of this document's own thesis.
- **Sharing concentrates in high scorers.** Then the consensus line is a leaderboard and
  §7 line 2 has been violated by us. Pull it.
- **The exchange funnel comes back cheap and the posters accept the terms.** If yield is
  high, poster/second-expert agreement clears spec §09's α = .667 floor, and posters will
  mark attempts, then the sitting has the take-away it currently lacks and it becomes a
  product much sooner than this document assumes. This is the flip I would most like to
  be caught by.
- **A funder wants scores rather than a bank.** If the first cheque is contingent on
  issued scores of record, the judging pipeline jumps the queue and steps 2–5 wait.
- **T3's reliance tails turn out to be the asset a sponsor is buying.** Then the exchange
  is a fifth track, not a replacement, which is the ADR's own flip condition §11 read
  through this document.

---

## 10. Honest limits of this document

1. **There is no first-party demand evidence in it, because none exists.** Every
   commercial number is somebody else's filed accounts or an internally labelled
   PLANNING FIGURE. `strategy/INTERVIEWS.md` is a plan with zero interviews conducted.
   A single week of real user conversations could overturn §5 in either direction.
2. **The daily's retention is UNMEASURED.** There are no D1/D7 numbers for Foray at all;
   the funnel emitter is silent with no backend, and `attempts` last gained a row on
   2026-08-30. This document argues that the daily is the product from mechanism and
   from what works tonight, not from our own measured loop, because we do not have one.
3. **The 62.2% cutline figure is a 44-person demo cohort**, not candidates. It is
   evidence that the type is fragile, not a measurement of a real cohort.
4. **The engagement evidence is mostly not about examinations.** Language apps, chess
   ladders, electricity bills and step counts. The two studies that measured learning
   under a leaderboard are the closest thing to on-construct evidence in either memo, and
   they are 71 students and one quasi-experiment.
5. **Every cost figure here is ESTIMATE or PLANNING FIGURE.** The judging COGS
   ($3–8/sitting), the item cost ($850–$1,900), the panel shapes ($1.26M–$2.39M) and the
   funding ask ($100k–$500k) are all our own arithmetic. None is a vendor quote.
6. **The private backend repository was not read for this document.** Statements about
   judging being unbuilt come from `docs/CREDENTIAL.md` ("the `scores` table is empty")
   and from TEN-149's staging measurement, not from the service's source.
7. **This document decides nothing about T1.** T1 is the only track that already passes
   the day-after test and 100 of its 135 points are unimplemented. That tension deserves
   its own document.

---

## 11. Who has to decide what

| Step | Decision | Who |
|---|---|---|
| 1 | TEN-149 option (a) | engineer |
| 2 | the site's first claim moves from the exam to the daily | **founder** |
| 3 | the consensus line, and relaxing one share-text rule | engineer, founder informed |
| 4 | demoting the four-letter code | **founder** |
| 5 | publishing the loop's own noise on the page | engineer |
| 6 | merging PR #15 showcase-first; no points moved | **founder** |
| 7 | running a showcase wave and publishing the yield | engineer + posters |
| 8 | one funding conversation, for the bank and the method | **founder**, alone |
| 9 | not starting panel work | **founder** |

---

## 12. Review

codex review skipped: usage limit.

---

## 13. Sources

Ranked by how much work each did here.

1. **`foray-research-engagement.md`** (2026-09-05) — twelve mechanics with published
   numbers and failure modes. Load-bearing: Kluger & DeNisi 1996 (607 effects,
   d = 0.41, doi 10.1037/0033-2909.119.2.254), Duolingo's causal streak numbers
   (+0.38% to +3.3%), Hanus & Fox 2015 and *Learning and Individual Differences* 2024
   (exam scores fell under a leaderboard), Debeer et al. 2014 (N = 467,819, effort
   decay worse in lower-performing groups).
2. **`foray-research-virality.md`** (2026-09-05) — ship a shareable disagreement, not a
   score. Load-bearing: Barasch & Berger 2014 (broadcast suppresses self-damaging
   content), Duolingo's Year in Review post (top 10% of XP earners drove over half of
   all shares), the in-repo measurement of our own sixteen types (62.2% within 0.25 SD
   of a cutline), Open-Source Psychometrics on norm-group choice (62nd vs 94th
   percentile, same score).
3. **The private `strategy/` corpus**, 32 files, read for one question. Load-bearing:
   *"No lab, foundation or programme has been approached"* (PIPELINE §5), *"today this
   is zero"* (GTM §5), *"Somebody pays, unprompted, for a capability proof no
   institution requires. No case of this was found"* (MARKET §10), and the filed
   comparables — GRE −44%, IELTS −18%, DET $42.0M −8%, 16Personalities' £196,513 net
   assets against 1.57bn tests, METR's $0 of program service revenue.

In this repository: `docs/POSITIONING.md`, `docs/PROGRESSION.md`, `docs/SAMPLING.md`,
`docs/CREDENTIAL.md`, `docs/SHARING.md`, `docs/KPI.md`, `Foray-Spec-2026.1.md` §04, §09,
§13, `docs/ADR-problem-exchange.md` (PR #15, branch `w/t3-adr`), and TEN-149 as measured
on staging on 2026-09-05.
