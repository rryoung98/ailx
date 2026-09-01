# TRANSFER-STUDY.md — could we tell whether practice works?

Status: **design, not a commitment.** Nothing in this file is built. It exists
because the product previously claimed a training effect it had no way to
observe, and the fix for that is not only quieter copy (`docs/PROGRESSION.md`
§2.4, `packages/report/src/practice.ts`) but an experiment that could actually
catch the effect if it is there — and, just as importantly, could show a null
that means something.

Read `AILX-Spec-2026.1.md` §13 for what practice is, and `docs/PROGRESSION.md`
for the loop this would measure.

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

## 2. The design

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

## 3. Recommendation for the user to decide: publish the result either way

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

## 4. What exists today

Nothing of the above. What exists is the honesty layer that stops us claiming
the answer before we have it:

| | where |
|---|---|
| the denial, one wording, every surface | `PRACTICE_EFFICACY_NOTE` in `packages/report/src/practice.ts` |
| why a practice percentage is not an ability figure | `PRACTICE_ACCURACY_CAVEAT` in `packages/report/src/progress.ts` |
| the copy-layer gate | `packages/report/test/efficacyClaims.test.ts` |
| the rendered-surface gate | `apps/web/test/efficacyCopy.test.tsx` |
