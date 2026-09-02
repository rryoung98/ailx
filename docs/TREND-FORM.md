# TREND-FORM.md — the frozen anchor, and what a change in the index may be blamed on

Status: design document, first draft. Public on purpose, like `docs/SAMPLING.md`. The method is
publishable. The item bank is not. Nothing in this file names an item, an asset, a key or a
generator prompt.

Companion documents: `docs/SAMPLING.md` §12.1 (the basket problem, which this file answers),
`docs/TRACK-REVIEW.md` §2 and §9 (what T2 measures and what shipped),
`AILX-Spec-2026.1.md` §09 (three-tier item pool, cross-year comparability) and §14 (re-versioning).

Marking follows `docs/SAMPLING.md`. **VERIFIED** means a primary source was read and is cited.
**QUALIFIED** means the source was read and says something narrower than the claim it was cited for.
The narrower reading is written out.
**ESTIMATE** means an engineering judgement with the reasoning shown. **DECLARED** means a threshold
we chose rather than derived, which is not the same as a finding. **UNKNOWN** means we do not know
and have not pretended to.

---

## 0. The one-paragraph version

AILX re-versions its operational form every year. The frontier moves faster than the form does.
On a re-versioned instrument a fall in the score cannot be told apart from generators getting
better. That is the CPI's new-product bias. So AILX carries a second instrument that never changes.
It is a **frozen anchor form** of T2 discrimination items on pinned generator vintages. It is
fielded in the panel wave beside the operational form. It is scored by arithmetic with no model in
the loop. The headline **trend** is reported on the frozen line only. The operational form is
reported as a **level**, never as a change. The frozen line answers one narrow question: *can adults
still tell 2026-vintage synthetic media and hostile messages apart from camera-captured media and
legitimate mail?* It is not a trend in AI literacy. Saying which of the two we measured is the point
of the design.

---

## 1. What is in the anchor form, and what is not

### 1.1 The contents

**The anchor form is T2 only: 40 discrimination items, of which 32 are media and 8 are message.**
Every respondent sees the 32-item **core**. The 8 **canary** items go to a random one-in-eight
subsample and exist to detect a leak (§2.4), so mean exposure is 33 items. Fixed presentation
order, fixed exposure time per item, fixed instructions, fixed renderer. It is an **external
anchor**: its items are scored for the trend line and contribute nothing to the candidate's
operational composite.

Why T2 and nothing else, in order of weight:

1. **It is keyed.** Every anchor item has a right answer stored beside it. Scoring is arithmetic on
   response data with zero marginal cost at any n (`docs/TRACK-REVIEW.md` §2.3). A trend line whose
   scoring cost is zero can be recomputed in 2031 by anyone holding the responses.
2. **No model is in the loop, so no model version can move the series.**
   Sunkavalli (2026, arXiv:2608.29517; 2,377 essays, 12 judges, 4 providers) measured all five
   model-version contrasts moving judge severity beyond a permutation null, **up to 133 points of
   1,000**, with one judge deprecated mid-study. **VERIFIED** (private evidence base,
   `EVIDENCE-JUDGE-AGREEMENT.md` §2). A judged anchor would carry a year-over-year severity shift
   larger than any population change we could plausibly detect. It would also be inseparable from it.
3. **It compresses.** T2 is the only track that fits a matrix block cleanly: short discrete items,
   fixed exposure, no rater, no artefact, no window (`docs/TRACK-REVIEW.md` §2.6).
4. **Its content can be frozen.** An image is bytes we hold. A T3 sitting depends on a
   live assistant model we do not own and cannot pin for five years. Providers retire endpoints.
   You cannot freeze a dependency somebody else deprecates.

### 1.2 What is excluded, and what that costs

| Track | Excluded because | The cost of excluding it |
|---|---|---|
| **T1 Creative Build** (160 pts, .40 weight) | Scored partly by a blinded human comparative-judgement panel. A rater panel cannot be frozen, and rater turnout is already the thing that breaks T1 at scale (`docs/TRACK-REVIEW.md` §3.3). | The flagship track, and the one with an external criterion, has no trend line at all. |
| **T3 Calibrated Reliance** (160 pts, .40 weight) | Needs a live assistant model and, for the 45-point analysis component, an LLM judge. Both drift on somebody else's release schedule. | The strongest construct in the instrument is reported as a level only. |
| **T4 Generative Direction** (0 pts) | Unscored showcase since 2026-09-01 (`docs/TRACK-REVIEW.md` §9.1). | Nothing. |

**There is no trend line for the composite.** The anchor covers T2,
which is 0.20 of the composite z-score. Publishing a "national AI-literacy trend" off a frozen block
that carries a fifth of the construct would be the same overclaim this document exists to stop. What
may be published as a trend is the **anchor subscale** under its own name. What may be published as
a level is everything else, per wave, with the form version printed beside it.

**The half of T3 that could be anchored later, and is not being anchored tonight.** The model-free
reliance block (planted errors, no judge, 115 of T3's 160 points) survives compression and needs no
rater. It still needs a live assistant, so freezing it means freezing a model. Run a pinned
open-weights assistant on our own infrastructure at fixed weights, decode settings and serving
stack, and that block becomes anchorable. The composite then gets a second frozen leg. **We do not
know what that costs.** One wave's serving bill for a pinned 8B-class assistant at panel volume
would tell us. It is not in scope here.

### 1.3 Why the anchor is bigger than the spec's secure block

`AILX-Spec-2026.1.md` §09 already commits to an **anchor — secure block — 8–12 items embedded in
every annual form, never released, never rotated**. That block equates the *examination* year to
year. It is too small to carry a population trend, and the arithmetic says so. A rate measured on 8
binary opportunities at p = 0.5 has SE = 0.177 and a 95% interval of about ±0.35. About **97
opportunities are needed for a ±0.10 interval** (private evidence base,
`EVIDENCE-CALIBRATED-RELIANCE.md` §3 / `EVIDENCE-RELIABILITY-AND-TIME-PRESSURE.md` §A12; the doc
marks this as its own arithmetic, not a published result). **VERIFIED as arithmetic.**

That interval is the *per-person* one. A population mean over n = 1,500 is far tighter than any
one person's rate. Do not confuse the two uses:

- **For the population mean, 33 items is enough.** The binding uncertainty is item-level drift, not
  item count (§4.4).
- **For an individual anchor score, 33 items is not enough** (±0.17 at p = 0.5). The anchor form
  therefore issues no individual score and appears on no report.

33 rather than 97 is a deliberate trade against testing minutes (§6). We are buying a cohort mean,
not a person score.

---

## 2. Security, which is the part that fails first

A frozen form that is published, practised against, or over-fielded is burned. **A burned anchor is
worse than no anchor.** It keeps producing a comparable-looking number while the thing it
compares has changed. The rules below make that state detectable rather than assumed away.

### 2.1 Exposure budget

**12,000 administrations per cycle. DECLARED.** The arithmetic: up to four countries × 3,000 panel
completes is 12,000 (`docs/SAMPLING.md` §4, §13.3 option C). One number, not a target plus a cap.
A budget with headroom above it is a budget nobody enforces. Exceeding it does not void the wave.
It opens the §3 replacement review, and the overrun is reported with the wave.

Two rules go with it:

- **No panellist sees the anchor twice inside 24 months.** Repeated exposure does not only teach
  answers. Bucinca et al. (2021, N = 199) found people "rarely engage analytically with each
  individual AI recommendation" and instead "develop general heuristics about whether and when to
  follow the AI suggestion". **VERIFIED** (private evidence base,
  `EVIDENCE-RELIABILITY-AND-TIME-PRESSURE.md` §B4). A person who has met the form once can answer it
  with a policy instead of a perception.
- **Track A never sees the anchor.** Not in play mode, not in the demo, not in a share card, not in
  a full web sitting. Track A is self-selected and retakes freely. Its whole growth loop is
  screenshotting items (`docs/TRACK-REVIEW.md` §2.2). The anchor is panel-only. That costs us the
  ability to compare a Track A candidate against the frozen line, and we accept it.

### 2.2 Who may see it

A named list, kept as a dated ledger, not a role description:

1. The psychometric lead and the two item authors who built the form.
2. The panel vendor's field system, which serves the media and returns responses. It holds assets
   and no keys.
3. The independent third-party deposit required by `AILX-Spec-2026.1.md` §09.

Not on the list, and this is enforced by the repository split (`AGENTS.md`): the public repository,
the practice tier, the static demo, any share surface, and any bundle a browser can fetch. The
anchor lives with the operational bank in the private backend repo, served by digest.

### 2.3 Is it ever released?

**Not while it is the live anchor, and not at retirement either — only after the successor anchor
has been fielded in two waves.** An auditor re-checking the old series needs the items. Publishing
them ends the old series permanently. After two successor waves the old line has been carried
across, so its retirement costs nothing further. Retired anchor
items never enter an operational form.

### 2.4 How a leak would be detected

No single signal is convincing. Four are run every wave, and the design pre-commits to the
thresholds so the analysis is not read backwards.

1. **Response-time profile, per item.** A memorised item is answered faster with the same or better
   accuracy. Flag: median time-to-response on an item falls by more than **30%** against its baseline
   wave while accuracy rises by more than **5 percentage points**. DECLARED thresholds. This signal is
   device-confounded and must be read within device class. Measured total device latency spans
   **35 ms to 140 ms** across 26 handsets. The authors warn it may be "misattributed as individual
   or group differences in response times" (Hassenstab et al. 2023, via `docs/SAMPLING.md` §6).
   **VERIFIED.** A 105 ms spread is small against a 25-second item and large against nothing else we
   log. So this is a screen, not a verdict.
2. **Near-perfect clustering.** The base rate for a perfect score on this task is close to zero.
   The number the spec quotes is "In a 2,000-person study, 0.1% correctly classified every item"
   (`AILX-Spec-2026.1.md` §09). It traces to an iProov press release of 12 February 2025: "The study
   tested 2,000 UK and US consumers ... only 0.1% of participants could accurately distinguish real
   from fake content across all stimuli"
   (https://www.iproov.com/press/study-reveals-deepfake-blindspot-detect-ai-generated-content).
   **QUALIFIED, and weakly.** iProov sells anti-deepfake products, the release names no sampling
   frame, item count or method, there is no peer-reviewed write-up, and participants were "primed to
   look for deepfakes". It is a rate of *perfect scores*, not mean accuracy. Treat it as an order of
   magnitude, not a figure. The flag does not rest on it in any case. It is set against our
   own previous wave: more than **1%** of a wave's sittings above the previous wave's 99th percentile
   of anchor accuracy. DECLARED.
3. **Item-level drift on the canary subset.** The 8 canary items go to a one-in-eight random
   subsample and so accumulate an eighth of the core's exposure. A core-minus-canary gap that opens
   over waves is therefore contamination telemetry rather than population change. This applies
   ARC-AGI's public-vs-secure gap method, which the spec already adopts, inside the anchor. ARC Prize
   states it directly: "We also monitor for overfitting by tracking the performance gap between
   Public and Semi-Private tasks over time. Because Public tasks are openly available and therefore
   more susceptible to overfitting, the gap between Public and Semi-Private performance is
   informative" (*ARC Prize Verified Testing Policy*, https://arcprize.org/policy). **VERIFIED.**
   Read the direction carefully. Ours is the mirror image of theirs. ARC's exposed set is
   the *public* one, so ARC reads a **narrowing** gap as the held-out set leaking. Our exposed set
   is the *core*, which carries eight times the canary's exposure, so we read a **widening**
   core-minus-canary gap as the core leaking. Same logic, opposite sign, and the sign is easy to
   copy wrongly. ARC also fixes numeric agreement bands (±10 pp for ARC-AGI-1, ±3 pp for ARC-AGI-2,
   ±15 pp for ARC-AGI-3, same page). We have no equivalent band, which is the same gap as the
   unknown detection floor below. The canary items carry an eighth of the sample, so they
   detect only a gross leak. **We do not know the smallest gap this design can detect.** A
   simulation on wave-1 response data would tell us.
4. **Person fit.** High accuracy on the hardest anchor items with chance-level accuracy on the
   easiest is a response pattern that ability does not produce. Report the count of aberrant
   patterns per wave. It is a screen for a leaked key list rather than for practice.

**One thing we cannot do:** monitor the open web for our own assets without publishing perceptual
hashes of them, which is itself a disclosure. **UNKNOWN** whether a hash-matching service can be run
against a vendor's scraped corpus under an NDA at acceptable cost. One quote would tell us.

### 2.5 The day it leaks

Pre-decided, so that nobody argues about it while holding the result:

1. **Disclose the leak in the release, not in an annex**, whatever step 2 concludes.
2. **Rebuild the line on the surviving items.** Drop every item that is known-leaked or that flagged
   on two of the four signals. Recompute the whole back series on that reduced set, so the
   comparison stays like-for-like. If **fewer than 20 items survive**, or the media/message balance
   collapses, there is no trend statement for that wave. Publish the level only. The 20 is
   **ours, DECLARED**, set against Angoff's common-item rule of thumb rather than derived (§4.2).
3. **Start the successor** and run it beside the incumbent for the following wave. Accept that the
   bridge is contaminated on one side, and report the linking error as unbounded.
4. **Do not quietly patch the form.** An anchor that gained four replacement items in 2029 is a
   different instrument. The series is broken whether or not anyone announces it.

**The residual risk we are choosing to keep:** we are *not* authoring a standby anchor in parallel.
A standby doubles item authoring for insurance against an event that has not happened. Declining it
costs us this: a sudden leak leaves no clean overlap wave and breaks the series. If a reviewer
wants the insurance, the price is one more 40-item form in three languages, and the argument is
about that number.

---

## 3. Refresh: how long the anchor is held

- **Minimum hold: three panel waves. Target: six.** Long enough that the linking error is not the
  whole story of a three-year trend. Short enough that we are not defending 2026 generators in 2035.
- **Planned replacement runs an overlap wave.** The successor anchor is fielded in the same wave as
  the incumbent, on the same respondents, before the incumbent retires. That wave produces the link
  between the two frozen lines. Nothing else makes the series survive the change.
  NAEP calls this a bridge study, and runs it on randomly equivalent groups rather than on the
  same people: in 2004 "students were randomly assigned to take either the original assessment or
  the revised assessment" (NCES, *2004 Bridge Study*,
  https://nces.ed.gov/nationsreportcard/ltt/bridge_study.aspx). **VERIFIED.** Ours is a
  single-group design (§4.1, link 2). It is the stronger of the two, and only available because
  our anchor is short.
- **The link is reported, never assumed.** The overlap wave publishes the transformation and its
  linking error. If the two anchors do not correlate at a pre-registered floor, the series is
  reported as two series with a break, not as one line.

**Forced early replacement, any one of these:**

| Trigger | Why it ends the form |
|---|---|
| A confirmed leak (§2.5) | The number stays comparable-looking after it stops being comparable. |
| More than 20% of core items drift | An item drifts when its accuracy moves by more than **10 percentage points** against its baseline wave, in either direction. DECLARED, and re-set against wave 1 (§9). Above a fifth of the core, the form is no longer the form. |
| Mean accuracy above 90%, or at chance for over half of respondents | A ceiling or a floor carries no trend information. `docs/TRACK-REVIEW.md` §2.1 says the floor is the likelier end. |
| An asset must be withdrawn for legal or consent reasons | Not negotiable, and `AILX-Spec-2026.1.md` §15 makes it foreseeable. |
| A media format stops rendering in shipped browsers | A codec deprecation is a silent form change. This is the trigger people forget. |
| The renderer changes | See §5.3. A UI change is a form change. |

**NAEP Long-Term Trend is the reference.** NCES runs LTT beside main NAEP and describes the
frozen-instrument idea in its own words: "Because the long-term trend program uses substantially the
same assessments decade after decade, it has been possible to chart educational progress since 1971
in reading and 1973 in mathematics" (NCES, *More About the NAEP Long-Term Trend Assessment*,
https://nces.ed.gov/nationsreportcard/ltt/moreabout.aspx), and "the LTT instruments do not evolve
based on changes in curricula or in educational practices and the students assessed are sampled by
age, not grade" (NCES, *Interpreting NAEP Long-Term Trend Results*,
https://nces.ed.gov/nationsreportcard/ltt/interpreting_results.aspx). Ages 9, 13 and 17.
**VERIFIED.**

Two things we had wrong about it, both read the same way. A frozen instrument buys less than the
standard account implies.

- **The cycle is irregular, not merely slower.** NCES's rule is "since 2004, typically long-term
  trend NAEP has measured student performance in mathematics and reading every four years"
  (https://nces.ed.gov/nationsreportcard/about/ltt_main_diff.aspx). The record is not that: 2020,
  2022 at age 9 only, 2023 at age 13 only, 2025 at ages 9 and 13, nothing in 2024, and the next LTT
  on NCES's published calendar is **2033** (https://nces.ed.gov/nationsreportcard/about/calendar.aspx).
  Age 17 was last assessed in 2012. Freezing a form does not keep a cadence. Funding does.
- **LTT is not frozen, it is bridged.** The 2004 revision replaced outdated material, dropped the
  blocks for discontinued subjects, and changed administration. The results are still published
  in two eras: "Results for 1971–99 are from the original assessment format, and results for 2004–25
  are from the revised assessment format" (2025 report card,
  https://www.nationsreportcard.gov/ltt/2025/). The most-cited frozen instrument in the world was
  replaced once and says so on the chart. §3's overlap wave is the same admission made in advance.

The differences that matter for us:

1. **NAEP's construct does not rot; ours does.** Reading in 1971 is reading in 2026. Detecting
   2026-vintage synthetic media in 2036 is a period piece. Our hold is measured in a handful of
   years, not fifty.
2. **NAEP LTT rides a probability sample of schools; we buy a panel.** NCES: "the selection process
   utilizes a probability sample design in which every school and student has a chance to be
   selected" (NAEP Technical Documentation, *Sample Design*,
   https://nces.ed.gov/nationsreportcard/tdw/sample_design/). **VERIFIED.** Our anchor rides in a
   form respondents may abandon (`docs/SAMPLING.md` §8.3). **An earlier draft of this document said
   NAEP has "compulsory attendance" behind it. That is wrong and is now deleted.** Student
   participation in NAEP is voluntary: "Does my child have to take NAEP? No. Unlike your state's
   assessment, which is mandatory for students, NAEP is voluntary"
   (https://nces.ed.gov/nationsreportcard/parents/). The Title I mandate covers state NAEP in
   reading and mathematics at grades 4 and 8, not LTT, which is a national-only sample. What NAEP
   gets is a compulsory-schooling sampling frame and a high response rate on top of it: 91% at age 9
   and 89% at age 13 in 2025 (https://www.nationsreportcard.gov/ltt/2025/about/?age=9). That is the
   real gap between NAEP and a bought panel, and it is a response-rate gap, not a legal one.
3. **NAEP LTT is paper; ours is rendered media.** "Since its inception, the long-term trend
   assessment has been administered in a paper-and-pencil format" (2025 report card, About tab,
   https://www.nationsreportcard.gov/ltt/2025/about/?age=9). **VERIFIED — of LTT only.** Do not say
   this about NAEP. Main NAEP is digital, and "In 2017, the NAEP program officially transitioned
   from paper-based assessments (PBAs) to digitally based assessments (DBAs) in mathematics and
   reading" (NAEP Technical Documentation, *NAEP Instruments*,
   https://nces.ed.gov/nationsreportcard/tdw/instruments/), on tablets and laptops with multimedia
   items. NCES treats the mode change as a threat to the trend and bridges it. So does §5.3.

**A fourth difference we claimed is not a difference.** An earlier draft said NAEP publishes its
trend as the main event while ours is a subscale. NCES does not frame LTT that way. LTT sits under
"Special Reports" in NCES's own navigation, reports for the nation only, and carries no achievement
levels ("There are no NAEP achievement levels to correspond with those used in main NAEP",
https://nces.ed.gov/nationsreportcard/about/ltt_main_diff.aspx). It next runs in 2033, against main
NAEP's two-year cadence with state and district results. NCES calls the two programmes "two major
objectives" and ranks neither. NAEP agrees with us: the slow frozen line is a named special series,
not the headline. That supports §1.2 and changes nothing in the design.

**One place NAEP is not a precedent for us: secrecy.** §2.2 and §2.3 keep the anchor unreleased.
NCES does close to the opposite with LTT. It publishes the instrument's shape. For 2025, "There
were 78 questions at age 9 and 94 questions at age 13" (2025 report card, About tab). It invites
readers to "Explore long-term trend questions in the NAEP Questions Tool"
(https://nces.ed.gov/nationsreportcard/ltt/what_measure_reading.aspx). We looked for an NCES
statement that LTT items are held secure and **found none**. **The non-release rule in §2 is ours,
not NAEP's**, and so is the argument for it. A paper booklet handed out and collected in a
proctored school session is a different exposure surface from keyed media served to a panellist's
own browser. Nobody has to agree with that argument, but it cannot be won by pointing at NCES.

---

## 4. Equating

### 4.1 Three links, and only two of them are equating

The word "equating" hides three different jobs here. They have different designs.

1. **Wave to wave on the frozen line: no equating.** The items, the order, the exposure time and the
   renderer are identical, so the 2029 rate and the 2027 rate are already on one scale. The samples
   are non-equivalent, but that is the population change we are trying to measure, not a scaling
   problem. This link needs no method. It needs assumption 2 in §4.3 to hold, and §4.4 says
   why it may not.
2. **Anchor to successor anchor, at replacement: a single-group link.** In the overlap wave the same
   respondents take both frozen forms, in randomised order. Single group, so there is no group
   difference to adjust for. The linking error enters the series exactly once per anchor generation
   (§5.2).
3. **Operational form to the frozen line, within a wave: common-item non-equivalent groups (NEAT).**
   The panel short form is matrix-sampled, so different respondents see different operational blocks
   and the anchor core is what they have in common. This link is only needed to express an
   operational result on the frozen scale, which §5.1 says we do not publish.

The anchor is an **external** anchor in all three: its items are scored for the trend line and
contribute nothing to the operational composite. Internal anchoring would put frozen items inside
the reported score, drag old content into the headline, and defeat the re-versioning the operational
form exists to do.

### 4.2 The method, and why

For links 2 and 3: **chained equipercentile equating as the primary method, with Levine
observed-score linear equating as the published sensitivity check.** Reasons, in order:

- It does not require an IRT fit. T2's response data has a documented distributional problem. A
  large fraction of a general population lands at or near chance (`docs/TRACK-REVIEW.md` §2.1). A
  lump at the bottom is what breaks an IRT scaling.
- Chained methods carry **less equating bias than poststratification (frequency estimation, Tucker)
  when the groups differ appreciably in ability**, which two matrix blocks or two panel years may.
  Brennan and Kolen's own simulation: "we recommend the frequency estimation method when group
  differences are small, and the chained equipercentile method when group differences are large"
  (Wang, Lee, Brennan & Kolen, 2006, CASMA Research Report No. 17, p. 8,
  https://education.uiowa.edu/sites/education.uiowa.edu/files/2026-04/casma-research-report-17-archived.pdf).
  ETS reaches the same conclusion (Sinharay & Holland, 2009, ETS RR-09-16, pp. 2–3,
  https://files.eric.ed.gov/fulltext/ED507841.pdf). **QUALIFIED: an earlier draft called chained
  "the standard choice", which is too strong.** Chained buys the lower bias with a **larger standard
  error of equating**. The same report conjectures this is because "the frequency estimation
  methods utilize two bivariate distributions while the chained methods only uses two pairs of
  marginal distribution". Neither method's assumptions can be checked against the data: "there are
  no data to allow us to contradict or help us choose between either set of assumptions" (Dorans,
  Moses & Eignor, 2010, ETS RR-10-29, p. 22, https://files.eric.ed.gov/fulltext/ED523737.pdf).
- Levine observed-score linear equating is Levine (1955, ETS RB-55-23). Its assumptions are stated
  on true scores: true-score correlations of 1 with the anchor, equal true-score regression
  coefficients, and equal measurement-error variance across populations (Albano, 2016, *Journal of
  Statistical Software* 74(8) §4.3). It is "the true score analogue of the Tucker equating
  method" (Dorans, Moses & Eignor, 2010, pp. 24–25). So its assumptions fail differently from
  chained ones, and running both is recommended practice: "to uncover problems that might not reveal
  themselves otherwise, it is important for operational testing programs to apply multiple equating
  methods and study the differences among their results" (Sinharay & Holland, 2009, p. i).
  **VERIFIED.** A gap between the two says an assumption set is strained. It does not say which
  method is right, and we must not report it as if it did.
- **The common-item floor, and who said it.** An earlier draft attributed "at least 20
  items or 20% of the form, whichever is larger" to Kolen & Brennan. **That attribution is wrong.**
  The "20 items or 20% ... whichever is larger" phrasing is **Angoff's** (1971/1984), quoted that
  way by later writers who cite Angoff and Kolen & Brennan together (Michaelides, 2010, *Frontiers
  in Psychology* 1:167, p. 4). Kolen & Brennan's own rule of thumb, as quoted with a page number by
  others, is different and has no "whichever is larger": "a common-item set should be at least 20%
  of the length of a total test containing 40 or more items" (*Test Equating, Scaling, and Linking*,
  2nd ed. 2004, p. 271; the 3rd ed. 2014 states it in ch. 8, "Characteristics of Common-Item Sets",
  pp. 287–289, adding "unless the test is very long, in which case 30 common items might suffice").
  Note the relaxation runs the **opposite way** from "whichever is larger": for a long test they
  allow proportionally fewer. **We did not read the book.** It is a Springer monograph, not open
  access, and it is not on the Internet Archive in either edition. Both quotations above are
  second-hand, from Cao (2011, Univ. of Maryland dissertation, p. 38) and Sansivieri (2017, Univ.
  of Bologna thesis, p. 10). **QUALIFIED, and cite it that way until somebody holds the book.**
  What Kolen & Brennan are directly credited with in peer-reviewed work is the content rule:
  "anchoring items should be proportionally representative of the total test in content and
  statistical characteristics" (Wang et al., 2019, *Phys. Rev. Phys. Educ. Res.* 15, 010122, citing
  the 3rd edition).
- **The "miniature" rule has been challenged.** Sinharay & Holland (2007, *Journal of
  Educational Measurement*) find that "requiring an anchor test to mimic the statistical
  characteristics of the total test may be too restrictive and need not be optimal". We read the
  ERIC abstract (record EJ772961). The article is paywalled at Wiley and we did not read it.
  **QUALIFIED, from the abstract only.**
- The anchor core is 32 items and is itself the common set, so any of these floors is met with
  margin. The 20-item figure §2.5 falls back to after a leak is therefore **ours, DECLARED, taking
  Angoff's rule of thumb as the reference point**. It is not a Kolen & Brennan number.

**Equate on item-level correct/incorrect responses, not on the reported T2 points.** The reported
score passes through d′ with a declared floor of `D_PRIME_FLOOR = −1.0`, a criterion term and a
scaling (`docs/TRACK-REVIEW.md` §9.3). Every one of those is a policy constant that may be re-decided.
Equating on top of them would tie the trend line to a scoring decision instead of to the
responses. The raw responses are the durable object.

**No equating engine is being built in this change**, and none is needed before wave 1. There is
nothing to link until a second wave or a successor anchor exists. Wave 1 must *store what
the link will need*: item-level responses, item ids, per-item timing, device class, and the anchor
form id.

### 4.3 The assumptions

An earlier draft ran these together as one list of five. They are two lists, and the difference
matters. The first is the literature's, and it is what makes a linking an *equating* at all. The
second is what our design and our chosen method add on top.

**(a) The five requirements for a linking to be an equating.** Quoted from Dorans, Moses & Eignor
(2010), ETS RR-10-29, pp. 4–5, restating Holland & Dorans (2006):

> "1. The Equal Construct Requirement: The two tests should both be measures of the same construct
> (latent trait, skill, ability). 2. The Equal Reliability Requirement: The two tests should have
> the same level of reliability. 3. The Symmetry Requirement: The equating transformation for
> mapping the scores of Y to those of X should be the inverse of the equating transformation for
> mapping the scores of X to those of Y. 4. The Equity Requirement: It should be a matter of
> indifference to an examinee as to which of two tests the examinee actually takes. 5. The
> Population Invariance Requirement: The equating function used to link the scores of X and Y should
> be the same regardless of the choice of (sub) population from which it is derived."

**VERIFIED.** The same page records that Dorans and Holland (2000) say the five "can be criticized
as being vague, irrelevant, impractical, trivial, or hopelessly stringent". It also records that
Livingston (2004) holds requirements 4 and 5 to be unattainable in practice. They are a bar to be
argued against, not a checklist to be ticked.

**Our earlier list carried only requirement 1.** Requirements 2 to 5 were missing. Two of them have
teeth here, and §10 flags what they would change:

- **Equal reliability** binds the *successor* anchor (§3). A successor with a different reliability
  from the incumbent does not equate to it, however well the overlap wave is run.
- **Population invariance** is the cross-country claim. §4.4 already commits to DIF screening before
  any cross-country trend statement. This is the requirement that screening serves.

**(b) What our design and method add.** These are not equating requirements and should not be
presented as if they were:

1. Item parameters are invariant across the two groups: an item is as hard in 2027 as in 2026. This
   is an IRT model assumption, and §4.4 says it is the one that fails here.
2. The missing-data assumption of the method chosen. "The groups differ only in ability" is
   too loose to be an assumption. Chained commits us to the two chained links being population
   invariant, poststratification to the conditional distributions being invariant, Levine to
   congeneric true scores with equal error variances (Dorans, Moses & Eignor, 2010, pp. 22–25).
   Picking a method picks one of these, and the pick is not testable against the data.
3. The anchor is content-representative of the form it links. Design guidance rather than a
   requirement, and its statistical half is contested (§4.2).
4. Administration is identical: same exposure time, same order, same rendering, same instructions.
   Ours, and stronger than the literature's, because our renderer is part of the instrument (§5.3).

### 4.4 What breaks them here

- **Assumption 2 is the one that fails, and it fails in the direction of the whole problem.** A
  frozen item can get easier without anybody touching it, because the *population's* exposure to
  2026-vintage generators keeps growing. That is item-parameter drift caused by the world. The
  anchor cannot separate it from ability. §5 states the consequence rather than hiding it here.
- **Exposure and practice.** Rules in §2.1 bound it. They do not remove it. The evidence base's own
  practice-effect finding is qualitative: reliability "was substantially impacted by intrinsic
  measurement noise … and to a smaller extent by practice effects", with much within-subject
  variance unexplained (Karvelis et al. 2024, PLoS ONE 19(11):e0312255, via
  `EVIDENCE-RELIABILITY-AND-TIME-PRESSURE.md` §A1). **VERIFIED, and it gives no retest gain size.**
  We do not know ours. A within-panel retest arm at 24 months would tell us.
- **Device mix.** Assumption 5 fails silently if the handset mix moves between waves. Mitigations
  committed in `docs/SAMPLING.md` §6: no anchor score depends on latency, device is never a
  weighting margin, an untimed device-insensitive block is carried, and measurement invariance is
  tested across device groups before means are compared.
- **Self-selection.** Track A cannot be equated at all. Its composition changes with whatever drove
  traffic that year. That is why the anchor is panel-only.
- **Language.** Media items are largely language-free. Message items are not. Invariance across
  en/ja/ko is an open item in the spec, and DIF screening on the anchor runs before any cross-country
  trend statement.

---

## 5. What the index may and may not attribute a change to

The deliverable. A fall in the AILX number can mean at least seven different things. The design
separates some of them and not others.

| Candidate explanation | Separable? | By what |
|---|---|---|
| **The generators got better** | **Yes, for the anchor construct.** | Generator vintage is frozen in the anchor. The operational-minus-anchor gap is the frontier effect, confounded with the operational form's content change, so it is an indication and not an estimate. |
| **The judge or assistant model changed** | **Yes, by construction.** | The anchor has no model in it. Severity shifts of up to 133/1,000 points (§1.1) cannot reach the frozen line. |
| **The candidates changed** | **Partly.** | Only within the frozen construct, and only after the other six explanations are excluded. It is the residual, never the first reading. |
| **The form was burned** | **No, not from the score.** | A leak looks exactly like improvement. The four side signals in §2.4 are the only defence, and none is conclusive alone. |
| **The cohort changed** | **Partly, for Track B; no, for Track A.** | Weighting, the reporting floors and the published NRBA (`docs/SAMPLING.md` §9, §10) handle composition. They do not handle a change in who agrees to sit a 45-minute test. Not at all for the self-selected web cohort. |
| **The devices changed** | **Partly.** | Invariance testing across device classes decides whether means may be compared. If only metric invariance holds, we may compare relationships and not means, and we say so instead of averaging anyway. |
| **The population's exposure to synthetic media grew** | **No.** | Indistinguishable from skill on a frozen form. This is the largest unfixed confound in the design. |

### 5.1 The sentences this licenses, and the ones it does not

**May say:** "Detection of 2026-vintage synthetic media and hostile messages among internet-using
adults 18–65 in [country] changed by X points between 2027 and 2029 (95% CI a–b), measured on a
32-item core held byte-identical, and identically administered, across both waves."

**May say:** "On the current form, which re-versions annually against the frontier, the 2029 level is
Y. It is not comparable to 2027."

**May not say:** "AI literacy fell." The anchor is a fifth of the composite.

**May not say:** "People got worse at spotting fakes" without naming the vintage. They got worse, or
better, at spotting *these* fakes.

**May not say:** anything about the frontier's effect as a number. The operational-minus-anchor gap
mixes the frontier with the new form's content, and we cannot pull them apart.

### 5.2 The linking error, and when it applies

While one anchor is live there is no linking error, because there is no link: the items are the same
bytes. The term enters the series **once per anchor generation**, at the overlap wave (§4.1, link 2).
From then on it sits inside every comparison that spans the replacement. It does not shrink with
sample size. PIAAC Cycle 2's cross-cycle linking error is **3.27 for literacy and 2.95 for numeracy**:
"The actual value of the linking error is 3.27 for literacy and 2.95 for numeracy" (OECD, 2024,
*Do Adults Have the Skills They Need to Thrive in a Changing World? Survey of Adult Skills 2023*,
Annex A, https://doi.org/10.1787/368bf665-en; repeated in *Education at a Glance 2025*).
**VERIFIED**, with two qualifications. First, the PIAAC scale has mean 250 and SD 50, so 3.27 is
roughly ±0.07 SD, larger than our entire sampling error at n = 1,500. "a 500-point scale" is
shorthand for the 0–500 reporting range, not a maximum. Second, the 2023 *Technical Report* prints
**3.42** for literacy in Table 10.8 (p. 294) while giving the same 2.95 for numeracy. So cite the
results report rather than the technical report for 3.27, and expect a reviewer to notice the pair.
OECD adds the term in quadrature to the SE of a cross-cycle difference. It explicitly does **not**
apply it to changes in subgroup gaps, "as the associated uncertainty cancels out". We should copy
that rule when we report a subgroup trend on the anchor (`docs/SAMPLING.md` §4.2). Ours is unknown
until an anchor is replaced. Guessing it before then would be inventing a number.
`docs/SAMPLING.md` §4.2 requires the term in any trend interval. On a live anchor that requirement
is satisfied by a term of zero, and the release must say which of the two cases it is in.

### 5.3 The renderer is part of the instrument

Freezing the items is not freezing the form. Exposure time is a measurement decision AILX
already declares: human accuracy on synthetic-image detection moves from **72% at 1 second to 82%
at 20 seconds** (`AILX-Spec-2026.1.md` §04). The source is Kamali et al., *Characterizing
Photorealism and Artifacts in Diffusion Model-Generated Images*, CHI '25, 749,828 observations from
50,444 participants: "With just 1 second of display time, participants are 72% accurate ... While
accuracy on real images appears to plateau by 5 seconds of display time, accuracy on AI-generated
images increases up to 80% ... at 10 seconds and 82% ... at 20 seconds"
(https://www.projects.science.uu.nl/ics-vig/uploads/Bibtex/Kamali2025Characterizing.pdf).
**VERIFIED, and narrower than the spec's sentence implies:** the climb to 82% is on **AI-generated
images only**, and accuracy on real images plateaus near 77%. Exposure time therefore moves the
false-negative rate, not the whole accuracy figure. The sample is self-selected online, not a
probability sample. A 15% faster image decode, a new swipe
animation, a changed confidence control or a different default zoom is a change of the same kind.
So the anchor's renderer is pinned by digest with its items, and a renderer change forces the
same bridge wave a content change would.

---

## 6. Cost

Per cycle, per country, unless stated.

| Line | Quantity | Note |
|---|---|---|
| Items authored, once | **56 units**: 32 media authored once, plus 8 message items × 3 languages = 24 | Media items carry no text of their own, so they are authored once and reused across locales; only the message items are written three times. Weighting the form toward media is partly a translation-cost decision. |
| Items drafted to ship those | **~170** | Three drafted per one shipped. OpenAI: "our annotation process resulted in 68.3% of SWE-bench samples being filtered out due to underspecification, unfair unit tests, or other issues" (https://openai.com/index/introducing-swe-bench-verified/). **VERIFIED as their figure, QUALIFIED on its denominator:** 68.3% is of the **1,699** samples 93 annotators screened, not of SWE-bench's 2,294-item test set, and the 500-item Verified set was drawn from the ~539 survivors. The survival rate that matters to us, 1 in 3.2, is unchanged. **ESTIMATE** as ours. |
| Human rater burden | **0** | No judged items. This is the strongest cost argument for a T2-only anchor. |
| LLM judge calls | **0** | A judged anchor would instead need ~200 labelled calibration examples per language and a paired 20-item severity monitor per wave (`EVIDENCE-JUDGE-AGREEMENT.md` §1, §2). |
| Testing minutes | **~14 min** for the 32-item core; **~17 min** for the one-in-eight who also get the canary items | 25 s per item, from T2's 120 items in 50 minutes. 23–31% of a 45–60 minute panel form, traded against response rate (`docs/SAMPLING.md` §8.3). **ESTIMATE.** |
| Marginal scoring cost per wave | **~0** | Arithmetic on response data (`docs/TRACK-REVIEW.md` §2.3). |
| Leak-detection analysis per wave | **3–5 analyst days** | Four signals, per item, within device class. **ESTIMATE**, no basis but the work involved. |
| Overlap (bridge) wave, at replacement | **one extra ~14-minute block**, once per anchor generation | The cost of keeping the series across a planned replacement. It doubles the anchor's minutes in that wave. |

The 14 minutes is the line to argue about. The rest is small. `docs/SAMPLING.md` §8.3 says length
costs low scorers rather than refusals, which biases the mean. That is the price of the frozen line.
Pay it deliberately.

---

## 7. What the code does about this

The manifest may declare a frozen form:

```yaml
anchor:
  id: ltt-2026a
  exposure_budget: 12000
```

`packages/content-tools` validates it (`parseManifest`). The id is a stable lowercase slug that
outlives the instrument version. The budget is a positive whole number of administrations. And **a
redacted package must not declare an anchor at all**. A redacted package publishes its keys on
purpose, so an anchor inside one is a burned form that still looks comparable. Unknown keys are
rejected, so a misspelled `exposure_budget` fails the load instead of disabling the budget quietly.
Tests cover all of it (`packages/content-tools/test/loader.test.ts`).

What the code does not do: count administrations, enforce the budget, bind the anchor id to a
particular set of items, or link anything. `content-tools` reads content and never sees a sitting,
and the anchor's items are not in this repository at all. So the count and the item-set binding
belong to the exam service in the private repo, and the linking belongs to a wave that does not
exist yet. The manifest field is the smallest thing that makes an anchor declarable and its budget
findable.

---

## 8. Decisions taken in this document

1. The anchor form is T2 only: a 32-item core plus 8 canary items served to one respondent in eight.
   External, panel-only.
2. No composite trend is ever published. The frozen line is a named subscale.
3. Exposure budget 12,000 administrations per cycle — one number, no cap above it — and no repeat
   inside 24 months.
4. Track A never sees the anchor.
5. Release only after the successor has been fielded twice. Retired anchor items never re-enter an
   operational form.
6. Leak detection runs four signals every wave, with thresholds declared in advance (§2.4).
7. Hold three waves minimum, six target. Replacement runs an overlap wave. Six forced-replacement
   triggers, one of which is a renderer change.
8. Wave to wave on a live anchor needs no equating. The successor link is a single-group overlap
   wave. The operational-to-anchor link is NEAT. Both use chained equipercentile on item-level
   responses, with Levine as the published sensitivity check. No equating code before wave 2.
9. No standby anchor is authored. The residual risk is stated in §2.5.
10. The manifest carries `anchor.id` and `anchor.exposure_budget`, and a redacted package may not
    declare either.

## 9. Open questions

- **The linking error at anchor replacement.** Unknown until an overlap wave exists.
- **The smallest leak the canary subset can detect.** Unknown. A simulation on wave-1 responses would
  tell us.
- **Our practice effect at 24 months.** Unknown. The literature gives no size
  (`EVIDENCE-RELIABILITY-AND-TIME-PRESSURE.md` §A11 finds no minimum-trials guidance at all). A
  retest arm would tell us.
- **Whether asset monitoring on the open web is buyable.** Unknown. One vendor quote settles it.
- **Whether a pinned self-hosted assistant makes the T3 reliance block anchorable**, and at what
  serving cost. That is the only route to a frozen line for 0.40 of the composite.
- **The 30% / 5 pp / 1% / 10 pp / 20% thresholds in §2.4 and §3 are DECLARED, not derived.** Wave 1 gives the
  first baseline against which they can be re-set, and they should be re-set in public.
- **The 20-item post-leak floor should be computed, not quoted.** Zhang & Kolen (2013, CASMA
  Research Report No. 37) set out a procedure for choosing the number of common items needed for a
  target equating precision rather than applying a fixed proportion. The string "20%" does not
  appear in that report. Wave-1 response data makes that computation possible. Until then
  the 20 is a placeholder (§4.2, §10).

---

## 10. What the citation check changed, and the one design decision it touches

This revision corrected the sources, not the design, with one exception that a reviewer must decide.

Corrected and now cited: NAEP LTT's dates, cadence and paper administration (§3). NAEP
participation is **voluntary**, not compulsory (§3). NAEP does not treat LTT as its headline,
so our "subscale, not the index" position agrees with NCES rather than differing from it (§3).
NCES does **not** keep LTT items secure, so §2's non-release rule is ours alone (§3).
"20 items or 20%, whichever is larger" is Angoff's rule of thumb and not Kolen & Brennan's (§4.2).
Chained equipercentile is the lower-bias choice under large group differences rather than "the
standard choice", and pays for it in standard error (§4.2). Then the PIAAC linking-error figures,
their scale and the 3.42/3.27 discrepancy between two OECD publications (§5.2); the Kamali et al.
source behind 72%→82%, and that the climb is on AI-generated images only (§5.3); the denominator
behind SWE-bench's 68.3% (§6); and the iProov press release behind the 0.1% figure, which is a
vendor claim and is marked as one (§2.4).

**The decision a reviewer must take: the equal-reliability requirement at anchor replacement.**
§4.3 now records that equating requires the two forms to have the same reliability. §3 and decision
7 do not require this of a successor anchor. They require an overlap wave and a pre-registered
correlation floor, which is a weaker test. If the requirement is accepted, decision 7 would become:
*a successor anchor must match the incumbent's reliability, estimated on the overlap wave, and a
mismatch is a break in the series rather than a link.* That is a real constraint on authoring
a successor, and it is not being adopted here by an agent editing citations. Left open on purpose.