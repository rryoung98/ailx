# TRANSFER-STUDY.md — the two validation studies we have not run

Status: **design, not a commitment.** Nothing in this file is built. It exists
because the product previously claimed a training effect it had no way to
observe, and the fix for that is not only quieter copy (`docs/PROGRESSION.md`
§2.4, `packages/report/src/practice.ts`) but an experiment that could actually
catch the effect if it is there — and, just as importantly, could show a null
that means something.

Read `AILX-Spec-2026.1.md` §13 for what practice is, and `docs/PROGRESSION.md`
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
   Immediately: textual +7.5 pts, visual +13 pts — but **gamified 65.7%
   (p_adj = .310)** and **feedback 60.0% (p_adj = 1.000)** were
   indistinguishable from control at 61.3%. At two weeks **no arm** beat
   control. AILX's practice loop is gamified drilling with immediate feedback:
   it is assembled from the two arms that failed.
2. **Gray, Davis, Bunce, Noyes & Ritchie**, *R. Soc. Open Sci.* 12(11):250921
   (2025). The five-minute artefact training AILX modelled its families on.
   Trained typical-ability adults reached 51% accuracy — with **d′ = −0.066,
   not different from chance** (t₆₉ = 1.092, p = .279). Untrained controls were
   *below* chance. Training removed a bias; it did not create discrimination.
   The design is between-subjects, so nobody in it was measured improving.
3. **Diel et al. (2024)** meta-analysis, k = 137, 56 papers, N = 86,155:
   pooled deepfake-detection accuracy 55.5% [48.9, 62.1] with **pooled d′ not
   different from chance**, and a large asymmetry (people are much better on
   *real* stimuli). Accuracy in this field is a criterion statistic wearing an
   ability statistic's clothes.

**The failure mode this design exists to prevent.** Training that moves the
criterion without moving sensitivity makes a person readier to say "AI" while
leaving them exactly as unable to tell. Their raw accuracy on an AI-heavy set
goes up; their real-world discrimination does not; their confidence does. That
is worse than no intervention, and it is invisible to any measure that reports
one number. So **d′ and c are reported apart, always, in the same table.**

---

## 2. The T2 design — does discrimination transfer?

### 2.1 Construct and primary outcome

- **Task.** Single-stimulus yes/no: "photograph or AI-generated?", the same
  call the drill and T2 make. **Not 2AFC** — Mai et al. (PLOS ONE 18(8):
  e0285333) measured side-by-side framing inflating scores by ~15 points, so a
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

A **P-subset is measured too, as a manipulation check, and reported separately**:
if Δd′ on P is large and Δd′ on H is zero, the drill taught a decoder's
fingerprint rather than an artefact family — the exact outcome the artefact-
family framing predicts should *not* happen, and therefore the sharpest
available test of the framing. Kramer et al.'s result (no training effect once
obvious artefacts are removed) says to expect this.

**H must be re-drawn every year.** Deepfake-Eval-2024 (arXiv `2503.02857`)
found detector AUC dropping ~45–50% on in-the-wild 2024 media versus academic
benchmarks; a generator set fixed in 2026 is measuring 2026.

### 2.3 Assignment and control

- Randomise at the **first practice round**, before any card is dealt, on a
  server-generated assignment. Stratify by pre-test d′ band and by locale.
- **Three arms**, not two:
  - **drill** — the product as it ships;
  - **active control** — the same time budget spent on plain textual + visual
    instruction. These are the arms that *did* work immediately in Geissler,
    so they are the honest comparator: the question is not "is the drill better
    than nothing", it is "is the fun version worse than a paragraph";
  - **no-practice control** — pre and post only.
- Intention-to-treat on assignment. Dose (rounds completed, days practised) is
  a **pre-specified covariate**, never a re-grouping after the fact: dose is
  self-selected, so a dose-response analysis is observational and must be
  labelled as such.

### 2.4 Timing

`t0` pre-test → practice window (14 days) → `t1` immediate post → **`t2` at
14 days** with no practice in between → **`t3` at 56 days**.

`t2` matches Geissler's follow-up so the results are comparable. `t3` exists
because nobody in this literature has measured beyond two weeks, and AILX's
whole annual-re-sitting story is a durability claim.

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

A non-significant result is not evidence of absence. So the analysis plan
includes **equivalence testing (TOST)** against a pre-registered smallest
effect size of interest — Δd′ = 0.20 is the proposal, on the argument that
anything smaller cannot justify a product claim. That makes three publishable
outcomes rather than two: it works, it is equivalent to control, or it is
inconclusive.

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
  separately. The "worse than nothing" failure is a confidence effect, and a
  study that does not measure confidence cannot detect it.
- **Practice contamination of the scored sitting.** Hausknecht et al. (2007;
  50 studies, N = 134,436) put retest/practice effects at d = 0.26, larger with
  identical forms plus coaching. Keeping O disjoint from P and H is what stops
  this study from being the thing that breaks the instrument.

### 2.8 What has to be logged

Per trial: stimulus id, generator set (P/H/O), generator family, artefact
family, response, response time, confidence, arm, occasion. Practice rounds
already record most of this. **None of it is a scored input**, and the
frontend/backend split in `AGENTS.md` keeps it that way: this is practice
telemetry, and it never reaches `score()`.

---

## 3. The T3 design — does the reliance measure mean anything?

T3 carries 160 points and .40 of the composite on a construct with no external
validity evidence and no reliability figure (spec §T3, "What this track cannot
claim"). This section is the smallest study that would change that. It is
additive: it reuses the same recruitment, the same pre-registration and the same
`t0`/`t2` spacing as §2, and it changes nothing about the T2 arms.

**Sample size is not settled here, and must be before `t0`.** §2.5's n = 176 per
arm is powered for a between-arm difference in Δd′, which is a different
quantity from an ICC or a correlation. §3 needs its own calculation, driven by
the narrowest interval it must report — the ICC(2,1) in §3.2 — and by the
timed/untimed allocation in §3.5. Naming the gap is not the same as closing it.

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
  counterbalanced for that reason, and the order is a stated limit of the
  correlation in the next point.
- From that block, compute **RAIR and RSR to the published definitions**, and the
  Appropriateness-of-Reliance tuple. Report the tuple, never a difference.
- Compute AILX's `reliance.over`, `reliance.under` and `reliance.index` on the
  **same** candidate from the ordinary block, and publish the correlations
  between the two sets, with confidence intervals. **Publish them whatever they
  are.** A low correlation is the finding, not a failure of the study.
- Pre-register the direction: `reliance.over` should track 1 − RSR, and
  `reliance.under` should track 1 − RAIR. That is the mapping asserted in the
  private repo's `docs/EVIDENCE-CALIBRATED-RELIANCE.md` §6, and it has never been
  measured. If the correlations are low, the spec drops the claim that AILX's
  rates are comparable in direction to the published ones.

The block costs the candidate time and changes the task, which is exactly why it
is a study instrument and not a shipped form. It is the only design found that
lets AILX say its numbers behave like the literature's.

### 3.2 Test–retest on parallel forms

- **Two sittings, at least 14 days apart**, matching §2.4's `t2`.
- **Disjoint planted-error sets.** No error instance appears in both sittings.
  Instances come from the same four families (misattributed figure, false causal
  claim, fabricated citation, wrong calculation) in the same counts, so the forms
  are parallel in construction and share no answer.
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

The shipped floor is eight planted errors (`RSR_MIN_SURFACED`). Eight binary
events give a 95% binomial interval of about ±0.35 on a rate, which cannot
support an individual score.

- **≥ 20 planted errors and ≥ 20 correct-advice opportunities per sitting**, so
  the retest design accumulates ≥ 40 of each.
- Report the **binomial interval and the empirical interval side by side.** If
  they disagree, the events are not independent and the binomial one understates
  the true width.
- Add a **split-half / Spearman–Brown internal-consistency estimate at the
  achieved length**, split by error family, so the answer is not one number for
  a mixed bag of four different tasks.

### 3.4 Convergent, discriminant and criterion evidence

Collected at `t0`, one page, no scoring impact:

- A validated self-report reliance or complacency scale (GenAI-RTS,
  arXiv:2607.14301, ω = .75–.88) and Need for Cognition. Convergence should be
  **modest**. Near 1.0 with self-report means the behavioural measure adds
  nothing a questionnaire does not already give; near 0 with everything means it
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
  **rate** of error adoption unchanged (p = 0.19) and only the severity raised,
  so a null on rate is the expected result and must be publishable as one.
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
while carrying almost no rank information (Yeadon et al., arXiv:2603.14732), and
QWK alone cannot tell the two apart. Report the human–human agreement measured on
the same panel in the same table: a judge coefficient without its human
comparator cannot be read. Pin and record the judge version with every
coefficient.

---

## 4. Recommendation for the user to decide: publish the result either way

Not a decision this document makes. The case, so it can be decided:

**For.** AILX's entire positioning is "a neutral examiner" (`docs/POSITIONING.md`).
The single cheapest way to be believed is to publish a result against our own
product. If the drill turns out not to transfer and we say so first, with the
pre-registration to prove we did not go looking for the answer afterwards, we
become the organisation in this field that reports its nulls — at a moment when
the DET precedent shows exactly how a digital-first assessment gets accused of
marking its own homework (Isaacs, THE, Sep 2025: in-house validation "should be
complemented by research undertaken by independent researchers"). It is also a
genuine contribution: **nobody has measured retention past two weeks, and
nobody has measured cross-generator transfer at all.** A well-powered null on
gamified practice would be the second data point behind Geissler's, in a
literature that currently has one.

**Against, honestly stated.** It is a public result that our most engaging
surface does not do the thing people assume it does; a competitor will quote
it without the design section; and it invites the question of why we ship the
drill at all. The answer — engagement is a legitimate goal on its own terms,
and the drill is the front door — is true but is a harder sentence to place in
a headline than "AILX admits practice does not work".

**Middle path if the full study is too much.** Pre-register and publish the
*design*, then the result whenever it lands. Publishing the protocol costs
nothing, cannot be accused of selective reporting later, and already puts us
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
