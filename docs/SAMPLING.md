# SAMPLING.md — how AILX gets a number it is allowed to publish

Status: design document, first draft. Public on purpose. A sampling method that nobody can read is
worth nothing as a credibility asset, and there is no secret in here — the item bank is what is
private (see `AGENTS.md`, "The repository split"), not the way we pick people.

Companion documents: `docs/POSITIONING.md` (why a population statistic is the ambition),
`AILX-Spec-2026.1.md` §01 and §09 (the claim and the psychometrics), `docs/TRANSFER-STUDY.md`.

Every number below is marked. **VERIFIED** means a primary source was read and is cited.
**ESTIMATE** means an engineering judgement with the reasoning shown. **UNKNOWN** means we do not
know and have not pretended to.

---

## 0. The one-paragraph version

AILX runs two samples that never mix. **Track A** is everyone who plays or sits on the web: large,
self-selected, and biased toward the AI-curious. It calibrates items, estimates difficulty, powers
engagement research and issues individual credentials. It is never a national number. **Track B** is
a bought probability panel, 1,500–3,000 adults per country per wave, weighted to published
population margins, with a non-response bias analysis published in the same release. Only Track B
produces a published population statistic. **Item parameters may flow A → B. Person scores never
flow A → anything population-shaped.** That rule is enforced in the data model, not in a policy
note, because policy notes do not survive a downstream analyst with a `GROUP BY`.

---

## 1. Why volume cannot fix this

The temptation is obvious and needs killing in writing. If 200,000 people sit AILX on the web, the
sampling error on their mean is tiny and the **bias is untouched**. Standard error shrinks with
`1/sqrt(n)`; self-selection bias does not shrink at all. A large biased sample is more dangerous
than a small one, because the confidence interval gets narrow enough to look authoritative while the
point estimate stays wrong by an unknown and unestimable amount.

The size of the gap is not hypothetical:

- US PIAAC Cycle 2 achieved an **overall weighted response rate of 27.8%** (the product of a 50.2%
  screener rate, 56.1% background questionnaire and 98.9% assessment rate); across the 31
  participating countries overall rates ran **27% to 73%**, with four countries below 30%.
  Source: NCES, *PIAAC Cycle 2 Methodology and Technical Notes*. **VERIFIED** (via the research
  evidence base; re-check the live NCES page before publication).
- That is the gold standard: in-home, interviewer-administered, incentive-paid, with a population
  register or address frame behind it. A playful web product with streaks and share cards will not
  beat it on representativeness at any volume.

The failure mode is well documented and it is the one AILX will be accused of by default: **"a
convenience or self-selected sample dressed as a national number"** is the top item on the list of
things that get an index dismissed. Every existing "AI skills index" is already in that bucket —
Stanford HAI's AI Index skill-penetration measure is computed from LinkedIn profiles, Microsoft's
Work Trend Index is a 31,000-respondent online panel of knowledge workers, and the Coursera Global
Skills Report ranks countries partly on its own learners' percentiles. **VERIFIED** (methodology
appendices; see the evidence base). None of them measures proficiency, and all of them are what
AILX would become by accident.

---

## 2. The two-track architecture

| | **Track A — convenience** | **Track B — panel** |
|---|---|---|
| Who | anyone on the web: play mode, demo, full sitting | a probability sample of adults 18–65, drawn by a vendor from an address or register frame |
| Size | unbounded, target 10⁴–10⁵ | 1,500–3,000 completes per country per wave |
| Recruitment | organic, social, share cards, streaks | vendor panel, incentivised, with replacement rules |
| Weights | **none — structurally absent** | design weight × non-response adjustment × calibration to population margins |
| Legitimate outputs | item difficulty and discrimination, DIF screening, item exposure, engagement and progression research, individual scores and credentials, qualitative findings | the published population statistic, subgroup breakdowns above the reporting floor, cross-country comparison |
| Forbidden outputs | any mean, percentile or band described as national, population, "of adults", or "in Japan" | individual credentials (panellists are paid respondents, not candidates) |
| Form length | full 4h 20m sitting, or short play | **short form, matrix-sampled** (see §6) |

### What crosses the boundary

**Allowed A → B: item parameters.** Difficulty, discrimination, timing distributions, misfit flags,
the DIF screen, generator-vintage staleness signals. These are properties of items, not of people.
Calibrating on a biased ability distribution is a known and bounded problem: Rasch item parameters
are invariant to the ability distribution when the model fits, and where it does not, the panel
wave re-estimates its own parameters and the A-derived values become priors, not truth. Any item
whose B-wave difficulty departs from its A-wave difficulty by more than a pre-registered threshold
is flagged as a **construct-shift item** and reported, not quietly re-fitted.

**Allowed B → A: nothing operationally, everything editorially.** The panel wave's scale is the
reference metric; a Track A candidate may be told where they stand *against the panel norm* on
their individual report, clearly labelled as a comparison to the national reference sample. That is
a lookup against a published table, not an aggregation of Track A.

**Forbidden in both directions: person-level scores entering a population estimator.** No Track A
score may be averaged, weighted, percentiled or trended as a statement about any population larger
than "people who chose to sit AILX".

---

## 3. The structural safeguard

A rule that lives in prose gets broken in eighteen months by a well-meaning analyst who never read
the prose. The separation is therefore enforced by shape.

**S1 — every scored record carries a non-nullable `frame`.** A sitting is `frame: "convenience"` or
`frame: "panel"`. There is no default and no nullable column: an insert without a frame fails. The
frame is set at session creation from the entry path (a panel sitting can only be created by
redeeming a single-use vendor-issued invite token), never by a client-supplied field.

**S2 — weights exist only on Track B, as a separate table.** Convenience rows have no weight column
to read. A population estimator is written to require `(frame = 'panel', weight, replicate_weights,
stratum, psu)`; on Track A those columns do not exist, so the estimator does not return a wrong
number — it fails to compile against the schema. This is the important half of the design: **the
safeguard is that the dangerous computation is unwriteable, not that it is discouraged.**

**S3 — no population estimator accepts unweighted input.** The published-statistic path takes
replicate weights and plausible values, and errors on their absence. There is no "simple mean"
entry point in the population module at all. Simple means live in the Track A engagement module,
whose return type is named for what it is (e.g. `ConvenienceCohortSummary`) and whose every export
carries the disclosure string with it, in the payload, not in a footnote.

**S4 — labels travel inside the data.** Every export, API response, share payload and CSV from
Track A carries `population: null` and a `basis` string ("self-selected web cohort; not
representative of any population"). A downstream consumer who strips it is making a visible choice.
This follows the pattern `packages/report/src/exportTiers.ts` already uses, where the tier label is
a field of the object rather than a property of the documentation.

**S5 — a guard test, in the pattern of `packages/core/test/frontendOnly.test.ts`.** The build fails
if: a population-shaped function name (`national*`, `population*`, `countryMean*`) appears in a
module that can be reached from convenience-frame data; a weight column is added to a
convenience-frame type; or the disclosure field is removed from a Track A export schema. The repo
already fails builds over an architectural boundary (`@ailx/backend` imports, `app/api/**` routes),
which is the precedent that makes this credible rather than aspirational.

**S6 — reporting floor and cell suppression apply to both tracks.** `MIN_COHORT_SIZE` in
`packages/report/src/aggregates.ts` is already 10 for re-identification. The **statistical**
reporting floor for Track B is separate and higher (§4).

**S7 — the release artefact is a bundle, not a number.** A published national figure ships as a
directory: point estimate, standard error, replicate weights method, weighting margins and sources,
response rate computed to AAPOR RR3, the NRBA, and the item-level parameter file. If the bundle is
incomplete the release script refuses to build it. There is no way to publish the number alone.

---

## 4. How many people, and what the number buys

### 4.1 The recommendation

**n = 1,500 completes per country per wave is the floor for a national headline. n = 3,000 is the
number to buy if subgroups are part of the promise, and they will be.** ESTIMATE, with the
arithmetic below; this is an engineering judgement calibrated against PISA and PIAAC practice, not
a formal power analysis against a known variance component structure — we do not yet have the
variance components, and that is an **UNKNOWN** until wave 1.

Reference points. PISA standard 1.7/1.8 requires **4,500 assessed students from 150 schools** per
participant (1,500 from 50 schools for an adjudicated sub-entity). ICILS 2023 realised ~3,900
students per system. PIAAC Cycle 2 realised ~160,000 adults across 31 systems, ~5,200 per system;
the US realised 4,574 assessed from 16,414 sampled households. **VERIFIED.** AILX at 1,500–3,000 is
below all of them, which is a fact to state rather than hide: we buy less precision than PIAAC and
we say so in the same sentence as the estimate.

### 4.2 What the precision actually is

The composite is normalised to mean 50, SD 15 (spec §04), so a standard deviation is 15 points on
the reported scale. Half-width of a 95% confidence interval on a national mean is
`1.96 · SD · sqrt(deff / n)`.

Design effect `deff` here is the combined effect of unequal weights (Kish: `1 + CV²` of the weights)
and any clustering. Probability web panels have no geographic clustering but do have substantial
weight variation after non-response adjustment; **1.3–2.0 is the plausible range and 1.6 is the
planning value. ESTIMATE** — the real value is vendor-specific and is a deliverable of wave 1, not
an assumption we should be allowed to keep.

| n | deff 1.3 | deff 1.6 | deff 2.0 |
|---|---|---|---|
| 3,000 | ±0.61 pt (0.041 SD) | ±0.68 (0.045) | ±0.76 (0.051) |
| 2,000 | ±0.75 (0.050) | ±0.83 (0.055) | ±0.93 (0.062) |
| **1,500** | ±0.87 (0.058) | **±0.96 (0.064)** | ±1.07 (0.072) |
| 1,000 | ±1.06 (0.071) | ±1.18 (0.078) | ±1.31 (0.088) |
| 500 | ±1.50 (0.100) | ±1.66 (0.111) | ±1.86 (0.124) |
| 250 | ±2.12 (0.141) | ±2.35 (0.157) | ±2.63 (0.175) |

These are **sampling error only**. Two further variance components must be added before any figure
is published, and both are larger than people expect:

1. **Measurement error via plausible values.** A short matrix-sampled form gives each respondent a
   subset of items, so individual point estimates are biased for group statistics; the correct
   treatment is multiple imputation (current practice is 5–10 plausible values; PISA uses 10),
   combined by Rubin's rules: total variance `V = U + (1 + 1/M)·B`, where `U` is the
   replicate-based sampling variance and `B` the between-PV variance. PIAAC Cycle 2 computes `U`
   from **80 Fay-BRR replicate weights (Fay factor 0.3)** and states outright that standard errors
   for PV-based estimates "must account for both the sampling variance and the variance due to
   imputation". **VERIFIED.** ESTIMATE for us: **expect a 10–30% inflation** of the standard error
   in the table above, and proportionally more than PIAAC gets, because a short AILX panel form has
   fewer items per person than PIAAC does. Two rules follow. **Quote the total SE, never the
   sampling SE alone.** And **every background variable used for a subgroup breakdown must be in
   the conditioning model** — if it is not, the PVs bias that contrast toward the null, which is
   the classic secondary-variable error in NAEP and PIAAC analysis.
2. **Linking error, for any year-over-year comparison.** Trend statements need an explicit
   linking-error term added to the SE of the difference, and it does not shrink with sample size.
   PIAAC Cycle 2's cross-cycle linking error is **3.27 for literacy and 2.95 for numeracy** on a
   500-point scale — about 0.65% and 0.59% of the scale, i.e. roughly ±0.07 SD, larger than our
   entire sampling error at n = 1,500. **VERIFIED.** For an instrument that re-versions *annually*,
   this term is the dominant source of uncertainty in any trend claim, not a footnote (see §12).

### 4.3 Country comparison, which is the thing people will actually do

The difference between two independent country means has SE `sqrt(2)` times the single-country SE.
At n = 1,500 and deff 1.6: the 95% CI on a difference is **±1.36 points**, and the smallest
difference detectable with 80% power is **1.94 points** — about **0.13 SD**. So a league table
built on 1,500 per country can separate countries that differ by roughly an eighth of a standard
deviation and cannot separate anything finer. Most adjacent ranks in any real league table will be
statistically indistinguishable, and the release must therefore present **overlapping-band
groupings, not ranks** — PISA's own convention of reporting "countries whose mean is not
significantly different from" is the model. **A bare ordered list of countries is a
misrepresentation of our own precision and we should never publish one.**

### 4.4 What breaks at n = 500

n = 500 is the number a budget conversation will produce, so its failure modes need to be concrete.

- **The headline mean survives, barely.** ±1.66 points at deff 1.6 (0.11 SD) is publishable as a
  national estimate with a wide-enough interval, and the honest framing is "we can tell you roughly
  where the country sits, not where it ranks".
- **Country comparison dies.** Minimum detectable difference rises to **3.4 points (0.22 SD)**. On
  any plausible spread of national means, almost nothing is significant, and a ranking becomes noise
  with a decimal point on it.
- **Subgroups die first and hardest.** At n = 1,500 (deff 1.6): a half-sample subgroup (e.g. by sex)
  gets ±1.36; a quarter ±1.92; a 15% group ±2.48; an 8% group ±3.39; a 4% group ±4.80. Scale all of
  these by `sqrt(3)` for n = 500. Age × education cross-tabs, which are exactly what a labour
  ministry wants, are gone.
- **Weighting gets unstable.** Raking to six or seven margins on 500 cases produces extreme weights
  and forces heavy trimming, which pushes the design effect up — so the n = 500 row of the table is
  optimistic about its own design effect, and the true cost is worse than it looks.
- **The NRBA gets weak.** Non-response bias analysis compares respondent and non-respondent
  distributions; at n = 500 the comparisons have no power, so "we found no evidence of bias" becomes
  a statement about our sample size rather than about bias. That is the sentence John Jerrim's FOI
  work exists to punish.

**Decision rule: below n = 1,000 realised completes in a country, we publish no national mean for
that country.** We publish the wave, the response rate, the NRBA and the reason the country is
suppressed. A suppressed country is a credibility asset; a thin country dressed as a full one is
the whole risk.

### 4.5 Reporting floors

- **Country headline:** ≥ 1,000 realised completes AND a completed NRBA. Below that: suppressed.
- **Subgroup:** ≥ 100 unweighted cases in the cell AND a CI half-width ≤ 0.25 SD, with the CI
  printed on every subgroup figure. Below 62 cases the cell is suppressed outright. The 62 is
  NAEP's rule, adopted rather than invented: NAEP reports a student-group result only at n ≥ 62,
  a threshold derived from the sample size needed to detect an effect size of 0.5 with power 0.8
  under an assumed design effect of 2, and it publishes nothing whose standard error rests on
  fewer than five PSUs. **VERIFIED** (NCES, *NAEP Technical Documentation*). Note what that
  threshold is: a *power* rule, not a precision rule — n = 62 at deff 2 still carries a ±0.35 SD
  interval. Our ≥ 100 floor plus the printed CI is the precision half.
- **Cross-tabulations** (age × education, the cell a labour ministry will ask for first) are not
  published at n = 1,500 without deliberate oversampling: most cells land at 50–200 cases, i.e.
  ±0.11 to ±0.35 SD. Report main effects on single margins; buy oversampling if a cross-tab is
  part of the promise.
- **Re-identification floor:** the existing `MIN_COHORT_SIZE = 10` still applies and is a floor on
  disclosure, not on statistical adequacy. The two floors are separate and both bind.

---

## 5. The panel cannot sit the exam

This is the design constraint that most changes the plan, and it is easy to miss because it is not
a sampling fact.

The AILX sitting is **4h 20m across two sessions plus an untimed T1 build window** (spec §01). No
probability panel will field that. PIAAC's in-home session is roughly two hours with an interviewer
present and a paid incentive, and it still lost half its sample at the screener. A four-hour
unsupervised web task, on a panel, at any realistic incentive, produces a completion rate so low
that the panel's probability design is destroyed by its own break-off — you would have bought a
probability frame and returned a self-selected sample from inside it, at ten times the price. That
is the worst of both designs.

So Track B fields a **panel short form**:

- **Target 45–60 minutes**, one session, no untimed window. ESTIMATE: this is at the upper end of
  what a probability panel will complete without severe break-off; the exact tolerable length is an
  **UNKNOWN** we should establish with a randomised length experiment in wave 0 rather than by
  assertion.
- **Matrix sampling.** Each respondent sees a rotated block covering a subset of items across all
  four tracks. No respondent completes the full instrument; the population estimate is recovered by
  IRT scaling and plausible values. This is exactly the PIAAC/PISA design and the reason plausible
  values are mandatory rather than fussy.
- **T1 is the problem.** The Creative Build track's untimed build window is not compressible into a
  matrix block. Options, in order of preference: (a) field a reduced-scope T1 build with a hard
  30-minute cap as a separate rotated block given to a random third of the panel, accepting a larger
  SE on the T1 subscale; (b) field T1 only in the convenience track and publish the national
  composite over T2–T4 with T1 explicitly excluded and the exclusion stated in the headline;
  (c) drop T1 from the population statistic permanently. **Recommendation: (a) for wave 1, with (b)
  as the declared fallback if T1 break-off exceeds 25%.** A composite whose components have very
  different measurement precision is also the Kreiner-style attack surface, so the composite
  weighting sensitivity analysis (§9) must include a T1-in / T1-out contrast.
- **Judging cost scales with the panel, not with the item bank.** T3/T4 are LLM-judged, and judging
  is an evidence-collection step whose output is persisted (spec core invariant). 1,500 panellists ×
  judged tracks is a real per-wave cost line, and it belongs in the budget (§10), not in the
  infrastructure section.

**The short form and the full sitting must be linked, not assumed equivalent.** The link is an
anchor block of common items appearing in both, scaled together, with the linking error reported.
Without that, the national statistic and the individual credential are on two different scales that
merely look alike, which is a trap we would fall into silently.

---

## 6. Mode and device effects

A person doing an authentic AI task on a phone is plausibly doing a different task from a person
doing it on a laptop: different keyboard, different screen area for comparing two images in T2,
different ability to run a model and a document side by side in T3. If device predicts score, and
device is correlated with age, income and country, then a national comparison partly measures
handset mix. This is a real threat and not a hypothetical one.

**Where the comparators stand.** PIAAC is administered on an interviewer-supplied laptop; PISA and
ICILS run on school computers. **The gold-standard adult and youth assessments all fix the device.**
That is a deliberate choice, and it means there is no established adjustment method to copy —
because nobody in this lineage has had to make one. (Confidence: high on PIAAC being laptop-based
and interviewer-administered; the precise device specification per country is **UNVERIFIED**.)

**Detection, in order of strength.**

1. **Randomised device assignment inside the panel.** For a subsample of panellists who own both a
   phone and a laptop, randomise the device of administration. This is the only design that
   identifies a causal device effect rather than a device–person confound. It is cheap relative to
   the wave (a few hundred cases) and it is the single most valuable methodological add-on in this
   document. **Recommendation: build it into wave 1, not wave 2.**
2. **Item-level DIF by device.** Screen every item for differential functioning between phone and
   desktop administration, conditioning on ability. Items with large device DIF — expect T2 image
   comparison to be the worst — are either dropped from the population form or fielded device-locked.
3. **Observational adjustment as a fallback.** Propensity-matched or regression adjustment on
   observed device use. This is weak: device choice is not random, and adjusting on observables
   cannot rule out the confound. It belongs in a sensitivity analysis, never in the headline.

**What we do with what we find.**

- If the randomised experiment shows a device effect **below ~0.1 SD**, we report it and do not
  adjust; we state that device was not fixed and the estimated effect is within our reporting
  precision.
- If it is **0.1–0.3 SD**, we device-lock the population form: the panel short form is administered
  on desktop/laptop only, with the panel vendor providing equipment where needed, and mobile-only
  households become a documented coverage gap with an estimated size (see §7).
- If it is **above 0.3 SD**, or if it is item-specific in a way that does not scale away, we declare
  it a **construct/administration limit**: AILX measures AI fluency *as exercised on a full-size
  computing device*, that is written into the construct definition (spec §03), and every published
  figure carries it. Declaring a limit is cheap. Discovering it after publication is not.

**Design decision now, before the data:** the population form is **device-locked to desktop/laptop
by default**, with the randomised experiment run to test whether that lock is necessary. It is far
easier to relax a lock later than to explain a mixed-mode statistic afterwards. Track A stays
device-open, because Track A's job is reach and item calibration, and its device mix is one of the
things we should measure and publish about it.

---

## 7. Coverage: the offline population, said plainly

**AILX is delivered on the web. Adults who do not use the internet cannot sit it. Therefore no AILX
figure describes them, and every AILX population figure is an estimate for the online adult
population of a country, not for its adult population.**

That sentence, or one like it, goes in the release, above the fold, not in a technical annex. It is
particularly awkward for us because the excluded group is not random with respect to the construct:
the offline population is on average older, poorer and less educated, and is almost certainly at the
bottom of any AI-fluency distribution. **Excluding them biases the national mean upward, and the
bias is in the direction that flatters the number.** We must say that, because a critic will, and
saying it first costs nothing.

Mitigations, from strongest to weakest:

1. **Buy the vendor's offline provision.** Established probability panels recruit offline households
   and supply a device and connection so they can participate (this is standard practice for
   AmeriSpeak, KnowledgePanel and LISS — see §8). This converts most of the coverage gap into a
   cost line. It does not close it for people who decline a device.
2. **Quantify the residual and publish it.** Report the size of the non-internet-using adult
   population from official sources (ITU; national statistical offices; Japan MIC's Communications
   Usage Trend Survey; Korea's NIA digital-divide series; Eurostat; Ofcom), and report what fraction
   of our realised sample came through the vendor's offline provision.
3. **Bound the bias.** Publish a sensitivity analysis: what the national mean becomes if the
   non-covered population scored at the 5th, 10th and 25th percentile of the covered distribution.
   This turns an unmeasured group into an explicit interval, and it is honest arithmetic rather than
   a claim.
4. **Do not** attempt to weight the offline population in. Calibrating web-sample weights to a total
   population that includes people who could never have been sampled is coverage error laundered as
   a weight. It produces a number that looks national and is not.

**Declared limit:** AILX 2026 reports on **adults aged 18–65 who use the internet**. The target
population is written that way in every release, the exclusion rate against the full adult
population is published per country, and any drift toward describing it as "adults" is a
correction-worthy error, not a rounding of language.

---

## 8. Who can actually field this, and what it costs

### 8.1 The vendor map

"Probability panel" is a term the market abuses. The test is whether a person can *join* — if they
can volunteer, it is an opt-in access panel and the price difference is telling you the truth about
the product.

| Country | True probability options | Notes |
|---|---|---|
| **US** | **NORC AmeriSpeak** (NORC National Frame area probability + USPS address frame, in-person non-response follow-up); **Ipsos KnowledgePanel** (ABS, no self-enrolment); **SSRS Opinion Panel** (ABS from the USPS Delivery Sequence File + RDD cell supplement); **USC Understanding America Study** (academic, ABS, published price list) | Pew's American Trends Panel is ABS probability but is in-house and not sold. **VERIFIED** |
| **UK** | **Ipsos KnowledgePanel UK** (random unclustered ABS, launched Aug 2020, >25,000 panellists, tablets + data supplied to digitally excluded households); NatCen Opinion Panel | **VERIFIED** |
| **EU** | Ipsos KnowledgePanel now runs in FR, DE, IT, ES, NL, SE, PL, HR. Academic register-based panels: **LISS** (NL), **GESIS Panel** and **GIP** (DE), **ELIPSS** (FR), Swedish and Norwegian Citizen Panels | The academic panels are research infrastructures with access committees, not vendors — access is by application and the cost model is different. **VERIFIED** |
| **Japan** | **No commercial probability online panel found.** Rakuten Insight, Macromill, Intage, Cross Marketing are opt-in access panels | The Japanese practice for probability general-population data is **ABS push-to-web mail** using a housing/resident-register address frame. A published example (Ome City, 2024) reports **RR3 = 19.2%**, comparable to Asahi Shimbun's national ABS push-to-web. **VERIFIED** |
| **Korea** | **No live commercial probability panel.** KAMOS (area-stratified address sampling) stopped adding members after 2019 for budget reasons; the live probability route is an **RDD-with-follow-up-texting** panel (~10,471 members as of Feb 2023). Embrain, Macromill Embrain, Hankook Research access panels are opt-in | **VERIFIED** for KAMOS/RDD; the opt-in status of the commercial panels is asserted from the absence of any probability claim on their methodology pages — **UNVERIFIED at source level** |

**Consequence for AILX's trilateral (en/ja/ko) framing:** the US and UK can be bought off the shelf.
**Japan and Korea require commissioning a fresh probability sample, not renting panel time** — ABS
push-to-web in Japan, RDD phone-to-web recruitment in Korea. That is more expensive, slower, and
needs a local fieldwork partner. It is also the difference between a cross-national norm and three
convenience samples wearing country labels, which is exactly the PISA-China failure mode
(a technically legal, politically fatal sampling frame) in miniature.

**Why pay for probability at all.** Pew's 2023 methods study compared sample types against 28
benchmarks: opt-in samples averaged **5.8 points of absolute error**, probability panels **2.6
points** — roughly twice the error, and worse in the young and low-education subgroups that matter
most here. **VERIFIED.**

### 8.2 Cost per complete

The only vendor with a published rate card for a long instrument is the **USC Understanding America
Study**: **$3.00 per respondent per minute** for the first 500 respondents, **$2.50/min** after,
plus a **$2,000 handling fee**; about a third of that is respondent incentive; panellists are paid
$20 per 30 minutes. **VERIFIED** (UAS brochure, 2024). Their own worked example: 1,000 respondents
× 15 minutes = $43,250.

Applying that published rate to AILX-shaped lengths (arithmetic on a verified rate, so
**VERIFIED-derived**, but UAS states the basic rate assumes a "relatively straightforward" survey
and quotes complex instrument programming separately — an assessment is complex, so treat these as
**floors**):

| Design | Cost | Per complete |
|---|---|---|
| 1,000 × 30 min | $84,500 | ~$85 |
| 1,000 × 45 min | $125,750 | ~$126 |
| 2,000 × 45 min | $238,250 | ~$119 |

AmeriSpeak, KnowledgePanel and SSRS publish **no per-complete rate card** for custom work
(AmeriSpeak publishes Omnibus pricing only: $1,000 per question for questions 1–5, $850 for 6–10,
$750 thereafter, minimum three questions — **VERIFIED**, and not usable for an assessment).

Planning figures, marked clearly: **ESTIMATE, market judgement, must be replaced by real quotes
before any budget is committed.**

- US probability panel, 10–20 min: **$25–$60 per complete**.
- US probability panel, 30–45 min general population: **$75–$200+ per complete**.
- Fresh ABS or RDD recruitment with no existing panel (i.e. **Japan and Korea**):
  **$150–$500+ per complete**.
- Incentive alone for a 30–45 minute *effortful, scored* task: **$25–$50** in the US, roughly
  1.5–2× the plain-survey rate for the same minutes, because an assessment feels like work and
  returns a judgement the respondent may not want. PIAAC's anchor: the US paid **$100** per
  completed assessment plus **$5 unconditional** with the mailed screener, for a ~105-minute
  in-home assessment, and still got 28% overall. **VERIFIED.**

### 8.3 Burden: the finding that should change the design

Length does not mainly cost you refusals. It costs you the *low scorers*, which biases the national
mean upward — in the same direction as the coverage bias in §7, so the two errors compound rather
than cancel.

- Web-survey dropout before completion: **31.8% at 10 minutes, 43.2% at 20, 53.2% at 30**, with
  about 30% of all dropouts occurring in the first four pages. **VERIFIED** (Statistics Sweden;
  the underlying reference is Galesic & Bosnjak, *POQ* 73(2), 2009).
- Test-specific: Kleinert, Christoph & Ruland (*Sociological Methods & Research*, 2019) ran a split
  design in the German NEPS adult panel — two competency tests versus one. The longer-test group
  was **not** more likely to refuse the interview, but **was** significantly more likely to use
  **test-avoidance strategies** (skipping or abandoning the test while staying in the survey), and
  **low test performance itself predicted dropping out of later waves**. **VERIFIED.**
- Splitting a long instrument into modules is not a free fix: Peytchev et al. (*JSSAM*, 2019) found
  modularisation **increased** total non-response, though disproportionate incentive allocation
  toward the first module helped. **VERIFIED.**

**Three design consequences, adopted:**

1. **Report an assessment-completion rate separately from the survey response rate**, and compute
   both to AAPOR definitions. A panel that answers the background questionnaire and abandons the
   tasks is a non-response we would otherwise hide inside a completion percentage.
2. **Pay for the assessment, not for the click.** Incentive weighted toward completion of the
   scored blocks, with the schedule published.
3. **Treat break-off as informative, not missing at random.** Break-off cases enter the NRBA as a
   named group with their partial performance data, because the evidence says they are
   disproportionately low scorers.

---

## 9. Weighting

### 9.1 What the comparators actually do

**US PIAAC Cycle 2** (NCES technical notes, **VERIFIED**): base weights from the inverse selection
probability at four stages (PSU, secondary unit, dwelling unit, person) → stage-specific
**non-response adjustment** using classification-tree cells → post-stratification → compositing →
**raking** → **trimming**. The raking margins are **age, gender, race and ethnicity, educational
attainment, country of birth (US / outside US), and place of residence**, calibrated to the
**American Community Survey** (the state supplemental sample post-stratified to ACS 2022 1-year
PUMS). Variance: **80 replicate weights, Fay's BRR with Fay factor 0.3**, with the entire weighting
chain re-run inside every replicate. Note what is *not* a margin: household income, urbanicity,
internet access.

**NORC AmeriSpeak** (**VERIFIED**): panel-level raking to CPS + ACS + NHIS on age group, sex,
education, race, ethnicity, **housing tenure**, **household phone status** (cell-only / dual /
landline-only), age × sex, age × race-ethnicity, Census division; study-level raking to the March
CPS supplement (ASEC). Trimming is a **penalised calibration**, not a percentile cut, and the
selection rule is explicit: choose the penalty so that the **study design effect is below 2**, the
MSE with trimming beats the MSE without, and the penalty stays as small as possible. **That "deff
< 2" is the operational ceiling a leading probability panel imposes on itself, and it is the number
to hold ourselves to.** AmeriSpeak also reports that **13% of recruited households have no internet**
and that the panel over-represents low income before weighting (19.4% under $30k against a 14% CPS
benchmark).

**Ipsos KnowledgePanel** (**VERIFIED**): panel weights benchmarked to the March CPS on gender, age,
race/ethnicity, education, Census region, **household income (7 bands)**, homeownership,
**metropolitan area**, Hispanic origin and **language dominance**; those panel weights then serve as
the **measure of size for a PPS draw**, which makes each study sample near-EPSEM before any
study-level adjustment. Then non-response and coverage adjustment, **raking (iterative proportional
fitting)**, trimming of extreme tails, rescale to n. KnowledgePanel supplies **a tablet and free
internet to households recruited without internet access**, and says plainly that its reason is
mode purity — a single mode of data collection avoids mode effects.

**Pew ATP** (**VERIFIED**): two-stage **calibration**, with margins from the 2023 ACS
(age, age × gender, education × gender, education × age, race/ethnicity × education, × gender,
× age, nativity among Hispanic and Asian respondents, years in the US, census region × metropolitan
status), plus volunteerism and voter registration from CPS supplements, and — directly relevant to
us — **frequency of internet use**, sourced from NPORS, an address-based mail/web survey that
*includes non-internet users*. Weights are trimmed at the 1st and 99th percentiles.

### 9.2 Realised design effects

Derived from Pew's published unweighted n and design-effect-inflated margins of error (inputs
**VERIFIED**, the ratio arithmetic is **DERIVED**): total sample deff ≈ **1.20**; ages 18–29 ≈ 1.33;
high-school-or-less ≈ 1.34; older and mid-education groups ≈ 1.14–1.26.

**Planning range: deff 1.15–1.35 for a well-run general-population panel with no oversampling; 1.5–2.5
if heavily oversampled, untrimmed, or raked on many conflicting margins; hold the operational
ceiling at 2.0.** Kish: `deff_w = 1 + CV²(w)`, so deff 1.3 is CV(w) ≈ 0.55 and deff 2.0 is CV(w) ≈
1.0. **A realised CV(w) above 1.0 is a weighting problem, not a sampling problem**, and it must be
reported rather than trimmed away silently. The §4 precision table's planning value of 1.6 is
therefore conservative relative to observed panel practice, which is the right direction to be
wrong in.

### 9.3 The AILX weighting scheme

**Pipeline (copy the standard, do not invent):** design weight → response-propensity cell
adjustment (classification tree or logistic propensity on frame and profile covariates) → **raking
to national frame margins** → penalised trimming targeting deff < 2 → re-rake → replicate weights
(Fay's BRR, 80 replicates, whole chain re-run per replicate).

**Margins, per country, from the national statistical frame:**

| Margin | Source | Status |
|---|---|---|
| Age group | census / ACS / LFS equivalent | required |
| Sex | same | required |
| Educational attainment | same | required — the strongest correlate of the construct |
| Region (× metropolitan status) | same | required |
| Race / ethnicity / nativity | where the country collects it (US yes; JP/KR effectively not) | country-dependent, stated per country |
| **Frequency of internet use / device access** | a reference survey that covers non-users: NPORS (US), Ofcom (UK), MIC Communications Usage Trend Survey (JP), NIA digital-divide series (KR), Eurostat ICT household survey (EU) | **required for AILX specifically** |
| Household income | CPS-style source | optional; it costs weight variance and PIAAC does not use it |

The internet-use margin is the one departure from PIAAC's list, and it is deliberate: PIAAC does not
need it because PIAAC is administered in person, and AILX is not. Weighting on internet-use
frequency **within the covered (online) population** is legitimate and useful. Weighting to a total
that includes people who could never have been sampled is not (§7).

**Raking vs calibration vs propensity, and what each buys.** Raking (iterative proportional fitting)
forces the weighted sample onto published *marginal* totals, which is why it dominates practice —
statistical offices publish age × sex and education marginals and rarely the full joint. It does
nothing about a variable you did not name, and it inflates weight variance when margins conflict.
GREG calibration generalises it: it can use continuous auxiliaries and becomes regression-assisted,
so it genuinely reduces variance when the auxiliary correlates with the outcome; AmeriSpeak's
penalised distance function is calibration and trimming unified into one estimator. Propensity
adjustment models the response (or panel-membership) probability using rich covariates that have no
published population total, then hands off to raking to guarantee the published margins are hit
exactly.

**Recommendation: propensity-cell adjustment, then raking, then penalised trimming, with GREG
calibration as a published sensitivity analysis rather than the headline estimator.** Every figure
is published with the margin list, the frame source and vintage, the realised CV(w), the realised
deff, and the estimate recomputed under at least one alternative weighting scheme. If the headline
moves materially under a defensible alternative scheme, that instability is the finding, and it goes
in the release.

---

## 10. Non-response bias analysis: published first, unprompted

### 10.1 Why this section exists

PISA 2018 required an 85% school response rate. England reached 72% and Northern Ireland 66%,
which triggered mandatory non-response bias analyses. Those analyses were **not published**. John
Jerrim obtained them by **Freedom of Information request** and found that schools with historically
lower achievement were less likely to respond, while the official texts had said only that the
results "supported the case that no notable bias would result". **VERIFIED.**

The bias was real but survivable. The *appearance of concealment* was not: it converted a technical
limitation into a story about hiding, and it is the reason "unpublished non-response analysis" sits
third on the list of things that get an index dismissed — above the bias itself.

**AILX's commitment: the NRBA is published in the same release as the estimate, on the same day, in
the same bundle, before anyone asks for it.** Not on request, not in an appendix issued later, not
"available to researchers". §3's rule S7 makes this structural: the release artefact does not build
without the NRBA file present.

This is cheap to promise and cheap to keep, and it buys the one thing a young private instrument
cannot buy any other way — the presumption of good faith. We should also state the response rate in
the headline release, not only in the technical annex, and we should state PIAAC's 27.8% next to it,
because the honest comparison is the argument.

### 10.2 When it is triggered

- **Always.** OECD's PIAAC Technical Standards require a non-response bias analysis for every
  country and an *extended* NRBA below a 70% response rate. **VERIFIED.** AILX will never be above
  70%, so treat the extended form as the only form.
- **Per country, per wave.** No pooling, no "we did this last year".
- **Track A too, in a reduced form.** The convenience cohort gets a published *self-selection*
  analysis — who plays, compared to what population benchmark — precisely because Track A is the
  thing most likely to be misread as a population. Publishing how unrepresentative it is, in
  numbers, is the most effective protection the number has.

### 10.3 The published NRBA template

The structure below follows what the NCES and OECD standards require of federal surveys
(level-of-effort analysis, frame comparison, benchmark comparison, response-propensity modelling,
and bias estimates before and after weighting). **Confidence: the components are standard and
appear across NCES/OECD non-response guidance; the exact clause numbering of NCES Statistical
Standard 4-4-A is UNVERIFIED here and should be checked against the current NCES standards document
before we cite it by number.**

> **AILX Wave N Non-Response Bias Analysis — [Country]**
>
> **1. Design and disposition.** Frame, sampling method, and the full AAPOR disposition table:
> sampled, ineligible, refused, non-contact, broke off, completed background questionnaire,
> completed assessment. Response rates computed to **AAPOR RR3**, reported separately as (a) panel
> recruitment rate, (b) panel profile/retention rate, (c) study response rate, (d) **assessment
> completion rate**, and (e) the **cumulative response rate**, which is the product and is the only
> honest headline figure. State PIAAC's 27.8% alongside it for calibration.
>
> **2. Level-of-effort analysis.** Estimates recomputed by number of contact attempts and by days
> to response. If the mean drifts monotonically with effort, late respondents resemble
> non-respondents, and the drift is an estimate of the direction of the remaining bias. Report the
> drift with its CI, and report what the estimate would be under a linear extrapolation to the
> non-respondents.
>
> **3. Frame comparison.** Respondents versus the full drawn sample on every variable known for
> both (all panel profile variables — age, sex, education, region, income, device, internet use).
> Report standardised differences, not p-values, and flag any |d| > 0.1.
>
> **4. Benchmark comparison.** The weighted realised sample against official population benchmarks
> on variables *not* used as raking margins. Margins used for raking match by construction and
> prove nothing; only the unused variables are evidence. Name in advance which variables are held
> out for this purpose.
>
> **5. Response-propensity model and R-indicators.** A model of P(respond | covariates); the
> distribution of estimated propensities; the R-indicator and the coefficient of variation of the
> propensities, as a summary of how far the realised sample is from representative. Report the
> partial R-indicators to show *which* variables drive the imbalance.
>
> **6. Estimated bias before and after weighting.** For every headline estimate and every reported
> subgroup: the unweighted estimate, the weighted estimate, the change, and the change expressed as
> a fraction of the standard error. Weighting that moves an estimate by more than its own SE is a
> warning, not a reassurance.
>
> **7. The break-off analysis, which is specific to an assessment.** People who start the
> assessment and abandon it are not missing at random: the panel evidence says test burden shows up
> as test *avoidance* rather than refusal, and that low performers are the ones who leave
> (Kleinert, Christoph & Ruland 2019 — **VERIFIED**). Report the partial-response scores of
> break-off cases and a bounded estimate of the national mean under the assumption that break-offs
> would have scored at the 10th, 25th and 50th percentile of completers. **This bound, not the
> point estimate, is the honest range.**
>
> **8. Coverage.** The size of the non-internet-using adult population from official sources, the
> share of the realised sample recruited through the vendor's offline provision, and the §7
> sensitivity bound.
>
> **9. Conclusion, stated as a direction and a magnitude, never as an all-clear.** The required
> form is: "the estimate is likely biased [upward/downward] by approximately X points, and the
> range consistent with our analyses is [a, b]". The phrase "no notable bias would result" is
> banned from AILX releases — it is the exact sentence the PISA England analyses used, and it is
> what the FOI was needed to check.
>
> **10. Microdata and replication.** Location of the public microdata file, the weighting and
> variance code, and the version of the estimator used. Kreiner and Christensen's re-analysis of
> PISA was only possible because the data was public; publishing microdata converts an attack
> surface into a credibility asset.

---

## 11. What we may honestly say, at each stage

This is the section that will be used most and read least carefully, so the language is written out
in full rather than described. The moment credibility is spent or kept is the first publication that
happens **before** a panel exists — which is the stage we are at now.

### Stage 0 — calibration cohort (today; n ≈ 45, summit)

**May say:** item difficulty and discrimination estimates; that the instrument spreads a capable
cohort; qualitative findings; that this is a calibration and item-development cohort, as the spec
already states.
**May not say:** anything with a population noun in it. No percentile against "people", no band
described as a standard.

### Stage 1 — convenience sample at scale (Track A, thousands of sittings, no panel)

This is the dangerous stage, because the n gets big enough to feel like evidence.

**The rule: a Track A finding may describe the people who took it, and may describe items,
behaviour and relationships. It may never describe a country, a population, or "adults".**

Safe forms:

- ✅ "Among 12,400 people who chose to take AILX, 8% correctly identified all five synthetic
   images." — a statement about takers.
- ✅ "Confidence was uncorrelated with accuracy (r = .04) in this cohort." — a *relationship*, which
   is far more robust to selection than a mean, and is where the good Track A findings live.
- ✅ "Item 2026.1-T2-014 has a difficulty of −0.8 logits and discriminates well." — an item property.
- ❌ "8% of adults can spot AI-generated images."
- ❌ "Japanese users scored 12 points below US users." — this is two convenience samples with
   different recruitment channels, and the difference is a channel effect until proven otherwise.
- ❌ "AILX finds AI literacy is low." — no population, no verb tense that implies one.

**The exact hedging block**, to be attached to any Track A publication, verbatim, above the finding
and not below it:

> **How this sample was collected, and what it cannot tell you.**
> These results come from the AILX open cohort: N people who found AILX and chose to take it. This
> is a **self-selected convenience sample**, not a representative sample of any population. People
> who take an AI-literacy exam voluntarily are, on average, more interested in AI, younger, more
> educated and more online than the population they were drawn from, and everyone in this sample
> uses the internet by construction. We do not know the size or direction of the resulting bias,
> and we cannot estimate it from these data. **No figure here is a national or population estimate,
> and any number in this document that is compared across countries is comparing recruitment
> channels as much as people.** For context, the OECD's PIAAC — an in-home, interviewer-administered,
> incentive-paid probability survey — achieved a 27.8% response rate in the United States; getting a
> population estimate is hard even when it is the whole point of the design, and it was not the
> design here. AILX will publish population estimates only from its probability-panel track, with
> weights, replicate standard errors and a non-response bias analysis attached. Until then, treat
> everything here as a description of AILX's users.

Two words we do not use about Track A, in any language, ever: **"national"** and
**"representative"**. And one framing we do not use: a headline number with a country flag next to
it.

**On the "N is large" temptation:** the correct internal response to "but we have 200,000
respondents now" is §1. Write it on the wall.

### Stage 2 — first panel wave, one or two countries

**May say:** "Estimated mean AI-literacy score for internet-using adults aged 18–65 in [country],
2026: X (95% CI a–b), from a probability panel of n, weighted to [margins] from [frame], overall
response rate R%, with the non-response bias analysis published alongside."
**May not say:** anything comparative that we lack a second country for, and no trend — a first wave
has nothing to trend against.
**Must say, in the headline release, not the annex:** target population is internet-using adults;
the excluded offline population and its estimated size; the response rate; the direction of the
likely residual bias.

### Stage 3 — multi-country, multi-wave

**May say:** country comparisons **as overlapping bands, never as ranks** (§4.3); trends with the
linking-error term included in the interval; subgroup breakdowns above the §4.5 floors.
**May not say:** that a change between years is a change in the population, unless the frozen
trend form (§12) supports it. On a re-versioned instrument, the alternative explanation is always
the instrument.

### The precedent to copy, and the one to avoid

**Copy: the TIAA Institute–GFLEC Personal Finance (P-Fin) Index.** A private sponsor buys a
28-item knowledge test on **Ipsos KnowledgePanel** (n = 3,602), publishes it annually for a decade
as an "index" or "barometer", and also releases an open short form anyone can take. **VERIFIED.**
That is exactly the AILX shape: probability panel for the statistic, open instrument for reach, and
the two never confused. It is also proof that a private organisation can buy probability panel time
and publish a credible national knowledge statistic — the thing being proposed here is not novel.

**Avoid: the FINRA National Financial Capability Study's presentation**, which fields an opt-in
quota sample and quotes the margin of error a probability sample "would have". **VERIFIED.** That
sentence is the single most quotable methodological error available to us, and we should never write
its equivalent. If we do not have a probability sample, we quote no margin of error at all.

---

## 12. Two things that will break the statistic even if the sampling is right

Included here because they are the reason a correct sample can still produce a wrong headline, and
because both fixes are sampling-design decisions that must be made *before* wave 1.

**12.1 The basket problem — annual re-versioning is a basket change every year.** The CPI's four
Boskin biases map onto AILX, and **new-product bias is the fatal one**: an item that discriminated
in 2026 (six-fingered hands, hallucinated citations) is trivial or impossible in 2027 because the
*generators* changed. A falling national score may mean the population got worse, or that the
generators got better, and **the two are not separable without an explicit anchor design**.
Mitigation, following NAEP's Long-Term Trend pattern: carry a **frozen trend form** — fixed items,
fixed generator vintages — alongside the current form, field both in the same wave, and **report the
headline trend only on the frozen line**, with the current form reported as a level, not a change.
The panel budget must therefore include the frozen block in its minutes, which costs form length,
which costs response rate. That trade is real and should be made deliberately.

**12.2 The composite problem.** AILX sums four heterogeneous tracks to 400 points, and the
across-track weighting is a design choice, not an estimated parameter. Kreiner and Christensen
dismantled PISA's country rankings by showing the ordering was not robust to defensible alternative
models — and a hand-weighted four-track composite is *more* exposed to that attack than PISA is.
**Before any country ordering is published, run and publish a weighting-sensitivity analysis**: how
the ordering changes under equal weights, under reliability weights, under a single-factor model,
and with T1 in and out (§5). If the ordering flips under a defensible alternative, we report track
scores and no composite ranking. That is a cheaper outcome than having someone else find it.

---

## 13. Costing the first credible release

All figures **ESTIMATE** unless marked. They are built from the one published rate card (UAS) plus
market-judgement ranges, and every one of them must be replaced by a real quote before commitment.
The purpose of this section is to make the decision legible, not to be a budget.

### 13.1 Per-country fieldwork

| Country | Route | n | Per complete | Fieldwork |
|---|---|---|---|---|
| US | KnowledgePanel / AmeriSpeak / SSRS custom, 45 min | 2,000 | $120 (range $75–200) | **$240k** ($150–400k) |
| UK | Ipsos KnowledgePanel UK, 45 min | 2,000 | $110 (range $70–190) | **$220k** ($140–380k) |
| Japan | commissioned ABS push-to-web, no panel to rent | 1,500 | $250 (range $150–500) | **$375k** ($225–750k) |
| Korea | commissioned RDD phone-to-web recruitment | 1,500 | $250 (range $150–500) | **$375k** ($225–750k) |

The asymmetry is the headline finding of §8: **the two countries in AILX's trilingual framing are
the two that cannot be bought off the shelf**, and they cost roughly twice as much per complete for
a smaller n.

### 13.2 Non-fieldwork costs, per wave

| Line | Estimate | Note |
|---|---|---|
| Panel short-form build (matrix design, block rotation, device lock, telemetry) | $60–120k | mostly in-house engineering; one-time, then maintenance |
| Sampling and weighting contractor (design weights, propensity, raking, replicate weights, plausible-value scaling) | $80–150k | do not do this in-house in wave 1; "nobody marks their own homework" is a governance requirement, not a preference |
| NRBA production and publication | $30–60k | usually the same contractor |
| Independent technical advisory board + external psychometric review | $30–60k | the antidote to the Meyer critique of a non-mandated body ranking nations |
| Translation and localisation, per non-English country | $30–60k | cApStAn-style verification; PIAAC uses a dedicated translation contractor |
| LLM judging for T3/T4 at panel scale | $10–30k | ~$3–8 per sitting × 3,500–7,000 sittings; small relative to fieldwork, and it is a per-wave recurring cost |
| Microdata publication, documentation, replication code | $20–40k | |

### 13.3 Three release shapes

| Option | Countries | n | Estimated total | What it buys |
|---|---|---|---|---|
| **A — minimum credible** | US only | 3,000 | **$0.6–0.9M** | one defensible national estimate, subgroups reportable, an NRBA, and a published method. No comparison, no trend. |
| **B — recommended first release** | US + UK | 2,000 each | **$0.8–1.2M** | two estimates, one genuine cross-national comparison on a common language, both off-the-shelf frames, lowest execution risk. Establishes the method before spending on hard frames. |
| **C — the trilateral claim** | US + JP + KR (+UK) | 1,500–2,000 each | **$1.9–2.8M** | the cross-national norming claim in the spec, and the only version that supports "cross-nationally normed" as written. Highest execution risk: two commissioned fresh samples, two translations, and DIF screening across three languages. |

**Recommendation: B, then C.** Option B proves the pipeline — short form, weighting, plausible
values, NRBA, publication bundle — on frames that can be bought, at roughly a third of C's cost. Do
C in wave 2 with the method already public and reviewed, rather than debugging the method and the
Japanese address frame in the same quarter.

**What none of these buys.** None of them is PIAAC. PIAAC realised ~5,200 adults per country with
in-home administration and a $100 incentive, and still reported 27.8% in the US. We are buying a
smaller, web-delivered, online-population estimate for a fraction of the cost, and the release
should say so in those words. An honest smaller claim is worth more than a large claim that a
methodologist can take apart in an afternoon.

---

## 14. Decisions taken in this document

1. Two tracks, never mixed. Item parameters cross A → B; person scores never enter a population
   estimator (§2).
2. The separation is enforced by schema and by a guard test, not by policy (§3).
3. Floor n = 1,000 realised completes for any published national mean; target 1,500; buy 3,000 where
   subgroups are promised (§4).
4. No country ranking. Overlapping bands only (§4.3).
5. The panel fields a 45–60 minute matrix-sampled short form, not the 4h 20m sitting; the short form
   and the full sitting are linked by an anchor block with published linking error (§5).
6. The population form is device-locked to desktop/laptop by default, with a randomised device
   experiment in wave 1 to test whether the lock is necessary (§6).
7. Target population is **internet-using adults 18–65**, stated in every release; the offline
   population is a declared, quantified, sensitivity-bounded exclusion (§7).
8. Weighting: propensity cells → raking to national-frame margins including internet-use frequency →
   penalised trimming targeting deff < 2 → Fay-BRR replicate weights (§9).
9. The NRBA is published in the same bundle as the estimate, always, with the break-off bound, and
   "no notable bias" is a banned phrase (§10).
10. Track A publications carry the §11 hedging block verbatim, and never use "national" or
    "representative".
11. A frozen trend form is fielded from wave 1, and headline trends are reported only on it (§12).
12. First release: US + UK, n = 2,000 each, roughly $0.8–1.2M (§13).

---

## 15. Open questions and unknowns

- **UNKNOWN:** the true design effect of any vendor's panel for our instrument. Wave 1 must report
  the realised CV(w) and deff, and §4's table should be rewritten with real numbers afterwards.
- **UNKNOWN:** the tolerable form length for a probability panel taking a scored assessment. Settle
  it with a randomised length experiment in wave 0, not by assertion. Note that USC's UAS caps any
  single sitting at 30 minutes, which is *shorter* than our planning assumption — that alone may
  force a two-session panel design, with the §8.3 warning that modularisation can increase total
  non-response.
- **UNKNOWN:** whether T1 can be fielded on a panel at all (§5).
- **UNVERIFIED:** the opt-in status of specific Japanese and Korean commercial panels is inferred
  from the absence of a probability claim, not from a vendor statement. Confirm before publishing
  the vendor map.
- **UNVERIFIED:** per-complete pricing for AmeriSpeak, KnowledgePanel and SSRS custom work. Three
  real quotes should replace §13's estimates before any budget decision.
- **UNVERIFIED:** the clause numbering of NCES Statistical Standard 4-4-A (§10.3).
- **NOT YET DESIGNED:** the conditioning model for plausible values, and which background variables
  must be in it to support the subgroup breakdowns we intend to publish. This has to be decided
  *before* fielding, because it determines the background questionnaire.
- **NOT YET DESIGNED:** DIF screening protocol across en/ja/ko, which is a prerequisite for option C
  and is the known worst case for T2, where the "tells" of synthetic media are culture-specific.
