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
   treatment is multiple imputation (5–10 plausible values, Rubin's rules), which adds imputation
   variance `(1 + 1/M)·B` on top of sampling variance `U`. ESTIMATE: **expect a 10–30% inflation of
   the standard error** relative to the table above for a form of AILX's likely panel length.
   Reporting a mean without this is the single easiest way to overstate precision, and it is the
   thing a hostile methodologist checks first.
2. **Linking error, for any year-over-year comparison.** Trend statements need an explicit
   linking-error term added to the SE of the difference (PISA does this; we must too — see §9 on the
   frozen trend form).

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
- **Subgroup:** ≥ 100 unweighted cases in the cell AND a CI half-width ≤ 0.25 SD. Below that:
  the cell is reported as "not estimable at this sample size", with the n shown.
- **Re-identification floor:** the existing `MIN_COHORT_SIZE = 10` still applies and is a floor on
  disclosure, not on statistical adequacy. The two floors are separate and both bind.
