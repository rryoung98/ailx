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
