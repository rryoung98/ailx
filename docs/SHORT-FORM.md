# SHORT-FORM.md — the panel short form, and what it can be a statistic about

Status: design document, first draft. Public on purpose, like `docs/SAMPLING.md` and
`docs/TREND-FORM.md`: the method is publishable, the item bank is not. Nothing in this file names
an item, an asset, a key or a generator prompt.

Companion documents: `docs/SAMPLING.md` §5 (the panel cannot sit the exam, which this file answers),
§8.3 (burden) and §13 (cost); `docs/TREND-FORM.md` (the frozen anchor, which this form carries);
`docs/TRACK-REVIEW.md` §2.6, §3.6, §4.6, §5.6 (short-form viability, track by track);
`AILX-Spec-2026.1.md` §04 (the sitting this form replaces).

Marking follows `docs/SAMPLING.md`. **VERIFIED** means a primary source was read and is cited.
**QUALIFIED** means the source was read and says something narrower than the claim it was cited for.
The narrower reading is written out. **ESTIMATE** means an engineering judgement with the reasoning
shown. **DECLARED** means a threshold we chose rather than derived. That is not the same as a
finding. **UNKNOWN** means we do not know and have not pretended to.

---

## 0. The one-paragraph version

The examination is 4h 20m plus a 48-hour build window (spec §04). A bought probability panel will
not sit it. Without a short form there is no population statistic at all. This document specifies a
**53-minute matrix-sampled panel form**. Every respondent takes the frozen T2 anchor core, then one
of four operational T2 link blocks and one of four T3 model-free reliance scenarios. That gives
sixteen forms with a common block. **T1 and T4 are out of the population statistic**, because both
need human panels a probability sample cannot supply. The T3 essay is out, because nobody writes
1,200 defensible words in a matrix block, and the LLM judge goes with it. What is left is measured
by arithmetic on response data with no model in the loop. So this form's statistic is **not "AI
literacy" and not the composite**. §2.3 names it in one sentence. Plausible values are the right
machinery for this design, and **we cannot produce them yet**: AILX has no IRT model and no
calibrated item parameters (§4.5). Wave 1 therefore publishes design-based weighted rates with
replicate standard errors. Plausible values arrive when a calibration exists.

---

## 1. The time budget, itemised

### 1.1 What has to go

| Component (spec §04) | Full sitting | In the short form |
|---|---|---|
| T1 build window | 48 h | **out** (§2.1) |
| Onboarding, consent, calibration block | 20 min | 6 min |
| T2 discrimination, 120 items | 50 min | 22 min, as two blocks (§3) |
| T3 calibrated reliance, incl. written analysis | 90 min | 20 min, planted errors only, no essay |
| T4 generative direction | 60 min | **out** (§2.1) |
| Peer comparative judgement (T1, T4) | 40 min | **out**: panellists are paid once and do not return to judge each other (`docs/TRACK-REVIEW.md` §3.6) |
| **Total asked of one person** | **4h 20m + 48 h** | **53 min** |

### 1.2 The ceiling this has to fit under

- **USC's Understanding America Study is the one panel with a published rate card, and it prices by
  the minute.** It pays panellists
  **"$20 per 30 minutes (and proportionately less if a survey is shorter)"**. It charges clients
  **"$3/per study participant/per minute for the first 500 participants"**, $2.50 after, plus a
  $2,000 handling fee (https://uasdata.usc.edu/page/Recruitment and
  https://uasdata.usc.edu/page/UAS+Pricing, fetched 2026-09-02). **VERIFIED.**
  **The claim that UAS *caps* a sitting at 30 minutes is UNVERIFIED and should stop being repeated,
  including in the issue that asked for this document.** We read Recruitment, Retention, For+Clients,
  UAS+Pricing, UAS+Policies and the UAS Client Road Map PDF. None states a maximum survey length.
  `uasdata.usc.edu/faq` and `/page/For+Researchers` are both 404. Thirty minutes is the unit of the
  pay rate, not a documented limit. It is still a useful reference point. A panel that prices its
  incentive in 30-minute units shows what a normal sitting looks like. But it is not a cap, and we
  may not cite it as one.
- **Web-survey dropout rises steeply with length: 31.8% at 10 minutes, 43.2% at 20, 53.2% at 30,
  with about 30% of all dropouts in the first four pages.** **VERIFIED** (Statistics Sweden, from
  Galesic & Bosnjak, *Public Opinion Quarterly* 73(2), 2009; `docs/SAMPLING.md` §8.3). **QUALIFIED on our own check:**
  the *Public Opinion Quarterly* article is behind Cloudflare and we could not read it (403 to plain
  HTTP and to a browser session, 2026-09-02). The abstract, via OpenAlex, supports the direction and
  the design but gives no percentages. The authors "manipulated the stated length (10, 20, and 30
  minutes)" and found "the longer the stated length, the fewer respondents started and completed the
  questionnaire", with later answers "faster, shorter, and more uniform"
  (https://api.openalex.org/works/https://doi.org/10.1093/poq/nfp031). So the three percentages are
  second-hand from the Statistics Sweden report, as `docs/SAMPLING.md` records them. The direction
  is verified at source. The numbers are not. Pew says the same qualitatively about its own panel.
  A single survey interview "is often limited in length to prevent respondent fatigue", and "the
  amount can also depend on the length of the survey"
  (https://www.pewresearch.org/our-methods/u-s-surveys/the-american-trends-panel/, fetched
  2026-09-02). **VERIFIED, and it is a statement of practice, not a number.** NORC AmeriSpeak and
  Ipsos KnowledgePanel publish no length or break-off figure we could reach: **UNVERIFIED**. We will
  not quote a vendor threshold from memory.
- **Length costs you the low scorers, not mainly the refusals.** In the German NEPS adult panel, a
  longer test did not raise interview refusal. It did significantly raise **test-avoidance**
  (skipping or abandoning the test while staying in the survey). Low test performance itself
  predicted dropping out of later waves (Kleinert, Christoph & Ruland, *Sociological Methods &
  Research*, 2019). **VERIFIED** via `docs/SAMPLING.md` §8.3. That biases the mean **upward**. It is
  the same direction as the online-coverage bias in `docs/SAMPLING.md` §7, so the two errors add.
- **Splitting the form into two sittings is not the free fix it looks like.** Peytchev et al.
  (*JSSAM*, 2019) found modularisation **increased** total non-response, with disproportionate
  incentive toward the first module helping. **VERIFIED** via `docs/SAMPLING.md` §8.3. One session
  it is.

**So 53 minutes is beyond the published dropout curve, and we are choosing it anyway.** The defence
is that an assessment is not a questionnaire. It is paid as work (`docs/SAMPLING.md` §8.2 puts the
incentive alone at $25–50 for an effortful scored task). The respondent is told the length up front.
The panel vendor recruits against a stated burden. That defence is **an argument, not evidence**.
The tolerable length is an **UNKNOWN**, and §7.2 buys the experiment that settles it.

### 1.3 Where the 53 minutes go

Per respondent, one session, no untimed window. **ESTIMATE** throughout. The per-item rates come
from the spec's own timings (120 T2 items in 50 minutes = 25 s/item).

| Segment | Minutes | Why it costs that |
|---|---|---|
| Consent, what the data is used for, the withdrawal right | 3.0 | Read-and-tick. Not compressible; it is the ethical floor. |
| Instructions and one worked example | 1.5 | Shown once, for the T2 response format. |
| Warm-up: 2 unscored T2 items with feedback | 1.5 | The first item of any timed block is the worst item of the block. Warm-up items are discarded, so first-item shock is not measurement error. |
| **Block A — frozen anchor core, 32 T2 items** | **13.5** | 32 × 25 s. Every respondent. `docs/TREND-FORM.md` §1.1. |
| **Block A′ — 8 canary items**, one respondent in eight | +3.5 | Leak detection, `docs/TREND-FORM.md` §2.4. Mean cost across the sample is 0.4 min. |
| **Block B — one of four operational T2 link blocks, 20 items** | **8.5** | 20 × 25 s. The bridge to the credential form (§5.2). |
| **Block C — one of four T3 reliance scenarios** | **20.0** | One source document, 8–12 planted errors, no essay (`docs/TRACK-REVIEW.md` §4.6). |
| Non-profile background items (AI tool access and use frequency) | 3.0 | The panel already holds age, sex, education, income and region. We ask only what it does not have. |
| Debrief, score-free thank-you, exit | 2.0 | No result is shown: the form issues no individual score (§6). |
| **Median respondent** | **53.0** | |
| **The one-in-eight with canaries** | **56.5** | |

Both fit under 60 minutes. Neither fits under 45.

### 1.4 The drop-off to expect, and how it is treated

- **ESTIMATE, from the Galesic & Bosnjak curve extrapolated past 30 minutes: 55–65% of starters do
  not finish.** The curve does not extend to 53 minutes. An assessment is not the survey it was
  measured on. So this is an extrapolation, not a finding.
- **Break-off is informative, not missing at random** (`docs/SAMPLING.md` §8.3, adopted). Every
  break-off enters the non-response bias analysis as a named group **with its partial performance
  data**. The matrix design already stores that data block by block.
- **Report an assessment-completion rate separately from the panel response rate**, both to AAPOR
  definitions (`docs/SAMPLING.md` §8.3). A respondent who answers the background items and abandons
  Block C is not a complete.
- **The block order is fixed and it is a decision.** The anchor core comes first, because it is the
  one block that must not be differentially lost. It is the trend line and the common set. The cost
  is that Block C, the most interesting 20 minutes, is fielded to the most tired respondents.
  **DECLARED**, and the wave-0 experiment (§7.2) randomises order so we can measure what it cost.

### 1.5 The shed order, decided before the data

If wave-0 break-off is worse than the design tolerates, minutes come off in this order and no other.
Writing the order down now stops it being decided at 2 a.m. by whoever holds the field report.

1. **Drop the operational T2 link block (−8.5 min).** Cost: the item-level bridge to the credential
   form (§5.2). The population statistic survives; the comparison with Track A does not.
2. **Halve the T3 scenario to 10 minutes with 5–6 planted errors (−10 min).** Cost: a much wider
   interval on the reliance rate. `EVIDENCE-RELIABILITY-AND-TIME-PRESSURE.md` §A12 is blunt about
   what few opportunities buy: at p = 0.5, 8 binary opportunities give SE = 0.177. That is a
   per-person figure, and the population mean is far tighter. But halving the block halves the
   information the wave collects about reliance.
3. **Drop the T3 block entirely (−20 min).** Cost: the statistic becomes T2-only, and the sentence
   in §2.3 loses its second half.
4. **Never shed the anchor core.** Without it there is no trend line, no common block and no matrix
   design. There are only sixteen unlinked short tests.

---

## 2. What is in the form, and the sentence the project turns on

### 2.1 Track by track

| Track | Full sitting | In the panel form | Why |
|---|---|---|---|
| **T2 Discrimination** (80 pts) | 120 items, 50 min | **In**: 32 frozen anchor items + 20 operational items | The only track that compresses cleanly: short discrete items, fixed exposure, no rater, no artefact, no window (`docs/TRACK-REVIEW.md` §2.6). |
| **T3 Calibrated Reliance** (160 pts) | 90 min, planted errors + 1,200-word analysis | **Half in**: the model-free planted-error block, 20 min. The analysis and its judge are out. | 115 of T3's 160 points are model-free and survive compression. You cannot write a defensible analysis in a matrix block, and the analysis is what the LLM judge marks (`docs/TRACK-REVIEW.md` §4.6). |
| **T1 Creative Build** (160 pts) | 48-hour build window, blinded pairwise human judgement | **Out** | Two independent blockers. The build window is not a matrix block, and the 40 comparative points need a rater pool: panellists are paid once and do not return to judge each other (`docs/TRACK-REVIEW.md` §3.6). |
| **T4 Generative Direction** (0 pts) | 60 min | **Out** | 60 minutes is the whole budget, 70 of its 100 designed points need human panels, and it issues no points anyway since 2026-09-01 (`docs/TRACK-REVIEW.md` §5.6, §9.1). |

**`docs/SAMPLING.md` §5 kept T1 alive as option (a): a 30-minute reduced-scope build for a random
third of the panel. This document rejects it and takes option (b).** Three reasons. A 30-minute
build block would cost more minutes than the T3 block that carries the better construct. It would
still yield only the 30 machine-checkable gate points, because the rater pool does not exist. So it
would measure something the credential's T1 does not measure, and invite the comparison it cannot
support. And a
composite whose components have very different precision is the Kreiner-style attack surface
`docs/SAMPLING.md` §9 already warns about. **T1 stays a Track A instrument**. The T1-in / T1-out
sensitivity contrast that §9 asks for then becomes trivial: T1 is out, and the headline says so.

### 2.2 What is deliberately NOT measured, and what that costs

- **No LLM judge is in the panel path at all.** That is not only a cost decision. A judged component
  would put a model version inside a population statistic. Judge severity moves with model version
  by up to 133 points of 1,000 across version contrasts (Sunkavalli 2026, arXiv:2608.29517,
  via `EVIDENCE-JUDGE-AGREEMENT.md` §2; **VERIFIED** there). The cost: the strongest *rubric*
  content in the instrument — analysis quality — is absent from the national number.
- **No response-latency component.** `docs/SAMPLING.md` §6 forbids it. Device latency alone ranges
  35–140 ms across handsets and correlates with handset price (Hassenstab et al. 2023, **VERIFIED**
  there). Timing is stored and stays diagnostic.
- **No individual score, and no score shown to the respondent.** §6.

### 2.3 The sentence the project turns on

> **The AILX population statistic is not a measure of AI literacy and it is not the composite. It is
> two rates, measured without a model in the loop: the rate at which adults tell 2026-vintage
> synthetic media and hostile messages apart from camera-captured media and legitimate mail, and the
> rate at which they catch and act on planted errors in an AI assistant's output.**

Everything publishable from a panel wave is a statement about those two rates, their subgroup
differences, and their change on the frozen line. **Nothing else.** A headline that says "AI
literacy" over this form claims a construct the form did not measure. A reviewer will find that in
an afternoon.

The two rates are reported as **two named subscales, never averaged into one number.** Averaging
them would create a composite with no weighting justification. The spec's weights (T1 .40, T3 .40,
T2 .20) are for a four-track instrument. Re-normalising two survivors of it to sum to 1.0 is a new
instrument wearing the old one's authority.

---

## 3. The matrix design

### 3.1 The shape

Sixteen forms, from one common block and two rotated families:

| Block family | Members | Per respondent | Minutes |
|---|---|---|---|
| **A — frozen anchor core** (T2, 32 items) | 1 | always | 13.5 |
| **A′ — canaries** (T2, 8 items) | 1 | one in eight, at random | +3.5 |
| **B — operational T2 link** (20 items each) | 4 | exactly one | 8.5 |
| **C — T3 reliance scenario** (8–12 planted errors each) | 4 | exactly one | 20.0 |

4 × 4 = **16 forms**. At n = 2,000 that is ~125 respondents per form, ~500 per B block and ~500 per
C scenario. At the `docs/SAMPLING.md` §4.1 floor of n = 1,500 it is ~94, ~375 and ~375.

### 3.2 Why four rotations and not two, or eight

- **Two is too few for the C family.** With two scenarios, half the reliance statistic rests on one
  source document. Any quirk of that document — its topic, its difficulty, its planted-error mix —
  is then inseparable from the population rate. Scenario is a facet we must be able to average over.
- **Eight is too many for the n.** At eight C scenarios and n = 1,500, each scenario has ~190
  respondents. A subgroup estimate inside a scenario then stops being reportable under the §4.5
  reporting floors.
- **Four is the smallest number that lets scenario variance be estimated at all** (three degrees of
  freedom) while keeping ~375–500 per block. **DECLARED**, and the wave-0 data should be used to
  check it rather than to confirm it.
- The B family is four for a duller reason. 4 × 20 = 80 operational T2 items, two thirds of the
  120-item operational deck. So the panel touches most of the deck, and no respondent sits more than
  20 of it.

### 3.3 Assignment

- **Randomised at the respondent, inside the panel's own sampling strata.** Not spiralled by arrival
  order. Spiralling by arrival correlates the form with time of day, and therefore with who is
  answering at that hour. It makes form a proxy for lifestyle.
- **Assignment is stored, not inferred.** The form id, both block ids and the anchor form id are
  written into the response record at issue time. A design recovered afterwards from which items a
  respondent saw cannot distinguish "not assigned" from "broke off before it".
- **Randomisation is stratified so the sixteen cells are balanced within country and device class.**
  Device class matters because `docs/SAMPLING.md` §6 device-locks the population form to
  desktop/laptop by default. A lock that leaks makes device a between-form confound.
- **The canary subsample is drawn independently of form.** It is a leak probe, not a design factor.
  Crossing it with the sixteen cells would leave ~8 respondents per cell holding it.

### 3.4 Partial coverage, and how it is handled

Every respondent is missing 60 of the 80 operational T2 items and three of the four reliance
scenarios. That missingness is **planned, and missing completely at random by design**. That is why
a matrix design is legitimate: the assignment mechanism is ours, it is random, and it is recorded.

What that means, in the order the analysis runs:

1. **Nothing is imputed at the item level.** An unassigned item is not a wrong answer and is never
   scored as one.
2. **Every published rate is a weighted estimate over the respondents who were assigned the block**,
   with the panel's design weights and replicate weights (`docs/SAMPLING.md` §9). The effective n is
   the block's n, not the wave's n. It is printed next to the estimate.
3. **The anchor core is the only block with the full n**, which is a second reason it carries the
   trend.
4. **A person-level scale score requires a measurement model that does not exist yet** (§4.5). Until
   it does, there is no person-level number to report. The design does not need one.

---

## 4. Plausible values

### 4.1 What they are, for a reader who has not met them

A matrix design gives each person too few items for a reliable individual score, on purpose. Score
each person anyway and average those scores. The population mean is then about right, but **the
population variance is too wide**. Each person's score carries measurement error that does not
cancel. Every statistic that depends on the spread — a standard deviation, a percentile, the share
above a cut, a subgroup gap — is then wrong. It is wrong in a direction that looks like a real
finding.

Plausible values fix this by producing no point score at all. For each respondent the model draws
several random values from the **posterior distribution of that person's proficiency**, given their
answers and their background characteristics. Each draw is a plausible ability for that person.
Analyses run once per draw and the results are combined, so the uncertainty about each person enters
the published standard error instead of hiding inside a point estimate.

This is NAEP's design. NCES states the reason in its own words:

> "In contrast, NAEP derives its population values directly from the responses to each question
> answered by a representative sample of students, without ever calculating individual test scores.
> For NAEP, the population values are known first."
> — https://nces.ed.gov/nationsreportcard/tdw/analysis/est_pv_individual.aspx (fetched 2026-09-02)

> "Because NAEP is not designed to report individual test scores, it produces estimates of scale
> score distributions for groups of students."
> — https://nces.ed.gov/nationsreportcard/tdw/analysis/ (fetched 2026-09-02)

**VERIFIED.** The design point that makes this necessary is the same one AILX has: "Because NAEP is
a large-group assessment, each student takes only a small part of the overall assessment"
(https://nces.ed.gov/nationsreportcard/faq.aspx, fetched 2026-09-02). **VERIFIED.** NCES's glossary
defines matrix sampling as a "sampling plan in which different samples of respondents take different
samples of items" and BIB spiralling as "a complex variant of matrix sampling"
(https://nces.ed.gov/nationsreportcard/glossary.aspx). **QUALIFIED on one point of framing:** the
NAEP technical documentation describes the programme as moving "from an early concept of matrix
sampling to the present use of probability sample design". So "NAEP uses BIB-spiralled booklets" is
accurate, and "NAEP's sample design is matrix sampling" is looser than NCES's own wording
(https://nces.ed.gov/nationsreportcard/tdw/, fetched 2026-09-02).

### 4.2 Why this design needs them

Three reasons, all structural:

1. **Nobody takes the whole pool.** Each respondent sees 20 of 80 operational T2 items and one of
   four reliance scenarios (§3.1). Individual scores from that many items are dominated by which
   block the person happened to get.
2. **We report subgroup differences.** Age, education and income gaps are the point of a population
   statistic. Those are the statistics that break under measurement error in a point score.
3. **The panel is weighted.** Design weights, replicate weights and plausible values compose. A
   published figure needs both sources of uncertainty, sampling and measurement. Rubin's rules are
   how the second one enters.

### 4.3 The model that produces them

NAEP's conditioning approach is the reference. We copy its shape:

> "In order to accurately and consistently estimate group-level statistics and to provide useful
> data for secondary analysis, NAEP creates plausible values. These plausible values are based on a
> latent regression model that contains both measurement and population-structure models."
> — https://nces.ed.gov/nationsreportcard/tdw/analysis/est_pv.aspx (fetched 2026-09-02)

> "The population-structure model relates underlying performance, [θ], as defined by Item Response
> Theory (IRT) models to background membership, y, through the parameters Γ and Σ … Estimates of Γ
> and Σ are calculated using marginal maximum likelihood methods, that integrate out the individual
> student underlying performance."
> — https://nces.ed.gov/nationsreportcard/tdw/analysis/est_estimate.aspx (fetched 2026-09-02)

**VERIFIED**, with a terminology note for anyone following the citation: the older literature calls
this **conditioning**, and current NCES documentation calls it the **population-structure model** in
a latent regression. The old `scaling_cond.aspx` page is a 404 today. Both names are used below and
they mean the same model.

For AILX that means, when we have the data for it:

- **An IRT measurement model** over the item responses. T2 items are binary and 2PL/3PL-shaped. The
  T3 planted-error opportunities are binary within a scenario, with the scenario as a testlet.
  Ignoring the testlet would overstate the information each opportunity carries.
- **A conditioning model** regressing latent proficiency on the panel's background variables and the
  design variables (block assignment, device class, country, language of administration).
- **Draws from the posterior**, one set per respondent.

**Two AILX-specific warnings.** First, the conditioning model must contain **every variable that
will later be crossed with the statistic**, or those crossings are biased toward zero. A "secondary
analyst finds no gap" result is then a property of our model, not of the population. Second, T2's
distribution has a documented lump at chance in a general population (`docs/TRACK-REVIEW.md` §2.1),
and a floor pile-up is exactly what strains an IRT fit. For that reason `docs/TREND-FORM.md` §4.2
already chose **chained equipercentile** over an IRT method for equating. The two choices must not
drift apart. If IRT cannot fit T2 well enough to condition on, then plausible values for the T2
subscale are not available either, and the T2 rate stays a design-based rate.

### 4.4 How many, and what a user of the published figures may do

- **Twenty plausible values per respondent per subscale. DECLARED, copying NAEP's number.** An
  earlier draft of this section said five, the classic literature's figure, which is out of date:
  NCES draws twenty. "These three steps are repeated twenty times producing twenty sets of
  plausible values for all sampled respondents"
  (https://nces.ed.gov/nationsreportcard/tdw/analysis/est_pv_creation.aspx, fetched 2026-09-02).
  **VERIFIED.** Twenty draws cost nothing at our n. Matching the reference implementation also means
  a secondary analyst's NAEP-shaped code runs on our files unchanged.
- **A user must run their analysis five times, once per plausible value, and combine the five
  results with Rubin's rules**. The estimate is the mean of the five. The standard error combines
  the average sampling variance with the between-draw imputation variance. Any analysis that touches
  one plausible value only is wrong, and its standard error is too small.
- **A user must use the replicate weights for the sampling variance.** The two variances are
  computed separately and added. A single "just use the weights" pass understates both.
- **A user may not treat a plausible value as a person's score, and may not average a person's
  twenty draws into one.** NCES says both halves plainly:

  > "The twenty sets of plausible values are not test scores for individuals in the usual sense …
  > These distributional draws from the predictive conditional distributions are offered only as
  > intermediary computations for calculating estimates of population characteristics. Using
  > averages of the twenty plausible values attached to a student's file is inadequate to calculate
  > group summary statistics such as proportions above a certain level or to determine whether group
  > means differ from one another."
  > — https://nces.ed.gov/nationsreportcard/tdw/analysis/est_pv_individual.aspx (fetched 2026-09-02)

  **VERIFIED.** The average is a shrunken point estimate whose spread is too narrow. That is the
  error §4.1 exists to avoid.
- **A user may not compare a plausible value to a candidate's credential score.** Different form,
  different construct coverage, different scale (§5.2).

### 4.5 What we cannot do today, said plainly

**AILX has no IRT model, no calibrated item parameters, and therefore no plausible values.** Nothing
in this repository or the exam service fits one. What exists is a scoring pipeline that computes
sensitivity, criterion, calibration and reliance rates by arithmetic from stored responses.

What that means for wave 1:

1. **Wave 1 publishes design-based estimates**: weighted percentages correct and weighted reliance
   rates with replicate-weight standard errors, per block, with the block's effective n printed
   beside each figure. That is a defensible statistic and it needs no measurement model at all.
2. **Item calibration comes from Track A first.** `docs/SAMPLING.md` §2 already assigns item
   calibration to the self-selected web cohort. A calibration fitted on Track A must be checked for
   DIF against the panel before it conditions panel data. The two populations differ in the ways
   that move item parameters.
3. **Plausible values are a wave-2 deliverable at the earliest**, contingent on (a) a fitted IRT
   model that survives the floor pile-up, (b) an agreed conditioning model, (c) an external
   psychometric review of both. Costed in §7.
4. **Until then no percentile, no "share above a cut" and no proficiency band is published**, because
   those are the statistics that need the measurement model. Rates and rate differences are.

The short version: **the design is matrix-sampled today, and it will be plausible-valued later;
publishing band percentages before then would be inventing precision.**

---

## 5. The links

The issue that asked for this document says the short form is "linked to the full sitting through an
anchor block". That is one sentence covering three different links with three different designs.
Only one of them uses the anchor. `docs/TREND-FORM.md` §4.1 makes the same split for equating, and
this section applies the same discipline to the short form.

### 5.1 Link 1 — form to form inside the panel. The anchor core, and it is not equating

All sixteen forms carry Block A, the 32-item frozen anchor core. It is the common set that puts the
sixteen forms on one footing. `docs/TREND-FORM.md` §4.1 already names this: "the panel short
form is matrix-sampled, so different respondents see different operational blocks and the anchor core
is what they have in common."

- **32 common items clears every published floor with margin.** Angoff's rule of thumb is 20 items
  or 20% of the form, whichever is larger. Kolen & Brennan's is 20% of a test of 40+ items.
  `docs/TREND-FORM.md` §4.2 records that both quotations are second-hand, and which one is commonly
  misattributed. That qualification carries over here unchanged.
- **No equating is needed for link 1**, because the block is identical in content, order, exposure
  and renderer across all sixteen forms. There is nothing to transform.
- **What the common block buys** is the ability to test whether the sixteen groups differ in ability
  before their block-level rates are compared. If they do — a randomisation failure, or differential
  break-off by form — the anchor core is the instrument that detects it.

### 5.2 Link 2 — short form to the full sitting. Operational common items, and it is NOT an equating

**The anchor cannot serve this link, and saying so is the correction this document makes to the
issue.** `docs/TREND-FORM.md` §2.2 makes the anchor panel-only and Track A never sees it. A block
that appears in only one of the two things you want to link cannot link them.

What does appear in both is the **operational T2 link block**. It is 20 items per form, drawn from
the same operational deck a credential candidate sits, in four rotations covering 80 of the 120
items. That gives 20 common items per respondent and 80 across the design.

**And it is still not an equating.** Of the five requirements Dorans, Moses & Eignor (2010) restate
for a linking to be an equating (quoted in full in `docs/TREND-FORM.md` §4.3), this design fails the
first and the second outright:

- **Equal construct.** The short form has no T1, no T4 and no written analysis. It is not a shorter
  measure of the same thing; it is a measure of less.
- **Equal reliability.** 20 operational items against 120, and one reliance scenario against a
  90-minute track.

Stated honestly: **the panel form and the credential form are linked at the item level and are not
on a common score scale.** The common items support three things and no more.

1. **Comparability checking.** Item-level DIF between panel respondents and Track A candidates on the
   80 shared items, which tells us whether the two populations answer the same item the same way.
2. **A calibration path.** If an IRT model is ever fitted (§4.5), the shared items are the bridge
   that puts panel and Track A item parameters in one calibration.
3. **A sanity check on the panel's operational rate**, reported as a rate on 20 items with its
   interval, never as "the panel's AILX score".

**What breaks this link:** re-versioning the operational deck between the credential form and the
panel wave, which changes the items under the common set. Or a leak of the operational deck, which
changes what the items measure. Or any change to exposure time, item order or renderer, because
`docs/TREND-FORM.md` §5.3 makes the renderer part of the instrument. The link block is therefore
frozen for the duration of a wave, and its item ids are stored with every response.

### 5.3 Link 3 — short form to the trend form. There is nothing to link

The trend form **is** Block A of the short form. Same items, same order, same exposure, same
administration, in the same sitting. The panel wave is not linked to the trend line; it *is* the
trend line's fielding. This design must respect `docs/TREND-FORM.md` §1.1's budget, and it does: one
administration per respondent, and the 12,000-per-cycle exposure budget bounds how many panel
completes may see it. **At n = 2,000 per country, four countries, that is 8,000 of the 12,000 in one
wave.** A second wave inside the same cycle would breach the budget. That is a real constraint on how
often a country may be re-fielded, and the fielding plan must say so.

---

## 6. What this design cannot deliver

Said here, before a reviewer says it.

1. **No individual score, ever.** Not from a plausible value (§4.4), not from a block rate, not from
   the anchor core (`docs/TREND-FORM.md` §1.3: 33 items gives ±0.17 at p = 0.5 for one person). The
   panel form issues no report, no band and no certificate, and the respondent sees no result.
2. **No composite.** T1 and T4 are absent, the T3 essay is absent, and the spec's weights are for a
   four-track instrument (§2.3). There is no national AILX score and there will not be one from this
   form.
3. **Nothing that needs the judge.** Analysis quality, rubric bands, T4 brief compliance and every
   other judged component are outside the population statistic by construction (§2.2).
4. **No T1 statement of any kind.** Not a reduced one, not a gate-only one. `docs/SAMPLING.md` §5's
   option (a) is rejected in §2.1.
5. **No percentiles, no proficiency bands, no "share above a cut" — until an IRT model exists**
   (§4.5). Wave 1 publishes rates and rate differences.
6. **No cross-national comparison in wave 1 beyond what DIF screening survives.** Population
   invariance is one of the five equating requirements, and `docs/TREND-FORM.md` §4.4 already commits
   to DIF screening across en/ja/ko before any cross-country statement.
7. **No trend from wave 1.** One wave is a level. The trend needs a second fielding of the frozen
   line.
8. **No claim about the offline population.** Unchanged from `docs/SAMPLING.md` §7, and a short form
   does not improve it.
9. **No mobile-population estimate**, because the form is device-locked to desktop/laptop by default
   (`docs/SAMPLING.md` §6). That lock is a coverage gap with a size, and it is published as one.

---

## 7. Cost and timeline to a first fielding

All figures are **ESTIMATE** unless marked. They are built on `docs/SAMPLING.md` §13, which is
itself built on one published rate card plus market judgement. Every one must be replaced by a real
quote before commitment. **Assumptions are named at the end of the section.** Changing any of them
changes the number.

### 7.1 The build

| Line | Estimate | Note |
|---|---|---|
| Short-form runner: block assignment, rotation, storage of form ids, device lock, telemetry | $40–80k | The lower half of `docs/SAMPLING.md` §13.2's $60–120k line, because T1 and T4 are out and the essay is out, so there is no artefact upload, no rater pool and no judge queue to build. |
| Four T3 reliance scenarios, authored and piloted | $30–60k | Four source documents with 8–12 planted errors each, per language. `docs/TREND-FORM.md` §6 costs items at roughly 3 drafted per 1 shipped; apply the same survival rate. |
| Operational T2 link blocks | ~$0 | Existing items, existing renderer. |
| Frozen anchor core | already costed | `docs/TREND-FORM.md` §6: 56 authored units, once. |
| **Build total** | **$70–140k** | One time, then maintenance. |

### 7.2 Wave 0: the length experiment, which is the cheapest thing here

`docs/SAMPLING.md` §5 says the tolerable length is an **UNKNOWN**, to be settled by a randomised
experiment rather than by assertion. §1.2 above says why our 53 minutes is an argument rather than
evidence. Wave 0 settles it.

- **Three randomised length arms — about 35, 45 and 53 minutes.** Each arm drops blocks in the §1.5
  shed order, so every arm is a form we could field.
- **Block order randomised within arm**, to price the "anchor first" decision in §1.4.
- **n ≈ 300 per arm, 900 total.** At `docs/SAMPLING.md` §8.2's US planning range that is
  **$45–120k** of fieldwork, plus analysis.
- **Outcomes: break-off by arm and by block, completion rate, and the performance difference between
  completers and break-offs.** The last one is the one that matters. It prices the bias §1.2 warns
  about instead of assuming it.
- **NAEP's own reporting floor is a useful sanity check on the arm size:** NCES's "rule of 62"
  suppresses a group statistic based on fewer than 62 students, for 0.80 power against a 0.5 SD
  effect at a design effect of 2 (https://nces.ed.gov/nationsreportcard/glossary.aspx, fetched
  2026-09-02). **VERIFIED.** 300 per arm is comfortably above it. A fourth arm at 150 would not be.

**This experiment should run before the wave-1 contract is signed**, because its result can change
the form. A form change after contracting is a change order.

### 7.3 Wave 1 fieldwork

Unchanged from `docs/SAMPLING.md` §13: option B, US + UK at n = 2,000 each, **$0.8–1.2M** all in.
The short form does not make fieldwork cheaper per complete. The per-minute rate is why it is a
short form. It does make the complete *achievable*, which is the point. A 4h 20m sitting has no
price because no vendor will field it.

Two lines from `docs/SAMPLING.md` §13.2 fall away because of what §2 cut:

- **LLM judging at panel scale: $10–30k → $0.** No judge is in the panel path.
- **T1 rater panel: not costed there and not needed here.** T1 is out.

One line grows. The **sampling and weighting contractor** ($80–150k) now also owns the
plausible-value scaling when it exists. `docs/SAMPLING.md` §13.2's "nobody marks their own homework"
rule applies to it more strongly than to the weights.

### 7.4 Timeline

| Phase | Duration | Depends on |
|---|---|---|
| Short-form runner and scenario authoring | 3–4 months | Engineering, item authors, one language |
| Wave-0 length experiment, fielded and analysed | 6–10 weeks | A panel vendor willing to field 900 cases; the runner |
| Contract and instrument review with the vendor and the advisory board | 4–8 weeks | Wave-0 result, external psychometric review |
| Wave-1 fieldwork, US + UK | 8–12 weeks | Contract |
| Weighting, NRBA, publication bundle | 3 months | Contractor; `docs/SAMPLING.md` §10 |
| **First published population statistic** | **12–15 months from a funded start** | All of the above, sequentially |
| Plausible values, if the IRT model fits | **wave 2** | Track A calibration, external review (§4.5) |

### 7.5 The assumptions, named

1. **One language in wave 1.** Adding ja/ko adds $30–60k of translation per country
   (`docs/SAMPLING.md` §13.2) and a DIF screen before any cross-country statement.
2. **The panel supplies profile demographics**, so the form spends 3 minutes on background rather
   than 10. If a vendor does not, the form is 7 minutes longer and §1.5 sheds a block.
3. **Desktop/laptop lock holds** (`docs/SAMPLING.md` §6). If the vendor cannot deliver a device-locked
   sample, the design changes and the device experiment moves onto the critical path.
4. **The frozen anchor exists and is authored** before wave 1. It is the one block §1.5 never sheds,
   so it is also the one that blocks the wave if it slips.
5. **Four reliance scenarios can be authored to a common difficulty.** They cannot be equated to each
   other in wave 1, because there is no common item between two scenarios. So scenario differences
   will be confounded with whoever got them. Randomisation makes that a variance, not a bias. §3.2
   is why four rather than two.
6. **No re-fielding inside a cycle**, because of the anchor's 12,000-administration budget (§5.3).

---

## 8. What the code does about this

The manifest may declare the form:

```yaml
short_form:
  id: psf-2026a
  target_minutes: 45
  blocks:
    - id: anchor-core
      minutes: 13.5
      every_respondent: true
    - id: t2-link-a
      minutes: 8.5
      family: t2-link
    - id: t2-link-b
      minutes: 8.5
      family: t2-link
    - id: t3-scenario-a
      minutes: 20
      family: t3-scenario
    - id: t3-scenario-b
      minutes: 20
      family: t3-scenario
```

Two rotated **families**, and a respondent takes one block from each. That is what makes four T2 link
blocks and four T3 scenarios sixteen forms rather than eight (§3.1). The example shows two members
per family. The real form has four in each.

`target_minutes` is the **testing** budget, not the 53 minutes of §1.3. Consent, instructions, the
warm-up, the background items and the debrief are not blocks, and are not declared here. This
design's blocks cost 42 minutes on the longest path, 13.5 + 8.5 + 20, inside a declared 45. The
canary probe is not declared either. It goes to one respondent in eight and is a leak probe, not a
design factor (§3.3). So §1.3 counts its 3.5 minutes and the manifest does not.

`packages/content-tools` validates it in `parseManifest`, in the same style as the `anchor` block.
Three rules are enforced rather than documented, because they are the three that a fielding cannot
recover from:

- **At least one `every_respondent` block.** That is the common set of §5.1. A matrix design without
  one is sixteen unlinked short tests.
- **Every rotated family has at least two members**, or that family rotates nothing and the word
  "matrix" is decoration. A rotated block must name its family. A common block may not have one.
- **The longest respondent path fits `target_minutes`** — every common block plus the longest member
  of **each** family. Summing all rotated blocks would reject a legal design. Taking one maximum
  across all of them would let a two-family form overrun in silence. A form that overruns does not
  fail loudly at fielding. It fails as break-off, and break-off costs low scorers first
  (`docs/SAMPLING.md` §8.3).

Unknown keys are rejected on the form and on a block, so a misspelled `minutes` cannot drop a block
out of the budget in silence. What the code does **not** do: assign a respondent to a block, sample
anything, count exposure, hold the item-to-block mapping, or link anything. `content-tools` reads
content and never sees a sitting.
Rotation and assignment belong to the exam service in the private repo. **No sampler, no IRT model
and no plausible-value generator is being built by this document**, and §4.5 says why the last two
cannot be built yet.

A redacted package may declare a short form, because a block structure is not marking material. It
still may not declare an `anchor`, so a redacted package's short form cannot carry the trend block.
That rule is already enforced and needed no change.

---

## 9. Decisions taken in this document

1. The panel form is **53 minutes**, one session, no untimed window, no modularisation.
2. **T1 and T4 are out of the population statistic.** `docs/SAMPLING.md` §5's option (a), a
   reduced-scope T1 build for a random third, is **rejected**. Option (b) is adopted, and the
   exclusion is stated in the headline.
3. The T3 written analysis and its judge are out. The model-free planted-error block stays.
4. **No LLM judge and no rater panel is in the panel path at all.**
5. Sixteen forms: one common anchor block, four operational T2 link blocks, four T3 reliance
   scenarios. One rotation from each family per respondent.
6. Assignment is randomised within panel strata and **stored, not inferred**.
7. The two surviving rates are reported as **two named subscales, never averaged**.
8. **Twenty plausible values**, copying NAEP, **when a measurement model exists**. Wave 1 publishes
   design-based rates with replicate standard errors and no bands or percentiles.
9. The short form and the credential form are **linked at the item level and not equated**. The
   anchor cannot carry that link, because it is panel-only.
10. The shed order under break-off pressure is fixed in advance (§1.5). The anchor core is never
    shed.
11. A wave-0 randomised length experiment runs **before** the wave-1 contract is signed.
12. The manifest carries `short_form.id`, `target_minutes` and its blocks, grouped into rotated
    families, and the loader checks the longest respondent path against the target.

---

## 10. Open questions

1. **What length does a probability panel actually tolerate for a scored task?** UNKNOWN. §7.2 buys
   the answer. Everything in §1.3 is provisional until it lands.
2. **Does an IRT model fit T2's floor pile-up well enough to condition on?** UNKNOWN, and §4.5 says
   what depends on it.
3. **How different are four reliance scenarios in difficulty?** UNKNOWN until they are piloted. There
   is no common item between scenarios, so wave 1 cannot equate them.
4. **Does the Track A calibration transfer to the panel?** UNKNOWN. The 80 shared operational items
   are what would tell us (§5.2). DIF between a self-selected cohort and a probability panel is the
   thing most likely to break it.
5. **Is 3 minutes of background enough**, given that the conditioning model must contain every
   variable a secondary analyst will later cross with the statistic (§4.3)? Probably not, and the
   trade against testing minutes is unresolved.
6. **What does a device-locked panel cost, and can vendors deliver one at n = 2,000?** UNKNOWN;
   `docs/SAMPLING.md` §6 assumes it is possible.
7. **Does the anchor's 12,000-administration budget survive a four-country wave plus a wave-0
   experiment?** §5.3 says 8,000 of 12,000 goes in one four-country wave. The arithmetic is tight.
   Somebody should own it before fielding.
