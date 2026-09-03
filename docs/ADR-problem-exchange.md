# ADR: replace T3 with an expert-posted problem exchange

Status: **direction accepted (TEN-84); nothing it depends on has been measured.**
Date: 2026-09-03. Issues: TEN-84 (this decision), TEN-85 (the posting interface and
the vetting funnel), TEN-86 (T3's Process-quality term). Branch: `w/t3-adr`.
Companion issues from the day before: TEN-80, which unscored T1's prompt log, and
`.research/ten-80-process-evidence.md`, the evidence spike behind it.

Yardstick: `docs/ADR-orpc.md` and `docs/ADR-zod-tanstack.md`. Those two ADRs decided a
library question by measuring bytes on a build. There is no build to measure here, so the
yardstick is different and it has to be named up front: **the measurable quantities in this
proposal are an item funnel's yield, an inter-rater agreement, and a generalisability
coefficient, and none of the three has a value yet.** Everything below that is arithmetic on
published numbers is marked with its source. Everything that is our own arithmetic on our own
assumptions is marked ESTIMATE. Everything we do not know is marked UNKNOWN, in the marking
convention `docs/SAMPLING.md` and `docs/TREND-FORM.md` already use.

This document records a decision and prices it. It does not change code, and it does not edit
`AILX-Spec-2026.1.md`. §9 says what the spec edit would be.

## 1. What is being replaced

T3 today is **160 points** and the heaviest track in the instrument
(`packages/core/src/allocation.ts`, spec §T3):

| Component | Points | Resolved by | Implemented |
|---|---|---|---|
| `overReliance` — planted-error detection | 50 | model-free | yes |
| `underReliance` — deliberate adoption of correct advice | 30 | model-free | yes |
| `process` — process quality | 35 | model-free | yes |
| `analysis` — analysis quality | 45 | llm-judge | **no** |

The candidate reads a 50–70 page source document, writes a 1,200-word analysis in 90 minutes
with an instrumented assistant, and the assistant is seeded with known-wrong outputs. Two
things about that design are the reason this ADR exists.

**The material is not contamination-resistant.** A dense policy or technical document is a
document a model may have been trained on, and the analysis it supports is prose a model can
produce. T3's defence has never been the material; it has been the *seeding*, which is ours and
is not in anyone's training data. That defence protects the two reliance components and
nothing else. The 45-point analysis component is scored on writing about a source the assistant
may already know.

**35 of the points count events.** The Process component scores decomposition, a revision
chain, discriminating verification and stance-taking. TEN-30 narrowed the verification quarter
to *discriminating* checks and `packages/tracks/t3-reasoning/test/verification.test.ts` pins
that, but the term is still monotone in the number of things the candidate did.
`docs/TRACK-REVIEW.md` §9.6 records the finding and records that TEN-80's branch deliberately
did not act on it: *"T3's Process-quality component (35 points) counts verification events,
which is volume-shaped even after §9.5 narrowed it to discriminating verifications."* That is
now TEN-86.

The evidence that cost T1 25 points applies here without modification
(`.research/ten-80-process-evidence.md`): no published study validates a volume-monotone process
score of AI-assisted work against an independent outcome; where volume has been measured against
a real outcome it is null-to-negative (Copilot completions shown r = 0.01 n.s.; dialogue turns
r = −0.01 against expert-rated artefact quality; help-seeking volume r = −0.46 with learning
gain); Faigley & Witte (1981) found expert adult writers revised *least*; and the two operational
programmes that score process, PISA 2012 and USMLE Step 3 CCS, score volume non-monotonically.

So the proposal is not "T3 is bad". T3's two reliance tails are the strongest model-free
measurement in the instrument and `docs/TRACK-REVIEW.md` §0 calls T3 the one track worth keeping
if only one could be kept. The proposal is that an **unpublished problem with a real key** buys
what T3's material cannot: contamination resistance by construction, and an outcome to score
instead of a process to count.

## 2. The proposal, as stated

A person posts a real problem they own and have already solved. The seed items are undersea-cable
policy problems raised at the YTL summit — deliberately niche. Candidates attempt the problem
individually, with AI assistance. The poster judges the attempts, helped by an AI key-judge
recommendation and by community upvoting, in the shape of a Stack Overflow accepted answer. When
the problem is solved, the item comes down.

Four of those five sentences are the design. The fifth — "when the problem is solved, the item
comes down" — is the one that costs the most, and §7 is about it.

## 3. The construct

**What this measures, as one sentence we can defend:**

> Whether a candidate reaches an answer an in-domain expert accepts, on a problem in a domain the
> candidate does not work in, with AI assistance and open retrieval, inside a declared time budget.

Four notes on that sentence, each of which is a constraint on what may be built.

**It is not "prompting skill".** That construct has no validated measure. Nothing in the evidence
base assembled for TEN-80 or TEN-32 validates a score derived from how somebody talks to a model
against an independent outcome, and the one place prompt count did predict a graded outcome, it
correlated r = 0.747 with depth of knowledge — it was a proxy for the questioning, in a setting
where nobody was paid to prompt more. Any construct label containing the word "prompting" is a
claim we cannot support.

**It is not general reasoning either.** The candidate has a model, a search engine and no domain
training. What is being observed is a joint performance of a person and their tools on one
unfamiliar problem. Calling that "reasoning" would repeat T2's error, where a perceptual aptitude
was labelled AI literacy until `docs/TRACK-REVIEW.md` §2 renamed it.

**"In a domain the candidate does not work in" is doing real work.** It is the condition that
makes the score interpretable, and it is not free: it has to be *established per candidate per
item*, not assumed. §6.3 is the price.

**It deletes calibrated reliance.** The exchange scores an outcome. It does not observe whether the
candidate accepted a wrong model claim or refused a right one, because there is no seeded
assistant behind a real expert's problem. The two-tailed reliance index — the only thing in the
instrument that measures the failure mode the field actually worries about — is not carried across
by this design. Two ways to keep it, and both are work: seed the assistant *on top of* an exchange
item, using the poster's own solution to decide what a wrong claim is (this makes the poster author
the plants as well, adding hours per item); or keep a reduced seeded-assistant block beside the
exchange. The ADR states the loss rather than assuming the construct survives the change of task.

## 4. The precedent, cited

Two published methodologies do most of what this proposal proposes. Both were fetched and read for
this document rather than recalled.

### 4.1 GPQA (Rein et al., 2023, arXiv:2311.12022)

448 multiple-choice questions written by domain experts in biology, physics and chemistry. The
headline result is the one this proposal leans on: **experts with or working towards a PhD in the
question's domain reach 65% accuracy (74% discounting mistakes they themselves identified in
retrospect), while skilled non-experts with unrestricted web access reach 34%, spending on average
37 minutes per question (median 30; 90% over 15 minutes; the top 20% take ≥ 45 minutes).** GPT-4
with few-shot chain-of-thought reached 39%.

The pipeline matters more to us than the headline:

1. an expert writes the question, with a detailed explanation and 1–3 source references;
2. **first expert validation** — a second in-domain expert answers it and gives feedback;
3. **revision** — the writer revises against that feedback (and must submit the revision form even
   when they change nothing, so the system records that revision was considered);
4. **second expert validation** — a third in-domain expert answers the revised question, with no
   further revision. This is the objectivity measurement;
5. **non-expert validation** — three validators with PhDs in *other* domains, with unrestricted web
   access but LLM assistants forbidden, and a 15-minute minimum per question. This is the
   difficulty measurement.

Two design details we should copy outright. First, **"expert agreement" is defined generously and
the definition is published**: validators agree if they answer correctly, *or* if after seeing the
answer they clearly explain their own mistake or demonstrate understanding of the writer's
explanation. A disagreement analysis then classifies the rest, giving a question-objectivity
proportion of 73.6% (76.4% on the looser reading). Second, **the funnel is priced into the
incentives**: writers get $10 base, $20 per expert validator who answers correctly, $15 per
non-expert who answers incorrectly, and $30 more if both experts are right and at least 2 of 3
non-experts are wrong. Expert validators get $10 base plus quality bonuses; non-experts get $10
base plus $30 for a correct answer. The paper estimates an average of **≈ $95/hour**, maximum
$150/hour, over 61 contractors hired through Upwork.

The yield is the number to carry: **564 questions collected → 546 extended → 448 main
(≥ 1/2 experts agree, ≤ 2/3 non-experts correct) → 198 Diamond (2/2 experts agree, ≤ 1/3
non-experts correct).** Diamond is **35% of what was written**, by people paid a bonus structure
designed to make them write items that survive. Domains were also dropped wholesale —
engineering, accounting and corporate law were piloted and abandoned for insufficient quality.

### 4.2 Humanity's Last Exam (Phan et al., 2025, arXiv:2501.14249, v11)

2,500 questions over a hundred subjects, from nearly 1,000 subject-expert contributors at over
500 institutions in 50 countries, with a $500,000 prize pool ($5,000 for each of the top 50
questions, $500 for each of the next 500) and co-authorship for an accepted question.

Its funnel is the one this proposal's non-searchability probe is modelled on, and its numbers are
brutal: **each question is tested against frontier LLMs before it can be submitted at all, and is
rejected if the models answer it. Over 70,000 attempts were logged, producing approximately 13,000
questions that stumped the models and were forwarded to human review.** Of those, 2,500 were
accepted — **3.6% of attempts, 19% of the questions that beat the models.** Human review is two
rounds: 1–3 graduate-level reviews on a standardised rubric, then organiser or trained-expert
approval.

Three further steps we should take as given:

- **searchability is tested as a contrast, not asserted.** A question is *potentially searchable*
  if a model **with** search tools answers it correctly and the same model **without** search does
  not. Every such question was then manually audited and removed if it was easy to find on the web.
- **expert disagreement was measured, twice, on samples of 200, with a rebuttal phase for the
  original author.** The final estimate is **15.4% expert disagreement on the public set, ~18% on
  the biology/chemistry/health subset** — and the paper says plainly that disagreement is higher in
  medicine, and that this level is in line with other expert-grade benchmarks.
- **a private held-out set exists** alongside the public one, to detect overfitting to the
  released items.

### 4.3 What the precedent does and does not license

Both papers support the core claim: expert-authored, unpublished, retrieval-resistant items are
buildable, and non-searchability can be tested rather than asserted.

Neither supports the rest of the proposal. **Both are keyed short-answer or multiple-choice items
with an unambiguous checkable answer.** HLE explicitly prohibits open-ended questions and
subjective interpretations. GPQA's objectivity claim rests on independent experts converging on the
same option. An undersea-cable policy problem, judged by its owner on a written response, has none
of those properties. The precedent tells us how to *source and validate* an item. It tells us
nothing about how to *mark* one, and §6.1 is the consequence.

## 5. The item funnel

A posted problem is not an item. It becomes one by surviving a lifecycle, and the honest reading of
§4 is that most posts will not.

| Stage | What happens | What kills an item here |
|---|---|---|
| **posted** | poster supplies the problem, the context, their own solution, and what "solved" means | incomplete, not actually owned, confidential, no solution held |
| **resolvability check** | an organiser reads the poster's solution and asks whether a written answer could be marked against it at all | the answer is a judgement call with no defensible key; "solved" is unstateable |
| **non-searchability probe** | the problem is put to a model with search and to the same model without. If the searched model lands, the item is dead | HLE's contrast, run before anything else is spent on the item |
| **key written** | the poster's private solution becomes a marking key: what a correct answer must contain, what a wrong one typically claims, what is out of scope | the poster cannot write a key that a second expert agrees with |
| **scored** | the item is fielded in a wave; attempts are marked against the key | leak detection fires; the item appears on the web mid-wave |
| **retired** | the item is withdrawn and its problem, key and attempts are published | — |

**Everything that falls out at any stage becomes a showcase item.** That is not a consolation prize
invented for this ADR; the allocation table already supports exactly this shape.
`packages/core/src/allocation.ts` marks T4 `scored: false` with `compositeWeight: 0`, and its
comment states the rule: the track "is still run, still recorded and still reported, but it
contributes no points and no composite weight". A problem that is fascinating but unmarkable, or
solvable by a searched model, is still a good thing for a candidate to spend twenty minutes on and
still good research data. It issues no points, and the report says so.

Expected yield is UNKNOWN for our domain and our posters. The two published analogues bracket it
badly: 35% of written questions reached GPQA Diamond, and 3.6% of HLE attempts reached the released
set. Our posters are not paid contractors writing to a rubric; they are summit contacts posting a
problem they already own, which should raise the resolvability rate and lower the volume. **The
first thing the pilot must produce is this funnel's per-stage yield, item by item, published.**

## 6. The three threats

### 6.1 The poster is a single rater, and the reliability is unmeasured

The proposal has one person deciding whether an answer is right, on a problem only they fully
understand, having already written the answer they consider correct. Nothing in the two precedents
is done this way. GPQA routes a question past two independent in-domain experts and publishes their
agreement rate; HLE routes it past 1–3 graduate reviewers plus an approver, then audits samples of
200 with a rebuttal phase, and publishes a 15.4% disagreement estimate.

Spec §09 sets our own thresholds already: Krippendorff's α ≥ .80 satisfactory, .667–.79 tentative
conclusions only, below .667 unusable; ICC(2,k) absolute-agreement, judged on the CI rather than
the point estimate; and Koo & Li's floor of at least 30 heterogeneous samples and at least 3
raters. **A single poster satisfies none of it.**

What must be measured before any score of record leans on a poster's mark:

1. **Poster vs AI key-judge agreement, per item, reported on the item.** The key-judge is not there
   to overrule the poster. It is there to produce a second, independent mark whose disagreement rate
   with the poster is a published number. An item whose poster and key-judge disagree often has a
   bad key, and the report should say which items those were.
2. **Poster vs a second in-domain expert, on a sample.** GPQA's second expert validator is the
   cheapest thing in either pipeline that produces a defensible objectivity figure. Cost: one extra
   expert-hour per sampled item.
3. **A rebuttal phase.** HLE's audits route disagreements back to the original author until
   consensus. Without it, a disagreement rate measures the auditor as much as the item.
4. **The scale must be coarse.** A poster marking a 0–4 band can agree with another expert. A
   poster marking a 0–100 score cannot, and spec §09 already prefers polytomous bands for exactly
   this reason.

Until (1) and (2) exist, the exchange may report a mark and may not weight it into a composite.
Note one piece of counter-evidence in our own favour: in Shavelson, Baxter & Gao's decomposition
the **rater components are ≈ 0** while person × task is 48–82%. If that holds here, the single
rater is not our biggest problem — the single *task* is (§7). But it "holds here" only if measured,
and on an open-ended written answer marked by its own author it is exactly the assumption most
likely to fail.

### 6.2 Community upvoting is a popularity signal. **It must never touch the score.**

Recommendation: **display upvotes, never score them.** The argument, in the order that matters:

- **It is the same defect that cost T1 25 points yesterday.** Upvotes are a count. A count is
  monotone in volume and in visibility, and the instrument has just finished removing one
  volume-monotone term on the evidence in `.research/ten-80-process-evidence.md`. Adding a second
  one, sourced from strangers, on the same day would be indefensible.
- **The length bias is documented in our own evidence base.** Afrin & Litman (2018) asked seven
  annotators whether a revision was better and got **Fleiss κ = 0.201**, and the best classifier's
  top feature was **length difference** (+4.81 for predicted-better). A crowd asked "which answer is
  better" partly answers "which answer is longer". The exchange's answers are free-text, so the
  attack is free.
- **It is gameable in a way the other signals are not.** A planted-error rate cannot be raised by
  telling your friends. A vote count can. Sockpuppets, timing, position on the page and the poster's
  own visible preference all move it. There is no version of this that survives a ministry reviewer
  asking who voted.
- **The house rule already covers it.** Spec §04's "collected and deliberately not scored" table
  states the rule for exactly this class of signal: *process and volume telemetry is evidence about
  how a sitting went, and it may filter, flag and describe. It may not award a point until something
  independent validates it.* Upvotes are that. They may rank a public gallery, they may flag an
  answer for the poster's attention, they may be published beside the mark — and they may not move
  a point.

The one legitimate use is as a **flag, not a score**: an answer with many votes that the poster
marked wrong is worth a second look, in the same way `docs/SAMPLING.md` §6.1 lets latency filter
without scoring. That use costs nothing and commits nothing.

### 6.3 Prior domain knowledge is a bias, not noise

The seed items are undersea-cable policy. A candidate who works in submarine telecoms, subsea
cable law or maritime infrastructure is not doing the task the construct describes — they are
answering from knowledge. Averaging that in does not cancel it out; it advantages one occupational
group in a track that would carry a third of the composite.

**GPQA's expert/non-expert split is the per-item detector, and it is directly runnable here.**
GPQA's rule is that a validator with expertise in *any* subdomain of physics may not act as a
non-expert on *any other* subdomain of physics — deliberately conservative. Our version:

- **at validation time**, every item goes to at least one in-domain expert and at least three
  out-of-domain validators with open web access. An item is admitted only if the in-domain
  validators mostly reach the poster's answer and the out-of-domain validators mostly do not. That
  is GPQA's Diamond criterion (2/2 experts agree, ≤ 1/3 non-experts correct) with our labels on it,
  and it is the only evidence that would let us call an item "outside the candidate's domain" at all.
- **at sitting time**, the candidate declares occupational exposure to the item's domain before
  seeing it, on a fixed short list, and the declaration is stored on the sitting. Any candidate who
  declares exposure is scored **as a showcase attempt on that item** and gets a replacement item.
- **at analysis time**, a DIF screen on the exposure flag, reported per item. If an item's
  advantage to declared-exposed candidates is large, the item is retired, not the candidate.

Cost: three extra validators per item — GPQA's non-expert validation, at their published rates
$10 base + $30 for a correct answer each, and an average of 37 minutes each. This is not an
optional refinement. Without it the track measures who happened to attend a telecoms summit.

## 7. Equating, and the cost of "take it down when solved"

This is the biggest consequence of the proposal and the section that should be read before any
other.

**If items retire on solve, two candidates are scored on different items, and two scores are not
comparable.** Comparability is not a property of an item pool; it is produced by a linking design,
and there are only three honest options.

**(a) A permanent anchor set every candidate takes.** Some items never retire and are sat by
everyone; the rotating items are placed on the anchor's scale. This is what
`docs/TREND-FORM.md` does for T2 and what spec §09's "anchor-block move" describes. It works, and
it costs the thing the proposal was for: a permanent item is an exposed item, and an exposed item is
searchable within weeks. `docs/TREND-FORM.md` §2.4's canary design exists because we already know
exposure is the failure mode. An anchor of contamination-resistant items is a contradiction with a
half-life.

**(b) IRT linking through common persons or common items.** Standard, and out of reach at our n.
Spec §09 already rules out Bookmark standard setting because "a cohort sized for ±1 logit item
calibration cannot produce" IRT item parameters. A rotating pool of niche items sat by a handful of
candidates each is a worse case, not a better one. Requires an item pool an order of magnitude
larger than the one we can fund (§8).

**(c) Abandon cross-candidate comparability for this track.** The exchange reports a per-item
outcome and a per-item peer comparison, and it does not enter the composite. This is the option the
evidence supports today, and it is what the showcase shape in `allocation.ts` was built for.

### 7.1 The reliability arithmetic, and how many items a sitting needs

Shavelson, Baxter & Gao (1993, *JEM* 30(3):215–232), read in full for TEN-80: **person × task
interaction is 48–82% of total variance** across their science, maths and CAP assessments (60%/55%
for Navy/Marine job performance), **rater components ≈ 0**, and **G = .04 with one task, one rater,
one occasion**. Their own recommendation is about **15 tasks for G = .80**. *"Task sampling
variability appears to be fact, not artifact."*

Those two numbers do not agree, and the disagreement is the most useful thing in this section. Under
Spearman–Brown, `G_k = k·g / (1 + (k−1)·g)`:

| single-task `g` | tasks for G = .80 | G at 1 task | G at 8 tasks | G at 15 tasks |
|---|---|---|---|---|
| .04 (their worst case) | **96** | .04 | .25 | .38 |
| .21 (implied by their 15-task recommendation) | 15 | .21 | .68 | .80 |

So: **the 15-task figure implies a single-task G of about .21, and the .04 figure implies 96
tasks.** One niche problem sits somewhere in that range and tells you almost nothing about a person
either way. This is not a marginal loss of precision; at G = .04 a single-item score is
approximately noise.

**Recommendation: a sitting needs at least 8 items, and 8 is a floor chosen for what it rules out,
not a target that buys reliability.** Eight items reaches G ≈ .25 in the pessimistic case and
G ≈ .68 in the optimistic one. Below 8 the track cannot be defended at all; at 8 it can be reported
as a band with an interval, in the shape T3's reliance rates already use. A score of record needs
15 at best and 96 at worst, and which one is true is an **UNKNOWN that only a G-study on this task
family can answer** — persons × items × occasions, which needs the same candidates on the same items
twice, and is the same study `docs/TRANSFER-STUDY.md` §3.2 already specifies for T3's retest.

The consequence for the timetable is immediate and unwelcome. GPQA's non-experts spent a median of
30 minutes per question with open web access. **Eight items at GPQA's observed pace is four hours.**
T3's slot is 90 minutes. So one of these must give: the slot grows (and `docs/SAMPLING.md` §5 says
a probability panel will not field it — this track can never enter the population statistic, exactly
like T1); the items get much smaller than an undersea-cable policy problem; or the track accepts
option (c) and stops claiming comparability. ESTIMATE: at 20 minutes per item, eight items is
2h 40m, which is a two-session asynchronous window, not a proctored block.

### 7.2 Retire on solve, or retire on reveal?

**Recommendation: retire on scheduled reveal at the end of a fixed wave. Never on first solve.**
Five reasons, in descending order of force.

1. **Supply cost.** Take a cohort of 100 candidates × 8 items = 800 attempts. If the per-item solve
   probability is around .2 — between GPQA's 34% non-expert accuracy on the main set and 22% on
   Diamond — then an item retiring on first solve survives about `1/p = 5` attempts, so the wave
   needs about **160 validated items**. Under retire-on-reveal, the same wave needs **8 to 16**.
   At §8's cost per validated item, that is the difference between a five-figure and a six-figure
   content bill for one cohort. This alone decides it.
2. **Equating.** Retire-on-solve makes even option (a) impossible: an anchor item that retires is
   not an anchor. Retire-on-reveal makes every candidate in a wave comparable within the wave by
   construction, which is the weakest useful form of comparability and the only one available.
3. **An item's life is unschedulable.** A problem solved eleven minutes after posting has been sat
   by whoever happened to be online. The candidates who saw it are a self-selected subsample of a
   self-selected cohort, and the item's difficulty statistic is computed on them.
4. **The incentives point opposite ways.** The poster wants their problem solved; the instrument
   needs the item to survive. Retire-on-solve rewards the poster for posting an easier problem, and
   the poster is also the marker (§6.1). Retire-on-reveal separates the two: the poster gets every
   attempt at the end of the wave regardless.
5. **Leak detection needs a window.** `docs/TREND-FORM.md` §2.4's canary design assumes an item
   lives long enough to be watched. An item that vanishes on solve cannot be watched at all.

What retire-on-solve is right about, and what to keep from it: **exposure kills an item, not
solution.** So the wave is short (ESTIMATE: two weeks), the reveal is complete — problem, key, every
attempt, the poster's mark — and an item is never re-fielded. That gives the poster the Stack
Overflow moment the proposal is built around, one wave later, and it gives the public bank that
makes the whole thing worth participating in.

## 8. The cost of an item, and of a first cohort

Every number in this section is either GPQA's published figure (VERIFIED) or our arithmetic on it
(ESTIMATE). Nothing here has been observed on an AILX item, because no AILX item of this kind
exists.

**Validator time per item, from GPQA (VERIFIED).** Non-expert validation: 37 minutes mean, 30
median, three validators = **~1.85 hours**. Expert validation: two validators, minimum time
requirements not published as a mean; at the same order, **~1 hour**. Writing time is collected by
GPQA from writers but not published as a mean, and is therefore **UNKNOWN**.

**Our estimate for one *attempted* exchange item (ESTIMATE):**

| Step | Hours | Who |
|---|---|---|
| poster writes the problem, the withheld context, and their private solution | 1.5–2 | the poster |
| resolvability check and non-searchability probe | 0.3 | organiser + model credits |
| key written and reviewed with the poster | 1–2 | poster + organiser |
| second in-domain expert validation (§6.1) | 0.75 | a second expert |
| three out-of-domain validations (§6.3) | 1.85 | three validators |
| **total per attempted item** | **5.4–6.9** | |

**Per *validated* item, the yield divides it.** At GPQA's 35% survival to Diamond: **15–20
expert-hours per validated item**. At a friendlier 60%, which is plausible because our posters
bring a solved problem rather than inventing a question: **9–12 hours**. At GPQA's published
average of $95/hour, that is **$850–$1,900 per validated item**, or **$1,400–$1,900** on the
pessimistic yield. Our posters are unpaid summit contacts, so the *cash* cost is lower and the
*availability* cost is higher: an unpaid expert who owes you nothing is a supply constraint that
money cannot immediately relieve, and HLE's answer to the same problem was a $500,000 prize pool.

**A first cohort.** Take 100 candidates, 8 items each, retire-on-reveal, one wave:

- **items needed:** 16 (8 fielded plus 8 in reserve for the exposure-flag replacements of §6.3).
- **expert-hours:** 16 × 9–20 = **145–320 hours**, of which roughly a third is poster time.
- **marking:** 800 attempts. At 10–20 minutes per attempt for the poster, plus the key-judge run,
  that is **135–270 hours of poster time** — *more than the authoring*. This is the number most
  likely to be missed. GPQA's cost is per item; ours is per item **and** per attempt, because a
  written answer to an open problem cannot be exact-matched. It is also the number that makes the
  AI key-judge load-bearing rather than advisory, and §6.1 is what stops that becoming "the model
  marks the exam".
- **the same wave under retire-on-solve:** ~160 items, 1,400–3,200 expert-hours. This is why §7.2
  answers as it does.

## 9. What happens to T3's 160 points

**No new allocation is invented here.** TEN-80 set the precedent that matters: when a component's
evidence fails, its points are **removed, not redistributed**, because the evidence supports
deleting a component and says nothing about the others being worth more. The options, and what each
commits us to:

**Option A — the exchange enters as a showcase, T3 keeps its remaining points.** The Process
component goes to 0 (TEN-86), T3 becomes 125 points, the instrument becomes 340, and composite
weights follow the points as they always have: T1 135/340 = .397, T2 80/340 = .235, T3
125/340 = .368. The exchange runs beside T3 as `scored: false`, exactly like T4. **Commits us to:**
one cycle of running the exchange for research data, and to `docs/TRACK-REVIEW.md` §9.2(b)'s lesson
that dropping points re-weights every other track whether you meant it or not.

**Option B — the exchange replaces the 45-point `analysis` component.** That component is
`implemented: false` today: one stub returning three seeded samples that band on answer length, and
a ~200-example calibration set that does not exist. Swapping an unimplemented LLM-jury score on
unkeyed prose for a poster-keyed outcome is the trade this proposal is strongest at. **Commits us
to:** a fourth resolution mechanism. `allocation.ts` has `model-free`, `machine-gate`, `human-cj`
and `llm-judge`; a poster's mark against a private key is none of them, and spec §04's safety claim
("a discovered flaw in one scoring mechanism cannot compromise the whole examination") is stated as
a number derived from that enum. Adding a mechanism means restating the number.

**Option C — full replacement, T3 becomes the exchange at 160 points.** Deletes the two reliance
tails (§3), makes 160 points depend on single-rater marking of an unequated pool, and needs every
measurement in §6 and §7 to have already landed. **Commits us to:** everything, before anything has
been measured.

**Recommendation: A now, B when §6.1's agreement numbers exist and clear spec §09's α ≥ .667
floor.** C is not available on this evidence and may never be: §7's arithmetic, not the item
quality, is what stands in its way.

**The Process-quality term disappears either way.** Under A and B, TEN-86's 35 points do not need
a repair, a re-derivation or a narrowed definition — they are gone, and the volume-invariance test
`packages/tracks/t1-creative-build/test/score.test.ts` already carries for T1 becomes writable for
T3 as well. That is a benefit of this proposal that is independent of whether the exchange itself
ever scores anything.

**What this does to `AILX-Spec-2026.1.md` §T3, stated and not done.** This PR edits no spec. If
TEN-84 is adopted: §T3's score allocation loses the 35-point Process bullet and the "Verification
under a declared time budget" subsection becomes a record of a removed measure; the "115 of the 160
points are model-free" sentence becomes 80 of 125; §04's mechanism table, its per-track line and its
"not implemented" table all move; and the totals in `packages/core/src/allocation.ts` move with
them, which `packages/core/test/spec-allocation.test.ts` will enforce in both directions. The
exchange itself enters §T3 as a new subsection only once it has a funnel yield to report. The spec
change follows the decision; this document is the decision.

## 10. The posting interface (TEN-85), and where the bank lives

The founder wants users to post problems. Two constraints shape that surface, and both are
architectural rather than cosmetic.

**What a poster must supply.** Four fields, and an item is not admitted without all four:

1. **the problem as you would tell a colleague** — the version that is public to candidates;
2. **the context the candidate will not have** — what you know that makes this hard, stored and
   withheld, because it is what the non-searchability probe is checked against and what the key
   depends on;
3. **your own solution, held privately as the key** — never rendered to a candidate, never sent to
   the browser;
4. **what "solved" looks like** — the acceptance condition, written before any attempt is seen, in
   the coarse band §6.1 requires. A poster who cannot write this fails the resolvability check, and
   the item becomes a showcase item.

**The scored bank is operational content and it lives in the private repo.** `AGENTS.md` is
unambiguous: the operational tier lives in `rryoung98/ailx-backend`, and
`packages/content-tools/test/public-tree.test.ts` fails the build if it comes back. A posted
problem with a private key is exactly that content. It follows that:

- no problem text, context, key or poster solution may land in `instruments/` in this repo;
- the frontend has **no API routes** (`packages/core/test/frontendOnly.test.ts` enforces it), so the
  posting form is a page that calls the exam service through `apps/web/lib/mode.ts` — the single
  seam that owns `apiBase()` — and holds nothing;
- **retired items are different.** Once a wave is revealed, the problem, key and attempts are public
  by design (§7.2), and a published bank of retired problems is a legitimate public artefact, in the
  same shape as `instruments/demo-2026.1/`.

The build detail belongs to TEN-85. What belongs here is the constraint: **the posting surface must
be designed so that the key never has a path into this repository or into a browser.**

## 11. What would make this the wrong call

Revisit, and abandon, if any of these becomes true.

- **The non-searchability probe kills nearly everything.** If fewer than about 1 in 10 posted
  problems survives the searched-model contrast, the supply cost per validated item exceeds the cost
  of maintaining the seeded-assistant design that already works, and the proposal loses on
  arithmetic rather than on principle. HLE's 3.6% end-to-end rate is a warning, not a floor.
- **Poster and second expert do not agree.** If disagreement on a validation sample runs materially
  above HLE's measured 15.4%, or if agreement cannot reach spec §09's α = .667 tentative-conclusions
  floor, there is no defensible key and the exchange may never score. It could still be a showcase.
- **A G-study returns a single-item G near .04 and the sitting cannot carry 8 items.** Then option
  (c) is the only honest one and the track carries no composite weight, permanently.
- **Posters will not accept the terms.** Reveal after a fixed window, a public key, a published
  disagreement rate and a marking obligation of 10–20 minutes per attempt are real costs to a busy
  expert. If posters want their problem back, or want to mark privately, the design does not exist.
- **Prior-exposure DIF is large and the replacement pool cannot absorb it.** If a third of a cohort
  declares exposure to undersea-cable policy, the reserve items in §8's cohort plan are the whole
  bank and the cost model breaks.
- **T3's reliance tails turn out to be what a sponsor is buying.** `docs/TRACK-REVIEW.md` §0 calls
  T3 the track to keep if only one could be kept. This proposal trades a measured behaviour under a
  seeded assistant for an outcome on a niche problem. If the two-tailed reliance measure is the
  asset, the exchange should be a fifth track and not a replacement.

## 12. What we cannot claim on day one

1. **Not "the exchange measures reasoning".** It measures reaching an expert-accepted answer in an
   unfamiliar domain, with tools, under a time budget (§3), and that construct is ours.
2. **Not "the items are contamination-resistant".** They are *contamination-resistant on the day
   they were probed*, against the models we probed with. HLE re-audits, and so must we.
3. **Not "the key is objective".** It is one expert's account of their own solved problem, marked by
   that expert. GPQA needed two independent in-domain experts and a published disagreement analysis
   to say anything weaker than that.
4. **Not "two candidates' scores are comparable".** Not without §7's linking design, and not at all
   under retire-on-solve.
5. **Not "one problem tells you about a person".** Person × task is 48–82% of variance and G = .04
   at one task.
6. **Not "the community validated it".** Upvotes are displayed, not scored (§6.2), and a display is
   not a validation step.
7. **Not "this is cheaper than T3".** It is not. T3's marginal cost per candidate is a model call
   against a seeded form we already hold. The exchange costs 9–20 expert-hours per item plus 10–20
   poster-minutes per attempt (§8), and the second term grows with the cohort.
8. **Not "it can produce a population statistic".** `docs/SAMPLING.md` §5 rules out a multi-hour
   unsupervised task on a probability panel. This track is convenience-frame only, like T1.
