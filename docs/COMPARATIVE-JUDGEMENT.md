# COMPARATIVE-JUDGEMENT.md — what T1's pairwise judging costs, and what reliability we report

TEN-10. Written 2026-09-01. The issue said comparative judgement (CJ) was under-costed by ~10x:
"roughly 30,000 judgements per 500-candidate track". That number is wrong, and the direction of the
error matters, so the arithmetic is set out here in full. Both citations behind the issue were
fetched at source in-session; see §6.

## 1. The correction: 7,500, not 30,000

Each comparison shows a rater two artefacts, so one comparison counts toward the comparison budget
of **two** artefacts. With `N` candidates, one artefact each, and `r` comparisons per artefact:

    total comparisons = N x r / 2

At N = 500 and r = 30 that is **7,500**, not 30,000. The 30,000 figure is `N x r` at r = 60 — it
both skips the division by two and doubles r. It is off by 4x, upward.

**Be exact about which quantity is flat**, because "CJ is flat in N" is also wrong as stated:

| Quantity | Behaviour in N |
|---|---|
| Comparisons per artefact (`r`) | Fixed. Set by the reliability target, not by cohort size. |
| Total comparisons (`N x r / 2`) | **Linear in N.** 10,000 candidates is 100x the comparisons of 100. |
| Comparisons per rater | Flat **only if the rater pool grows with the cohort.** |

The last row is the whole argument. Per-rater burden is `total / raters`. If raters are the
candidates, `raters = N`, the N cancels, and each rater does `r / 2 = 15` pairs at any cohort size.
If raters are a fixed expert panel, `raters = P` is constant and per-expert burden grows linearly:
750 comparisons each at N = 500, 15,000 each at N = 10,000.

**AILX assumes candidates are the raters.** That assumption is written down in three places:

- `AILX-Spec-2026.1.md`, timetable row D+1: "Peer comparative judgement session (T1, T4) | 40 min |
  Blinded, randomised pairs | **Participants as raters**".
- `AILX-Spec-2026.1.md`, T1 score allocation: "60 pts — Comparative visual merit … Blinded
  forced-choice pairwise comparison **by the full cohort**".
- `AILX-Spec-2026.1.md`, "The comparative judgement design": "45 items x 45 raters … comparisons
  *per candidate-rater* are r ÷ 2, **independent of cohort size**".

So the issue's fear is real for a panel design and does not apply to the design AILX actually
specifies. What does not cancel is **rater turnout**: the flat per-rater number assumes every
candidate comes back and judges. That is the exposure, and §2 prices it.

## 2. The cost model

Regenerate this table with `node docs/cj-cost.mjs` (pass `--r=`, `--seconds=`, `--panel=`,
`--expert-rate=`, `--model-rate=` to change an assumption). The script is not in the build or the
test run: `docs/` is outside the vitest workspace and outside every tsconfig. It carries its own
assertions instead — `node docs/cj-cost.mjs --check` checks the arithmetic this document rests on,
including that per-rater load is flat in N while the total is linear.

Assumptions, each stated beside the number it produces:

- `r = 30` comparisons per artefact. **Sourced**: Verhavert et al. (2019) put reliability .90 at
  26–37 comparisons per representation (§6). The spec's earlier r = 24 sat below that band.
- **75 s per forced-choice pair.** A **guess**, carried over from the spec. Nobody has timed an AILX
  rater. It is the single assumption most worth measuring in the first live sitting.
- **Expert panel of 10, at $60/hour loaded.** Both **guesses**, and the rate is a placeholder for a
  contracted subject-matter marker.
- **$0.02 per model-jury comparison.** A **guess**: two screenshots plus a prompt to a frontier
  vision model, no retries, no jury of three. A three-model jury triples it.
- One artefact per candidate, no drop-outs, no re-judging, no ties re-served.

| N | Total comparisons | Per candidate-rater | Candidate time | Per expert (panel of 10) | Expert time each | Total rater-hours | Expert cost | Model-jury cost |
|---|---|---|---|---|---|---|---|---|
| 100 | 1,500 | 15 | 18.8 min | 150 | 3.1 h | 31 | $1,875 | $30 |
| 500 | 7,500 | 15 | 18.8 min | 750 | 15.6 h | 156 | $9,375 | $150 |
| 5,000 | 75,000 | 15 | 18.8 min | 7,500 | 156.3 h | 1,563 | $93,750 | $1,500 |
| 10,000 | 150,000 | 15 | 18.8 min | 15,000 | 312.5 h | 3,125 | $187,500 | $3,000 |

Read it as: the candidate-rater column is flat, the expert columns are linear, and the money column
is the same rater-hours priced. **Nothing here is 10x under-costed. The candidate-rater design is
19 minutes per person at every N in the table.**

What the table does not price, and what actually breaks the design:

- **Turnout.** The absent raters' share falls on the ones who show up, so per-rater burden is
  `r / (2 x turnout)`. At 60% that is 25 pairs, about 31 minutes. At 50% it is 30 pairs, about 38
  minutes. At 30% it is 50 pairs, about 63 minutes, and the session stops being something people
  finish. Turnout is the term to monitor, not volume.
- **Coverage.** `N x r / 2` comparisons must also be *connected*: a design that leaves an artefact
  in a disconnected component has no estimable measure, whatever the total says.
- **Time to fit**, storage and moderation of 150,000 rows. Small next to the rater hours.

## 3. Who judges

| Rater model | Cash cost at N = 10,000 | Scaling | The real objection |
|---|---|---|---|
| Candidates (the spec's choice) | No marker payroll | Flat per rater | Conflict of interest, and turnout |
| Expert panel of 10 | ~$187,500 (guess rate) | Linear per expert | Unaffordable above ~N = 500 |
| Model jury | ~$3,000 (guess rate) | Linear, cheap | Cannot do the task (see below) |

**Candidates.** No marker payroll, and flat per rater. It is not free: total participant time still
grows linearly (3,125 rater-hours at N = 10,000), and the administration of a judging session is not
priced here at all. What the candidate model buys is that nobody is invoiced, not that nobody pays.
A candidate who rates peers also has an interest in the outcome. The spec's handling is mandatory self-exclusion (a candidate never sees their own
artefact), author identity never shown, randomised pairs, and per-rater bias and reliability
estimated in the fit. That covers self-favouring and blunt collusion. It does not cover a rater who
recognises a classmate's work in a small cohort, and it cannot: at N = 45 in one room, style is
identifying. The mitigation there is the fit, not the blinding — a rater whose judgements do not
agree with the panel is downweighted, whatever their motive. **State the residual honestly in the
report: peer judgement is the criterion, and at small N the blinding is imperfect.**

**Expert panel.** Defensible to an external reviewer, and the only model where the rater has
declared expertise. It is affordable at N = 100–500 for a calibration study and nothing beyond. Its
second cost is throughput: 312 hours per expert at N = 10,000 is a job, not a task.

**Model jury.** Cheapest by two orders of magnitude and rejected on evidence, not price. The spec's
own table gives the numbers: frontier model 26.5% vs human expert 68.9% on comparative aesthetic
tasks (VAB, 2026); GPT-4 win rate 89.5% for bold text with content held constant (style bias study,
2024); LAION-Aesthetics scores zero works from the Met's African, Native American, Oceanian and
Islamic departments at >= 6.5 (FAccT 2026 audit). The private repo's `EVIDENCE-JUDGE-AGREEMENT.md`
adds the general warning for LLM judges on ordinal rubrics: judge–human correlations sit in a narrow
.47–.56 band with judge severity SD 8–15x that of trained raters (arXiv:2608.29517), and anchored
calibration can match the human score *distribution* while rank-order agreement stays near zero
(arXiv:2603.14732). A model jury would produce a cheap number that is confidently wrong in a
model-specific direction.

**Chosen: candidates.** With the expert panel kept for one calibration study at N <= 500, whose
purpose is to answer whether the peer scale correlates with an expert scale at all.

## 4. The reliability statistic we will report

**Not Scale Separation Reliability under adaptive pairing.** Bramley (2015) simulated CJ with the
true reliability set to zero — every script the same true quality, every comparison outcome a coin
flip — and adaptive pairing returned SSR up to **0.89**. Non-adaptive pairing on the same random
data returned SSR below 0.25, which is what a failed scale should look like. His conclusion,
verbatim: "the SSR statistic is at best misleading and at worst worthless as an indicator of scale
reliability whenever a CJ study has involved a significant amount of adaptivity."

Two decisions follow, and they are a pair.

**(a) Pairing stays non-adaptive.** Randomised or balanced-incomplete-block, permanently. Bramley
also shows the other half: "when there is no adaptivity the SSR statistic estimates the true
reliability". SSR is not a broken statistic; adaptive pairing is what breaks it. Adaptivity would
buy fewer comparisons per artefact and pay for it with a reliability figure nobody can defend. That
trade is refused here in writing so that a later efficiency argument has to overturn a decision
rather than fill a gap.

**(b) We report split-panel correlation, not SSR alone.** This is Bramley's own recommendation:
"Other indicators of reliability, such as correlations with measures obtained from comparisons among
a different group of judges, or correlations with relevant external variables, should be used
instead."

How it is computed:

1. Split the rater pool into two halves of equal size, before any fitting, using a seed stored with
   the attempt so the split is reproducible. Then check each half's comparison graph is connected
   and that every artefact appears in both halves. A random split does neither on its own, and a
   disconnected half has no estimable measures to correlate. Re-draw the split until both hold.
2. Fit Bradley–Terry independently on each half's comparisons.
3. Correlate the two sets of artefact measures (Pearson on logits, and Spearman, because the
   published failure mode is a rank-order collapse under a matched distribution).
4. Apply the Spearman–Brown correction to state the reliability of the **full** panel, and report
   the uncorrected half-panel correlation next to it. Never report only the corrected number.

**What it costs.** Nothing extra, if we accept less precision: the existing `N x r / 2` comparisons
are split, so each half-panel fit sees r / 2 = 15 comparisons per artefact. Fifteen sits above
Verhavert's .70 band (10–14) and below the .80 band (19–20), so each half is a weaker measurement
than the full panel — which is exactly the loss Spearman–Brown corrects for. If a half-panel
estimate at full precision is wanted, it costs **2x total comparisons** (30 pairs per rater,
~38 min), and that is not worth it for a check statistic.

**What it does not tell us.** Three things, and each must be said next to the number.

- It is **agreement, not validity.** Two halves of a cohort that share a taste will agree with each
  other and be wrong together. Only the expert-panel correlation in §3 speaks to validity.
- It does not license **ranks**. Reliability .90 supports bands. Telling a candidate they placed
  12,043rd at N = 10,000 is not supported by this measurement, and the report must not imply it.
- It says nothing about **absolute** scores. Bradley–Terry's Fisher information matrix is singular
  under shift, so confidence intervals are reported on score *differences* only.

Reported beside it, as the spec already requires: **separability**, the fraction of artefact pairs
whose confidence intervals do not overlap.

## 5. The decision

**Adopt comparative judgement for T1 only.** Conditions:

- Non-adaptive pairing, permanently (§4a).
- r = 30 comparisons per artefact, so the reliability claim sits inside Verhavert's .90 band rather
  than just below it.
- Candidates are the raters, with self-exclusion and blinding (§3).
- Split-panel correlation is the headline reliability number; SSR may be reported beside it, and
  only because the design is non-adaptive.

T1 only, because that is where the rest of the instrument already is. T3 is scored by a rubric with
an LLM jury and a measured agreement statistic, not by CJ.

**T4 is an open decision, and it doubles the number in the table.** T4's comparative merit is no
longer scored — the track is recorded as a showcase index — but the spec still runs T4 pairs in the
same session: the timetable row D+1 reads "Peer comparative judgement session (T1, T4)", and the
showcase index still has a comparative-40 component that needs comparisons to exist. If T4 keeps
being judged at r = 30, the per-rater burden is **30 pairs, about 38 minutes**, not 15 and 19
minutes. Two ways out, and somebody has to choose:

1. **Drop T4 comparisons.** The showcase index loses its comparative component and reports the
   other 60 points. Rater burden stays at 15 pairs.
2. **Judge T4 at a lower r.** A showcase index is not a score of record, so it does not need the
   .90 band. At r = 10 (Verhavert's .70 band) T4 adds 5 pairs, and the burden is 20 pairs, ~25 min.

Recommendation: option 2, and label the showcase comparative component with the reliability it
actually bought. Until that is decided, read every candidate-rater number in §2 as **T1 only**.

**The conditions that flip this decision:**

- **Turnout below ~50%** in the first live sitting. Per-rater burden doubles to 30 pairs, about 38
  minutes, and keeps climbing as turnout falls. Below 50% the honest move is a paid expert panel at reduced N,
  with T1's comparative points reweighted or dropped, not a longer judging session.
- **Split-panel correlation below ~.7** at r = 30, Spearman–Brown corrected. That says the cohort
  does not agree on the construct, and a CJ scale over disagreement is a formal average of taste.
  Replace comparative merit with rubric-based judging with measured rater agreement.
- **Peer-vs-expert correlation below ~.5** in the calibration study. Peers would be reliably
  measuring something an expert does not recognise as merit. Same replacement.
- **Anyone proposing adaptive pairing to cut the comparison count.** The count is not the binding
  constraint (§2). If someone argues it is, the arithmetic in §1 is wrong somewhere and should be
  fixed before the design changes.

## 6. The citations, verified at source

Both were fetched in-session, 2026-09-01, not quoted from memory. This project has already shipped a
figure that did not survive being traced (`AILX-Spec-2026.1.md` §04), so the retrieval is recorded.

**Verhavert, S., Bouwer, R., Donche, V., & De Maeyer, S. (2019). A meta-analysis on the reliability
of comparative judgement. *Assessment in Education: Principles, Policy & Practice*, 26(5), 541–562.
DOI 10.1080/0969594X.2019.1602027.** VERIFIED, full text. The publisher page is paywalled; the
accepted author version was read from the University of Antwerp repository,
https://repository.uantwerpen.be/docman/irua/2b3d93/159139_2020_04_13.pdf, and from VU Amsterdam
Pure, https://research.vu.nl/ws/portalfiles/portal/122157293/A_meta_analysis_on_the_reliability_of_comparative_judgement.pdf

> "The results of the posterior prediction show that an average of 13 comparisons per representation
> (min = 10, max = 14) is associated with a reliability of .70. A reliability of .80 is reached
> between 19 and 20 comparisons per representation. For a reliability of .90, i.e., with high stakes
> assessments, between 26 and 37 comparisons are needed. The ranges of these predictions differ
> quite a lot."

Five things the band comes with, all from the same paper, and all of them matter to us.

- **The statistic is SSR.** "The reliability of CJ is most commonly determined by the Scale
  Separation Reliability (SSR)". So 26–37 is an SSR band, and by §4 an SSR band is only meaningful
  in a non-adaptive design.
- **Which is what these 49 assessments were.** All ran on the D-PAC platform: "this algorithm is
  based on randomness and is thus not adaptive." The paper flags the same risk we do, citing
  Bramley & Vitello (2018): adaptive algorithms "can spuriously inflate the reliability, which casts
  doubt on some of the reliability values that have been reported in adaptive CJ studies." r = 30
  and non-adaptive pairing are therefore the same decision, not two.
- **It is a Bayesian posterior prediction, not an observed count**, and .90 is extrapolated: the 49
  assessments "are mainly clustered around SSR's of .70 and .80". The 26–37 width is real
  uncertainty.
- **Novices need more.** Expert and peer assessors reach the reliability asymptote inside the 26–37
  band; "assessments with novices need more comparisons per representation and representations per
  assessor". AILX raters are peers, which is the band's better case, but candidates judging web
  design are closer to novices than to the D-PAC peer raters. **r = 30 is the floor, not a margin.**
- **Assessor count and expertise do not move the reliability level**: "only N_CR influences the
  reliability level". Recruiting better raters does not buy reliability; comparisons per artefact
  buys reliability.

**Bramley, T. (2015). *Investigating the reliability of Adaptive Comparative Judgment*. Cambridge
Assessment Research Report, 23 March 2015.** VERIFIED, full text. PDF retrieved from
https://www.cambridgeassessment.org.uk/Images/232694-investigating-the-reliability-of-adaptive-comparative-judgment.pdf

> "The results are startling – the cases involving adaptivity produced drastically inflated values
> for SSR, rising as high as 0.89 for the simulation with 1 random round and 15 adaptive rounds."

> "With random or fixed rounds, the SSR values were all below 0.25 … a low value of SSR almost
> certainly indicates low reliability, but a high value of SSR does not necessarily indicate high
> reliability."

> "when there is no adaptivity the SSR statistic estimates the true reliability … If there is
> adaptivity, then it is necessary to repeat the comparison process in some way to get an unbiased
> estimate of the true reliability."

Setup, from the report: simulation study 2 replaced every paired-comparison outcome among 100 or
1,000 scripts with a coin flip, "equivalent to assuming every script has the same underlying 'true
quality'", so the true reliability is zero. The 0.89 case is 1,000 scripts, 16 comparisons per
script, 1 random round then 15 adaptive rounds (row `sim2h` of Table 2, run on random data).

Two refinements to carry with the 0.89. It is the **worst** case, not a typical adaptive result:
bias grows with the adaptive share, and this run is maximum adaptivity. And Bramley says his own
adaptivity was crude — "less sophisticated than the adaptivity used in the published studies" — so
he checked it against NoMoreMarking's algorithms, whose "results essentially agreed with those
above."

One more number from the same Table 2, worth having: with **fixed** (non-adaptive) allocation at 30
comparisons per script, SSR came out 0.90 against a true reliability of 0.90 (`sim2j`). That is
independent support for r = 30 in a non-adaptive design, from a different method than Verhavert's.

Not read: Bramley, T., & Vitello, S. (2019). The effect of adaptivity on the reliability coefficient
in adaptive comparative judgement. *Assessment in Education*, 26(1), 43–58.
DOI 10.1080/0969594X.2017.1418734. It is the peer-reviewed version of the same result and Verhavert
et al. cite it. Read it before anyone argues the 2015 report is grey literature.
