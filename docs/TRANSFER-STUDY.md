# TRANSFER-STUDY.md — the two validation studies we have not run

Status: **design, not a commitment.** Nothing in this file is built. It exists
because the product previously claimed a training effect it had no way to
observe. The fix is not only quieter copy (`docs/PROGRESSION.md`
§2.4, `packages/report/src/practice.ts`). It is also an experiment that could
catch the effect if it is there. That experiment could show a null that means
something.

Read `Foray-Spec-2026.1.md` §13 for what practice is, and `docs/PROGRESSION.md`
for the loop this would measure.

Two studies live here. **§2 is the T2 study**: does practice move sensitivity on
generators the candidate never drilled on? **§3 is the T3 study**: do the reliance
numbers behave like the published ones, and are they stable enough to carry 160
points? They share a cohort and a pre-registration, and nothing else. §3 was added
2026-09-02 (TEN-36) after a spike found no external validity evidence for the
reliance construct; the trace is in the private repo's
`docs/EVIDENCE-CALIBRATED-RELIANCE.md`.

---

## 1. Why the question is open

Three results, and they point the same way.

1. **Geissler, Robertson & Feuerriegel**, *Designing effective digital literacy
   interventions for boosting deepfake discernment*, arXiv `2507.23492`
   (ACM DL `10.1145/3772318.3790428`). N = 1,200 US participants, five
   interventions against control, 200 per condition, **two-week follow-up**.
   Immediately: textual +7.5 pts, visual +13 pts. But **gamified 65.7%
   (p_adj = .310)** and **feedback 60.0% (p_adj = 1.000)** were
   indistinguishable from control at 61.3%. At two weeks **no arm** beat
   control. Foray's practice loop is gamified drilling with immediate feedback.
   It is assembled from the two arms that failed.
2. **Gray, Davis, Bunce, Noyes & Ritchie**, *R. Soc. Open Sci.* 12(11):250921
   (2025). The five-minute artefact training Foray modelled its families on.
   Trained typical-ability adults reached 51% accuracy. Their **d′ = −0.066,
   not different from chance** (t₆₉ = 1.092, p = .279). Untrained controls were
   *below* chance. Training removed a bias. It did not create discrimination.
   The design is between-subjects, so nobody in it was measured improving.
3. **Diel et al. (2024)** meta-analysis, k = 137, 56 papers, N = 86,155.
   Pooled deepfake-detection accuracy 55.5% [48.9, 62.1], with **pooled d′ not
   different from chance**. The asymmetry is large: people are much better on
   *real* stimuli. Accuracy in this field is a criterion statistic wearing an
   ability statistic's clothes.

**The failure mode this design exists to prevent.** Training that moves the
criterion without moving sensitivity makes a person readier to say "AI" while
leaving them as unable to tell as before. Their raw accuracy on an AI-heavy set
goes up. Their real-world discrimination does not. Their confidence does. That
is worse than no intervention. It is also invisible to any measure that reports
one number. So **d′ and c are reported apart, always, in the same table.**

---

## 2. The T2 design — does discrimination transfer?

### 2.1 Construct and primary outcome

- **Task.** Single-stimulus yes/no: "photograph or AI-generated?", the same
  call the drill and T2 make. **Not 2AFC.** Mai et al. (PLOS ONE 18(8):
  e0285333) measured side-by-side framing inflating scores by ~15 points. So a
  paired item and a single item are not the same measurement.
- **Primary outcome:** change in **sensitivity d′** on **held-out generators**,
  intervention vs control.
- **Reported beside it, never merged into it:** change in **criterion c**.
  A pre-registered table with `d′_pre, d′_post, Δd′, c_pre, c_post, Δc` per
  arm. A summary sentence that gives Δd′ without Δc is a protocol violation.
- d′ and c use the **log-linear correction** (Hautus 1995: add 0.5 to hits and
  false alarms, 1 to each total) so perfect or empty cells do not become
  infinities. Stated in advance because choosing it after seeing the data is a
  researcher degree of freedom.

### 2.2 Held-out generators — the part that makes it a transfer test

Partition the image sources into three **disjoint generator sets**:

| set | what is in it | who ever sees it |
|---|---|---|
| **P — practised** | the generators behind the practice corpus | the drill |
| **H — held out** | generators never used in practice, and never in the scored bank | pre/post measurement only |
| **O — operational** | the scored T2 bank | the sitting only |

The primary outcome is measured on **H alone**. Measuring on P would measure
memorisation of a 28-image corpus, which is what the current practice-accuracy
number on `/progress` partly is (`PRACTICE_ACCURACY_CAVEAT`).

A **P-subset is measured too, as a manipulation check, and reported separately**.
If Δd′ on P is large and Δd′ on H is zero, the drill taught a decoder's
fingerprint rather than an artefact family. That is the outcome the
artefact-family framing predicts should *not* happen. It is therefore the
sharpest available test of the framing. Kramer et al.'s result (no training
effect once obvious artefacts are removed) says to expect this.

**H must be re-drawn every year.** Deepfake-Eval-2024 (arXiv `2503.02857`)
found detector AUC dropping ~45–50% on in-the-wild 2024 media versus academic
benchmarks. A generator set fixed in 2026 is measuring 2026.

### 2.3 Assignment and control

- Randomise at the **first practice round**, before any card is dealt, on a
  server-generated assignment. Stratify by pre-test d′ band and by locale.
- **Three arms**, not two:
  - **drill** — the product as it ships;
  - **active control** — the same time budget spent on plain textual + visual
    instruction. These are the arms that *did* work immediately in Geissler,
    so they are the honest comparator. The question is not "is the drill better
    than nothing". It is "is the fun version worse than a paragraph";
  - **no-practice control** — pre and post only.
- Intention-to-treat on assignment. Dose (rounds completed, days practised) is
  a **pre-specified covariate**, never a re-grouping after the fact. Dose is
  self-selected. A dose-response analysis is therefore observational, and must
  be labelled as such.

### 2.4 Timing

`t0` pre-test → practice window (14 days) → `t1` immediate post → **`t2` at
14 days** with no practice in between → **`t3` at 56 days**.

`t2` matches Geissler's follow-up so the results are comparable. `t3` exists
because nobody in this literature has measured beyond two weeks. Foray's whole
annual-re-sitting story is a durability claim.

### 2.5 Trial counts and power

- **≥ 100 trials per measurement occasion**, 50% signal, balanced across
  generator families. Below ~60 trials the standard error on d′ is wide enough
  to hide the effect sizes at stake.
- Item sets at `t0`/`t1`/`t2`/`t3` are **counterbalanced parallel forms** from
  H, rotated per participant, so re-testing does not measure item memory.
- **Power.** To detect a between-arm difference of Cohen's d = 0.30 in Δd′ at
  80% power, α = .05 two-sided: **≈ 176 per arm**, so ≈ 530 with three arms.
  Recruit to 650 for attrition. Geissler used 200/condition for a similar
  effect band; matching that is the minimum defensible.

### 2.6 Making a null mean something

A non-significant result is not evidence of absence. The analysis plan
therefore includes **equivalence testing (TOST)** against a pre-registered
smallest effect size of interest. Δd′ = 0.20 is the proposal, on the argument
that anything smaller cannot justify a product claim. That gives three
publishable outcomes rather than two: it works, it is equivalent to control, or
it is inconclusive.

Pre-register the protocol and the analysis code before `t0` data exists.

### 2.7 Confounds that will otherwise eat the result

- **Effort.** Wise & DeMars: motivated examinees outperform less motivated ones
  by ~0.58 SD, larger than any effect we are looking for. Log per-item response
  time, set a rapid-guess threshold **per item type in advance**, publish the
  flag rate per arm, and pre-commit to the exclusion rule.
- **Self-selection.** A viral practice population is not a norming population.
  This study is recruited independently of the share-card surface, and its
  cohort is never pooled into any published population statistic.
- **Confidence.** Collect it (0–100, as T2 does) and report calibration
  separately. The "worse than nothing" failure is a confidence effect. A study
  that does not measure confidence cannot detect it.
- **Practice contamination of the scored sitting.** Hausknecht et al. (2007;
  50 studies, N = 134,436) put retest/practice effects at d = 0.26, larger with
  identical forms plus coaching. Keeping O disjoint from P and H is what stops
  this study from being the thing that breaks the instrument.

### 2.8 What has to be logged

Per trial: stimulus id, generator set (P/H/O), generator family, artefact
family, response, response time, confidence, arm, occasion. Practice rounds
already record most of this. **None of it is a scored input.** The
frontend/backend split in `AGENTS.md` keeps it that way. This is practice
telemetry, and it never reaches `score()`.

---

## 3. The T3 design — does the reliance measure mean anything?

T3 carries 160 points and .40 of the composite on a construct with no external
validity evidence and no reliability figure (spec §T3, "What this track cannot
claim"). This section is the smallest study that would change that. It is
additive. It reuses the same recruitment, the same pre-registration and the same
`t0`/`t2` spacing as §2. It changes nothing about the T2 arms.

**Sample size has its own arithmetic here.** §2.5's n = 176 per arm is powered
for a between-arm difference in Δd′, which is a different quantity from an ICC
or a correlation. §3.8 runs the estimates §3 needs: the ICC(2,1) in §3.2, the
event count in §3.3, the correlation in §3.1 and the timed/untimed allocation
in §3.5. It keeps the simulation that produced them in
`research/transfer_study_power.py`. They are estimates under stated
assumptions, not a commitment to a number.

### 3.1 A two-stage block, so RAIR and RSR can actually be computed

The centrepiece. Without it the published statistics cannot be computed at all.

Schemmer et al.'s RAIR and RSR (IUI '23, doi:10.1145/3581641.3584066) condition
on an **independent first answer**: RAIR is switching to correct advice given the
person was initially wrong, RSR is holding a correct answer against incorrect
advice. The shipped T3 has no first stage, so it can report over- and
under-reliance (Passi & Vorvoreanu, MSR-TR-2022-12) and nothing stronger.

The block fixes that for the study only:

- A **sub-form of the T3 sitting** in which each seeded claim is presented first
  as a question. The candidate commits an answer and a confidence (0–100) before
  the assistant speaks. The assistant then advises: correct on half the claims,
  seeded-wrong on the other half, randomised per candidate.
- **The two blocks share no claim, and the two-stage block runs second.** Running
  it first would teach the candidate that the assistant lies before the ordinary
  block measures whether they notice. Block order is fixed rather than
  counterbalanced for that reason. The order is a stated limit of the
  correlation in the next point.
- From that block, compute **RAIR and RSR to the published definitions**, and the
  Appropriateness-of-Reliance tuple. Report the tuple, never a difference.
- Compute Foray's `reliance.over`, `reliance.under` and `reliance.index` on the
  **same** candidate from the ordinary block. Publish the correlations between
  the two sets, with confidence intervals. **Publish them whatever they
  are.** A low correlation is the finding, not a failure of the study.
- Pre-register the direction: `reliance.over` should track 1 − RSR, and
  `reliance.under` should track 1 − RAIR. That is the mapping asserted in the
  private repo's `docs/EVIDENCE-CALIBRATED-RELIANCE.md` §6. It has never been
  measured. If the correlations are low, the spec drops the claim that Foray's
  rates are comparable in direction to the published ones.

The block costs the candidate time and changes the task. That is why it is a
study instrument and not a shipped form. It is the only design found that lets
Foray say its numbers behave like the literature's.

### 3.2 Test–retest on parallel forms

- **Two sittings, at least 14 days apart**, matching §2.4's `t2`.
- **Disjoint planted-error sets.** No error instance appears in both sittings.
  Instances come from the same four families (misattributed figure, false causal
  claim, fabricated citation, wrong calculation) in the same counts. The forms
  are then parallel in construction and share no answer.
- Report **ICC(2,1) with 95% CI for `reliance.over`, for `reliance.under`, and
  separately for `reliance.index`.** Three coefficients, three intervals, no
  averaging.
- **The index is expected to be the worst of the three.** Difference scores are
  less reliable than their components (Hedge, Powell & Sumner, *Behav. Res.
  Methods* 50:1166–1186, 2018; Enkavi et al., *PNAS* 2019, median ICC 0.174 for
  contrast measures), and the one direct test–retest of advice taking found
  ICC < 0.5 (Karvelis et al., *PLoS ONE* 19(11):e0312255, 2024). Predicting it
  in advance is what stops it being explained away afterwards.
- Pre-commit to the consequence: **if ICC(2,1) for a reported rate is below 0.5,
  that rate is reported as a band only, and the point allocation behind it is
  reopened.**

### 3.3 Enough events per sitting for a rate to be estimable

The shipped floor is eight planted errors (`ERROR_CATCH_MIN_SURFACED`). Eight binary
events give a 95% binomial interval of about ±0.35 on a rate. That interval
cannot support an individual score.

- **≥ 20 planted errors and ≥ 20 correct-advice opportunities per sitting**, so
  the retest design accumulates ≥ 40 of each.
- Report the **binomial interval and the empirical interval side by side.** If
  they disagree, the events are not independent and the binomial one understates
  the true width.
- Add a **split-half / Spearman–Brown internal-consistency estimate at the
  achieved length**, split by error family. Then the answer is not one number
  for a mixed bag of four different tasks.

### 3.4 Convergent, discriminant and criterion evidence

Collected at `t0`, one page, no scoring impact:

- A validated self-report reliance or complacency scale (GenAI-RTS,
  arXiv:2607.14301, ω = .75–.88) and Need for Cognition. Convergence should be
  **modest**. Near 1.0 with self-report means the behavioural measure adds
  nothing a questionnaire does not already give. Near 0 with everything means it
  may be noise.
- One **criterion**: accuracy on a held-out task where an assistant is available
  and wrong on 30% of its claims. Without a criterion outside the exam, calibrated
  reliance stays a descriptive index.

### 3.5 The timer as a manipulated factor, not a fixed backdrop

This is what TEN-30 needs before the report may say "under time pressure".

- **Timed and untimed arms, presentation held constant.** Same document, same
  assistant, same planted-error set and salience, same turn order. The timer is
  the only thing that moves.
- Randomise at assignment, stratified as in §2.3.
- Report the effect on `reliance.over`, on `reliance.under` and on completion,
  with effect sizes and intervals. The one published test of this found the
  **rate** of error adoption unchanged (p = 0.19) and only the severity raised.
  So a null on rate is the expected result, and it must be publishable as one.
- Until this runs, every "under time pressure" sentence describes this form and
  not the construct, because the timer and the interface vary together.

### 3.6 Form-parameter sensitivity, pre-registered

Over-reliance moves with task difficulty and payoff (Vasconcelos et al.,
arXiv:2212.06823) and with **when** the assistant speaks (Swaroop et al.,
arXiv:2306.07458). Vary planted-error salience and assistant-presentation timing
across forms, and report how much of the index's variance is form rather than
candidate. If form variance dominates, the index is a property of the exam.

### 3.7 Judge validation: Spearman beside QWK

The 45 analysis-quality points route to a jury (spec §T3, "Score allocation";
the evidence is in §04). Whenever that jury is
validated against a human panel, **report Spearman ρ next to QWK, both with
intervals.** Distribution calibration can match the human score distribution
while carrying almost no rank information (Yeadon et al., arXiv:2603.14732).
QWK alone cannot tell the two apart. Report the human–human agreement measured
on the same panel in the same table. A judge coefficient without its human
comparator cannot be read. Pin and record the judge version with every
coefficient.

### 3.8 How big does this have to be

Open research, not a decision. §3 named sample size as the gap; this fills it
with estimates and keeps the code that produced them. Every number below comes
from `research/transfer_study_power.py`, a Monte Carlo simulation (Python,
numpy and scipy, 2000 replicates, seed 20260902). Re-run it with
`uv run research/transfer_study_power.py`. It is analysis, outside the pnpm
workspace, and no test or build gate in this repo runs it. Every n is
conditional on the assumption set printed beside it. §3.8.7 lists what would
move it.

**Why simulate rather than use a formula.** `reliance.index` is a difference of
two proportions measured on the same candidate from two disjoint event pools.
Its sampling variance carries both pools' noise. Its true variance depends on
how the two traits and the two sitting-level shocks covary in the population.
Nobody has measured those quantities. A closed-form power calculation has to
assume those covariances away. The simulation varies them instead. §3.8.5 shows
the answer moving with them.

**The model.** For candidate *i* at sitting *t*,
`logit(p) = a + b[i] + s[i,t]`, where `b` is the stable trait and `s` is
sitting-level state noise. The latent reliability `var(b)/(var(b)+var(s))` is
the "true latent ICC" column. It is the reliability of the trait, which is what
an unlimited form would measure. The intercept `a` is solved numerically so the
quoted mean rate is the population MEAN, not the conditional median. For a
logistic model those differ. Counts are then drawn beta-binomially with a
within-sitting event correlation `rho_event`. Buçinca, Malaya & Gajos
(CSCW 2021) found people "develop general heuristics about whether and when to
follow the AI suggestions" rather than judging each item. So planted errors are
not independent trials. `rho_event = 0` is the plain binomial and is reported
as the optimistic bound. `index` is `under − over`, as in
`packages/tracks/t3-reasoning/src/scoring.ts`.

Standing assumptions: mean over-reliance 0.40, mean under-reliance 0.20, 20
planted errors and 20 correct-advice events per sitting (§3.3), two sittings 14
days apart, `rho_event = 0.10`, trait correlation 0, state correlation 0. Each
is varied below.

#### 3.8.1 Candidates for a usable ICC(2,1)

The pre-commitment in §3.2 is a threshold: below ICC 0.5 a rate is reported as
a band and its point allocation is reopened. So the question is not "what is
the point estimate" but "how many candidates put the interval on one side of
0.5". Those are two different prices.

| events/sitting | true latent ICC | measure | observed ICC | n for CI width ≤ 0.30 | n to rule 0.5 OUT | n to rule 0.5 IN |
|---|---|---|---|---|---|---|
| 20 | 0.3 | `reliance.over` | 0.17 | 200 | 75 | > 1200 |
| 20 | 0.3 | `reliance.under` | 0.15 | 200 | 75 | > 1200 |
| 20 | 0.3 | `reliance.index` | 0.17 | 200 | 75 | > 1200 |
| 20 | 0.5 | `reliance.over` | 0.28 | 150 | 150 | > 1200 |
| 20 | 0.5 | `reliance.under` | 0.24 | 200 | 100 | > 1200 |
| 20 | 0.5 | `reliance.index` | 0.26 | 150 | 150 | > 1200 |
| 20 | 0.7 | `reliance.over` | 0.40 | 150 | 600 | > 1200 |
| 20 | 0.7 | `reliance.under` | 0.34 | 150 | 300 | > 1200 |
| 20 | 0.7 | `reliance.index` | 0.37 | 150 | 400 | > 1200 |
| 97 | 0.3 | `reliance.over` | 0.19 | 200 | 75 | > 1200 |
| 97 | 0.3 | `reliance.index` | 0.18 | 200 | 75 | > 1200 |
| 97 | 0.5 | `reliance.over` | 0.32 | 150 | 200 | > 1200 |
| 97 | 0.5 | `reliance.index` | 0.30 | 150 | 150 | > 1200 |
| 97 | 0.7 | `reliance.over` | 0.45 | 150 | > 1200 | > 1200 |
| 97 | 0.7 | `reliance.index` | 0.43 | 150 | 1200 | > 1200 |

"Observed ICC" is the coefficient a very large study of this design would
report, computed on a simulated population of 4000. It is not an average of
small-sample estimates. "Rule OUT" is the smallest n at which the 95% CI upper
bound falls below 0.5 in 80% of simulated studies. The mirror of it, "rule IN",
is the same for the lower bound above 0.5. The script prints all 45 rows, including the
40-event set.

Three things fall out.

- **150 to 200 candidates buy a reportable coefficient** — CI width ≤ 0.30 —
  and the width barely depends on the ICC's size. That is the cheap part.
- **Refuting 0.5 is affordable; showing the measure clears it is not.** If the
  latent reliability is what Karvelis et al. (2024) measured for advice taking
  (ICC < 0.5), 75 to 150 candidates put the whole interval below the line. If
  the latent reliability were 0.7, no sample size up to 1200 puts the interval
  above it. Measurement noise caps the *observed* coefficient at 0.40 on a
  20-event form and 0.45 at 97 events. Under these assumptions the study can
  find the measure wanting. It cannot show the reported coefficient clears
  0.5.
- **More events help less than they look.** Going from 20 to 97 planted errors
  moves the observed ICC from 0.28 to 0.32 at a latent 0.5. Sitting-level state
  noise, not binomial noise, is the binding constraint. A longer form does not
  touch it.

#### 3.8.2 Planted errors per sitting

§3.3 quotes ±0.35 at 8 events. That is the Wald half-width. Wilson is narrower
and is what a study should report. Two estimands are in play and they are not
the same question. Against the **sitting's own propensity**, only binomial
noise intervenes, and a Wilson interval at the event count is right. Against
the **candidate's stable rate**, the sitting's propensity moves around it
whenever events correlate within a sitting. That movement is error too. The
`rho` columns are the second estimand: a Wilson interval widened by the design
effect `1 + (m−1)·rho`, the empirical half-width of (observed rate − the
candidate's rate), and the coverage the widened interval achieves.

| planted errors | ± Wald | ± Wilson (sitting propensity) | rho .10: ± formula | rho .10: ± empirical | rho .10: coverage | rho .20: ± empirical | rho .20: coverage |
|---|---|---|---|---|---|---|---|
| 8 (`RSR_MIN_SURFACED`) | 0.346 | 0.285 | 0.335 | 0.375 | 0.96 | 0.500 | 1.00 |
| 12 | 0.283 | 0.246 | 0.317 | 0.417 | 0.93 | 0.500 | 1.00 |
| 16 | 0.245 | 0.220 | 0.306 | 0.375 | 0.97 | 0.438 | 0.97 |
| 20 (§3.3 floor) | 0.219 | 0.201 | 0.299 | 0.350 | 0.96 | 0.450 | 0.98 |
| 30 | 0.179 | 0.168 | 0.289 | 0.333 | 0.96 | 0.433 | 0.97 |
| 40 | 0.155 | 0.148 | 0.283 | 0.325 | 0.96 | 0.425 | 0.98 |
| 60 | 0.127 | 0.123 | 0.277 | 0.317 | 0.95 | 0.417 | 0.98 |
| 97 | 0.100 | 0.098 | 0.272 | 0.314 | 0.95 | 0.418 | 0.98 |
| 150 | 0.080 | 0.079 | 0.269 | 0.310 | 0.96 | 0.413 | 0.98 |

**If the events are independent, the curve stops being embarrassing at 40
events (±0.15) and reaches ±0.10 at 97**, which matches the 97 in the private
repo's `docs/EVIDENCE-CALIBRATED-RELIANCE.md` §3. **If they are not, no event
count fixes it.** At `rho_event = 0.10` the formula width floors near ±0.27 and
the empirical width near ±0.31: 150 events buy 0.310 against 20 events' 0.350.
A longer form measures the same habit more times.

The widened interval covers at 0.93 to 0.97 at `rho = 0.10`, and is
conservative at `rho = 0.20`. So it is a usable approximation once the
dependence is known. The dependence itself is not known. That is why §3.3 asks
for the binomial and empirical intervals side by side. A gap between them is
the evidence that the events are not independent. Its size is what a pilot
should use to estimate `rho_event`.

#### 3.8.3 Correlating over/under against RAIR and RSR

The two-stage block (§3.1) gives RAIR and RSR on the same candidate. Both sides
of that correlation are unreliable, so the observable correlation is the true
one attenuated: `r_obs = r_true · sqrt(rel_Foray · rel_RAIR)`.

| true construct r | reliability of each | observable r | n for CI half-width ≤ 0.15 | n for CI lower bound > 0.20 |
|---|---|---|---|---|
| 0.3 | 0.4 | 0.12 | 200 | > 1200 |
| 0.3 | 0.6 | 0.18 | 200 | > 1200 |
| 0.5 | 0.4 | 0.20 | 200 | > 1200 |
| 0.5 | 0.6 | 0.30 | 150 | 800 |
| 0.7 | 0.4 | 0.28 | 150 | 1200 |
| 0.7 | 0.6 | 0.42 | 150 | 150 |

150 to 200 candidates report the correlation with a ±0.15 interval, which is
enough to publish it and enough to see a near-zero result. Putting the lower
bound above 0.20 needs 800 or more unless both measures are more reliable than
anything in this literature. The pre-registered direction in §3.1 is therefore
a descriptive result with an interval, not a test the study can pass.

#### 3.8.4 Timed versus untimed arms

The only published effect is Rosbach et al., MELBA 2026 (arXiv:2603.11821):
weight of advice 0.48 without a timer and 0.54 with a 10-second countdown,
SD 0.13, t(27) = 2.55, p = .017, paired, 28 pathologists. Two things do not
transfer. The simulation states them rather than assuming them away. The
outcome there is a weight of advice, not the error-adoption *rate* that
`reliance.over` counts. And a paired effect is not a between-subject effect,
while §3.5's arms are between-subject. So the assumed effect is a shift in the
mean rate from 0.48, with the between-candidate SD taken from that paper (0.13)
and from a wider alternative (0.20). The simulated marginal mean and SD are
solved for. The realised values are printed beside every requirement.

| shift in mean rate | between-candidate SD | events/sitting | rho_event | n per arm |
|---|---|---|---|---|
| +0.06 | 0.13 | 8 | 0.10 | 300 |
| +0.06 | 0.13 | 20 | 0.00 | 150 |
| +0.06 | 0.13 | 20 | 0.10 | 250 |
| +0.06 | 0.13 | 40 | 0.10 | 200 |
| +0.06 | 0.20 | 20 | 0.10 | 350 |
| +0.03 | 0.13 | 20 | 0.10 | 1000 |
| +0.03 | 0.20 | 20 | 0.10 | 1400 |
| +0.03 | 0.20 | 40 | 0.10 | 1400 |

250 per arm at 20 events and the published effect, so about 500 candidates for
the timed factor. That fits inside §2.5's 530. Crossing the timer with the T2
arms is affordable, and a third standalone study is not needed.

**The assumed effect is borrowed and may be too large.** The same group's
earlier study (arXiv:2411.00998) found the *rate* of error adoption unmoved
under time pressure (p = 0.19, interaction p = 0.46) with only its severity
raised. At half the borrowed effect the study needs 1000 to 1400 per arm. So a
null in §3.5 must be reported as "not powered below a 0.06 shift", never as
"the timer does nothing". The TOST logic of §2.6 applies here too.

#### 3.8.5 What the index costs against its components

This is the one place where the simulation qualifies the expectation §3.2 sets
out. A difference score's reliability depends on the covariance of the two
traits *and* on the covariance of the two error terms, so both are varied.

| true latent ICC | trait corr | state corr | ICC over | ICC under | ICC index | CI width, over | CI width, index |
|---|---|---|---|---|---|---|---|
| 0.4 | −0.3 | 0.0 | 0.22 | 0.20 | 0.24 | 0.26 | 0.26 |
| 0.4 | 0.0 | 0.0 | 0.22 | 0.18 | 0.22 | 0.26 | 0.26 |
| 0.4 | +0.3 | 0.0 | 0.24 | 0.19 | 0.16 | 0.26 | 0.27 |
| 0.4 | +0.3 | +0.3 | 0.22 | 0.18 | 0.18 | 0.26 | 0.27 |
| 0.6 | −0.3 | 0.0 | 0.36 | 0.29 | 0.37 | 0.24 | 0.24 |
| 0.6 | −0.3 | +0.3 | 0.34 | 0.30 | 0.40 | 0.24 | 0.23 |
| 0.6 | 0.0 | 0.0 | 0.35 | 0.29 | 0.33 | 0.24 | 0.25 |
| 0.6 | +0.3 | 0.0 | 0.34 | 0.29 | 0.26 | 0.24 | 0.26 |
| 0.6 | +0.3 | +0.3 | 0.34 | 0.27 | 0.28 | 0.24 | 0.26 |

The index is worse than its components **when the two traits correlate
positively**. At +0.3 it loses roughly a quarter of their reliability (0.16
against 0.22; 0.26 against 0.34). At zero correlation it matches them. At −0.3
it beats them, because subtracting two negatively correlated traits adds signal
faster than it adds noise. Correlated *state* noise pushes the other way. A
shared sitting-level shock partly cancels in a difference. That is why the
+0.3/+0.3 row recovers a little of the loss. The confidence interval on the
index's ICC is at most 0.02 wider than on `reliance.over` at n = 200. So the
interval claim is small. The reliability claim is the real one.

Hedge, Powell & Sumner (2018) and Enkavi et al. (2019) remain the right prior.
Their difference scores subtract positively correlated conditions of one task.
But **Foray's two rates are measured on disjoint events and may correlate
negatively**: a trusting candidate accepts wrong advice and rejects little
correct advice. Nobody has measured the sign of either correlation. Until
someone does, "the index is expected to be the worst of the three" in §3.2 is a
prediction resting on two unmeasured covariances. The study should estimate
them and say so. Reporting all three coefficients separately, as §3.2 already
requires, is what makes this checkable either way.

#### 3.8.6 What the study can afford, question by question

| question | can the study answer it? |
|---|---|
| 1. ICC on the two rates and the index | **Partly.** 150–200 candidates give reportable intervals. 75–150 refute the 0.5 line if the truth is below it. Nothing up to 1200 puts the interval above 0.5 on a 20-event form. |
| 2. Events per sitting for a scorable rate | **Yes, conditionally: 40 events for ±0.15 and 97 for ±0.10 if events are independent** — and the same data test that condition. |
| 3. Correlation with RAIR and RSR | **Report yes, prove no.** ±0.15 at n = 150–200; a lower bound above 0.20 needs 800+. |
| 4. Timed versus untimed | **At the borrowed effect size, yes:** 250 per arm at 0.06. At half of it, 1000–1400 per arm. |
| 5. Index against components | **Yes, cheaply**, because it is a comparison inside one sample, not a new sample. |

Read together: **a cohort of about 200 answers §3.2, §3.3, §3.1 and §3.8.5
descriptively, and about 500 adds a powered timed contrast at the borrowed
effect size.** Both fit inside §2.5's recruitment. The honest framing is that
this study is well shaped to find the reliance measure wanting and badly shaped
to vindicate it. That is the correct asymmetry for a number that carries 160
points.

#### 3.8.7 What would change these numbers

- **`rho_event`.** The single most important unknown. At 0 the event count buys
  precision as fast as textbooks say. At 0.10 it stops buying much past 20
  events.
- **The mean rates.** 0.40 and 0.20 were assumed. Rates nearer 0.5 carry more
  binomial variance and need more events. Rates near 0 or 1 carry less, but hit
  floor and ceiling effects the ICC handles badly.
- **The split between trait and state.** The latent ICC column is a property of
  the candidate, not of the form. Reliance may drift between sittings: mood, a
  different document, a different assistant persona. Then the state term grows
  and every n above rises.
- **The two covariances in §3.8.5**, which decide the index's whole direction
  and are unmeasured.
- **The borrowed timer effect**, which comes from pathologists on a
  weight-of-advice scale and may not describe candidates on a rate at all.
- **Form variance.** §3.6 treats form parameters as a factor. Any variance the
  form contributes is state variance here. So a form-varying design lowers the
  observed ICC further than these tables show.

#### 3.8.8 What a pilot of 30 candidates would tell us

| true latent ICC | measure | pilot ICC | pilot CI width | P(upper bound < 0.5) | P(interval spans 0 to 0.5) |
|---|---|---|---|---|---|
| 0.3 | `reliance.over` | 0.18 | 0.68 | 0.50 | 0.35 |
| 0.3 | `reliance.index` | 0.16 | 0.69 | 0.54 | 0.33 |
| 0.5 | `reliance.over` | 0.28 | 0.65 | 0.27 | 0.39 |
| 0.5 | `reliance.index` | 0.28 | 0.66 | 0.29 | 0.39 |
| 0.7 | `reliance.over` | 0.41 | 0.60 | 0.09 | 0.29 |
| 0.7 | `reliance.index` | 0.39 | 0.61 | 0.13 | 0.29 |

**A pilot of 30 cannot measure reliability.** The interval on the ICC is about
0.65 wide. About a third of the time it spans everything from 0 to 0.5, the
whole range the decision turns on. Even refuting 0.5 when the truth is 0.3
succeeds half the time.

What 30 candidates can return, and what the full study's sample size depends on
most:

- **`rho_event`**, from 30 × 20 = 600 planted-error events and their
  clustering. §3.8.2 shows this decides whether a longer form is worth
  building.
- **The mean rates**, which set the binomial variance.
- **The two covariances** between over- and under-reliance, trait and state,
  which decide §3.8.5.
- **Whether the two-stage block (§3.1) is completable** in the time budget, and
  how much the second block's order effect moves the rates.

So the pilot is a *parameter* study, not a reliability study. It should be
pre-registered as one. Running it first is cheap, and it changes the price of
everything after it. Presenting a 30-candidate ICC as evidence about the
measure would be the error this whole section exists to prevent.

---

## 4. Recommendation for the user to decide: publish the result either way

Not a decision this document makes. The case, so it can be decided:

**For.** Foray's positioning rests on checkable facts about the method rather
than on an adjective about ourselves (`docs/POSITIONING.md`, "What we can claim
today"). The cheapest way to be believed is to publish a result against our own
product. If the drill turns out not to transfer and we say so first, we become
the organisation in this field that reports its nulls. The pre-registration
proves we did not go looking for the answer afterwards. The DET precedent shows
how a digital-first assessment gets accused of marking its own homework
(Isaacs, THE, Sep 2025: in-house validation "should be complemented by research
undertaken by independent researchers"). It is also a contribution:
**nobody has measured retention past two weeks, and nobody has measured
cross-generator transfer at all.** A well-powered null on gamified practice
would be the second data point behind Geissler's, in a literature that
currently has one.

**Against, honestly stated.** It is a public result that our most engaging
surface does not do the thing people assume it does. A competitor will quote it
without the design section. It invites the question of why we ship the drill at
all. The answer is that engagement is a legitimate goal on its own terms, and
the drill is the front door. That answer is true. It is also a harder sentence
to place in a headline than "Foray admits practice does not work".

**Middle path if the full study is too much.** Pre-register and publish the
*design*, then the result whenever it lands. Publishing the protocol costs
nothing. It cannot be accused of selective reporting later. It already puts us
ahead of the field on this specific question.

---

## 5. What exists today

Nothing of the above. What exists is the honesty layer that stops us claiming
the answer before we have it:

| | where |
|---|---|
| the denial, one wording, every surface | `PRACTICE_EFFICACY_NOTE` in `packages/report/src/practice.ts` |
| why a practice percentage is not an ability figure | `PRACTICE_ACCURACY_CAVEAT` in `packages/report/src/progress.ts` |
| the copy-layer gate | `packages/report/test/efficacyClaims.test.ts` |
| the rendered-surface gate | `apps/web/test/efficacyCopy.test.tsx` |
