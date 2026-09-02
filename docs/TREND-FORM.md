# TREND-FORM.md — the frozen anchor, and what a change in the index may be blamed on

Status: design document, first draft. Public on purpose, like `docs/SAMPLING.md`: the method is a
credibility asset, the item bank is the secret. Nothing in this file names an item, an asset, a key
or a generator prompt.

Companion documents: `docs/SAMPLING.md` §12.1 (the basket problem, which this file answers),
`docs/TRACK-REVIEW.md` §2 and §9 (what T2 measures and what shipped),
`AILX-Spec-2026.1.md` §09 (three-tier item pool, cross-year comparability) and §14 (re-versioning).

Marking follows `docs/SAMPLING.md`. **VERIFIED** means a primary source was read and is cited.
**ESTIMATE** means an engineering judgement with the reasoning shown. **DECLARED** means a threshold
we chose rather than derived, which is not the same as a finding. **UNKNOWN** means we do not know
and have not pretended to.

---

## 0. The one-paragraph version

AILX re-versions its operational form every year against a frontier that moves faster than the form
does. On a re-versioned instrument a fall in the score cannot be told apart from generators getting
better, which is the CPI's new-product bias with the sign that flatters nobody. So AILX carries a
second instrument that never changes: a **frozen anchor form** of T2 discrimination items on pinned
generator vintages, fielded in the panel wave beside the operational form, scored by arithmetic with
no model in the loop. The headline **trend** is reported on the frozen line only. The operational
form is reported as a **level**, never as a change. The frozen line answers one narrow question —
*can adults still tell 2026-vintage synthetic media apart from camera-captured media?* — and it is
not a trend in AI literacy. Saying which of the two we measured is the whole point of the design.

---

## 1. What is in the anchor form, and what is not

### 1.1 The contents

**The anchor form is T2 only: 40 discrimination items, of which 32 are media and 8 are message.**
Fixed presentation order, fixed exposure time per item, fixed instructions, fixed renderer. It is an
**external anchor**: its items are scored for the trend line and contribute nothing to the
candidate's operational composite.

Why T2 and nothing else, in order of weight:

1. **It is keyed.** Every anchor item has a right answer stored beside it. Scoring is arithmetic on
   response data with zero marginal cost at any n (`docs/TRACK-REVIEW.md` §2.3). A trend line whose
   scoring cost is zero can be recomputed in 2031 by anyone holding the responses.
2. **No model is in the loop, so no model version can move the series.** This is not a small point.
   Sunkavalli (2026, arXiv:2608.29517; 2,377 essays, 12 judges, 4 providers) measured all five
   model-version contrasts moving judge severity beyond a permutation null, **up to 133 points of
   1,000**, with one judge deprecated mid-study. **VERIFIED** (private evidence base,
   `EVIDENCE-JUDGE-AGREEMENT.md` §2). A judged anchor would carry a year-over-year severity shift
   larger than any population change we could plausibly detect, and it would be inseparable from it.
3. **It compresses.** T2 is the only track that fits a matrix block cleanly: short discrete items,
   fixed exposure, no rater, no artefact, no window (`docs/TRACK-REVIEW.md` §2.6).
4. **Its content can actually be frozen.** An image is bytes we hold. A T3 sitting depends on a
   live assistant model we do not own and cannot pin for five years; providers retire endpoints.
   You cannot freeze a dependency somebody else deprecates.

### 1.2 What is excluded, and what that costs

| Track | Excluded because | The cost of excluding it |
|---|---|---|
| **T1 Creative Build** (160 pts, .40 weight) | Scored partly by a blinded human comparative-judgement panel. A rater panel cannot be frozen, and rater turnout is already the thing that breaks T1 at scale (`docs/TRACK-REVIEW.md` §3.3). | The flagship track, and the one with an external criterion, has no trend line at all. |
| **T3 Calibrated Reliance** (160 pts, .40 weight) | Needs a live assistant model and, for the 45-point analysis component, an LLM judge. Both drift on somebody else's release schedule. | The strongest construct in the instrument is reported as a level only. |
| **T4 Generative Direction** (0 pts) | Unscored showcase since 2026-09-01 (`docs/TRACK-REVIEW.md` §9.1). | Nothing. |

**Say the consequence plainly: there is no trend line for the composite.** The anchor covers T2,
which is 0.20 of the composite z-score. Publishing a "national AI-literacy trend" off a frozen block
that carries a fifth of the construct would be the same overclaim this document exists to stop. What
may be published as a trend is the **anchor subscale** under its own name. What may be published as
a level is everything else, per wave, with the form version printed beside it.

**The half of T3 that could be anchored later, and is not being anchored tonight.** The model-free
reliance block (planted errors, no judge, 115 of T3's 160 points) survives compression and needs no
rater. It still needs a live assistant, so freezing it means freezing a model. If a pinned open-weights
assistant is ever run on our own infrastructure at fixed weights, decode settings and serving stack,
that block becomes anchorable and the composite gets a second frozen leg. **We do not know what that
costs**; what would tell us is one wave's serving bill for a pinned 8B-class assistant at panel volume.

### 1.3 Why the anchor is bigger than the spec's secure block

`AILX-Spec-2026.1.md` §09 already commits to an **anchor — secure block — 8–12 items embedded in
every annual form, never released, never rotated**. That block equates the *examination* year to
year. It is too small to carry a population trend, and the arithmetic says so: a rate measured on 8
binary opportunities at p = 0.5 has SE = 0.177, a 95% interval of about ±0.35, and about **97
opportunities are needed for a ±0.10 interval** (private evidence base,
`EVIDENCE-CALIBRATED-RELIANCE.md` §3 / `EVIDENCE-RELIABILITY-AND-TIME-PRESSURE.md` §A12; the doc
marks this as its own arithmetic, not a published result). **VERIFIED as arithmetic.**

That interval is the *per-person* one, and a population mean over n = 1,500 is far tighter than any
one person's rate. The two uses must not be confused:

- **For the population mean, 40 items is enough.** The binding uncertainty is the linking error and
  item-level drift, not item count (§4.4).
- **For an individual anchor score, 40 items is not enough** (±0.16 at p = 0.5). The anchor form
  therefore issues no individual score and appears on no report.

40 rather than 97 is a deliberate trade against testing minutes (§6). We are buying a cohort mean,
not a person score.

---

## 2. Security, which is the part that fails first

A frozen form that is published, practised against, or over-fielded is burned. **A burned anchor is
worse than no anchor**, because it keeps producing a comparable-looking number while the thing it
compares has changed. Everything below exists to make that state detectable rather than assumed
away.

### 2.1 Exposure budget

**12,000 administrations per cycle, hard cap 15,000. DECLARED.** The arithmetic: up to four
countries × 3,000 panel completes is 12,000 (`docs/SAMPLING.md` §4, §13.3 option C), and the cap
leaves headroom for replacements and a device substudy without a decision being made by accident.

Two rules go with it:

- **No panellist sees the anchor twice inside 24 months.** Repeated exposure does not only teach
  answers. Bucinca et al. (2021, N = 199) found people "rarely engage analytically with each
  individual AI recommendation" and instead "develop general heuristics about whether and when to
  follow the AI suggestion". **VERIFIED** (private evidence base,
  `EVIDENCE-RELIABILITY-AND-TIME-PRESSURE.md` §B4). A person who has met the form once can answer it
  with a policy instead of a perception.
- **Track A never sees the anchor.** Not in play mode, not in the demo, not in a share card, not in
  a full web sitting. Track A is self-selected, retakes freely, and its whole growth loop is
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
has been fielded in two waves.** The reasoning is that an auditor re-checking the old series needs
the items, and publishing them ends the old series permanently. Two successor waves is the point at
which the old line has been carried across and its retirement costs nothing further. Retired anchor
items never enter an operational form.

### 2.4 How a leak would be detected

No single signal is convincing. Four are run every wave, and the design pre-commits to the
thresholds so the analysis is not read backwards.

1. **Response-time profile, per item.** A memorised item is answered faster with the same or better
   accuracy. Flag: median time-to-response on an item falls by more than **30%** against its baseline
   wave while accuracy rises by more than **5 percentage points**. DECLARED thresholds. This signal is
   device-confounded and must be read within device class: measured total device latency spans
   **35 ms to 140 ms** across 26 handsets, and the authors warn it may be "misattributed as individual
   or group differences in response times" (Hassenstab et al. 2023, via `docs/SAMPLING.md` §6).
   **VERIFIED.** A 105 ms spread is small against a 25-second item and large against nothing else we
   log, so this is a screen, not a verdict.
2. **Near-perfect clustering.** In a 2,000-person synthetic-media detection study, **0.1% got
   everything right** (`AILX-Spec-2026.1.md` §09). **VERIFIED.** Flag: more than **1%** of a wave's
   sittings above the previous wave's 99th percentile of anchor accuracy. DECLARED.
3. **Item-level drift on a canary subset.** The anchor splits into a **core of 32 items served to
   everyone** and **8 canary items served to a 1-in-8 random subsample**. Canary items are far less
   exposed, so a core-minus-canary gap that opens over waves is contamination telemetry rather than
   population change. This is ARC-AGI's public-vs-secure gap method, which the spec already adopts,
   applied inside the anchor. The cost is that the canary items carry an eighth of the sample and so
   detect only a gross leak; **we do not know the smallest gap this design can detect**, and what
   would tell us is a simulation on wave-1 response data.
4. **Person fit.** High accuracy on the hardest anchor items with chance-level accuracy on the
   easiest is a response pattern that ability does not produce. Report the count of aberrant
   patterns per wave; it is a screen for a leaked key list rather than for practice.

**One thing we cannot do:** monitor the open web for our own assets without publishing perceptual
hashes of them, which is itself a disclosure. **UNKNOWN** whether a hash-matching service can be run
against a vendor's scraped corpus under an NDA at acceptable cost. What would tell us: one quote.

### 2.5 The day it leaks

Pre-decided, so that nobody argues about it while holding the result:

1. **Publish no trend for the affected wave.** Publish the level, with the leak disclosed in the same
   release, not in an annex.
2. **Re-equate on the surviving items.** Drop every item that is known-leaked or that flagged on two
   of the four signals. If **fewer than 20 items survive**, or the media/message balance collapses,
   there is no trend statement for that wave at all. The 20 is the standard common-item floor (§4.2).
3. **Start the successor** and run it beside the incumbent for the following wave, accepting that the
   bridge is contaminated on one side and reporting the linking error as unbounded.
4. **Do not quietly patch the form.** An anchor that gained four replacement items in 2029 is a
   different instrument, and the series is broken whether or not anyone announces it.

**The residual risk we are choosing to keep:** we are *not* authoring a standby anchor in parallel.
A standby doubles item authoring for insurance against an event that has not happened. The cost of
declining it is that a sudden leak leaves no clean overlap wave and breaks the series. If a reviewer
wants the insurance, the price is one more 40-item form in three languages, and the argument is
about that number.

---

## 3. Refresh: how long the anchor is held

- **Minimum hold: three panel waves. Target: six.** Long enough that the linking error is not the
  whole story of a three-year trend; short enough that we are not defending 2026 generators in 2035.
- **Planned replacement runs an overlap wave.** The successor anchor is fielded in the same wave as
  the incumbent, on the same respondents, before the incumbent retires. That wave produces the link
  between the two frozen lines, and it is the only thing that makes the series survive the change.
  NAEP calls this a bridge study.
- **The link is reported, never assumed.** The overlap wave publishes the transformation and its
  linking error. If the two anchors do not correlate at a pre-registered floor, the series is
  reported as two series with a break, not as one line.

**Forced early replacement, any one of these:**

| Trigger | Why it ends the form |
|---|---|
| A confirmed leak (§2.5) | The number stays comparable-looking after it stops being comparable. |
| Drift beyond threshold on more than 20% of items | The form is no longer measuring what it measured. |
| Mean accuracy above 90%, or at chance for over half of respondents | A ceiling or a floor carries no trend information. `docs/TRACK-REVIEW.md` §2.1 says the floor is the likelier end. |
| An asset must be withdrawn for legal or consent reasons | Not negotiable, and `AILX-Spec-2026.1.md` §15 makes it foreseeable. |
| A media format stops rendering in shipped browsers | A codec deprecation is a silent form change. This is the trigger people forget. |
| The renderer changes | See §5.3. A UI change is a form change. |

**NAEP is the reference, and we differ from it in four ways.** NAEP runs a Long-Term Trend
assessment beside main NAEP: substantially unchanged items, first fielded in the early 1970s,
administered to fixed ages rather than grades, on a less frequent cycle, with bridge studies when
anything must change. **UNVERIFIED at source level** — this paragraph is written from the published
design rather than from a re-read of the NCES documentation, and the dates and cycle must be checked
before publication. The differences that matter for us:

1. **NAEP's construct does not rot; ours does.** Reading in 1971 is reading in 2026. Detecting
   2026-vintage synthetic media in 2036 is a period piece. Our hold is measured in a handful of
   years, not fifty.
2. **NAEP has a probability sample of schools and compulsory attendance behind it.** We buy a panel,
   and our anchor rides in a form respondents may abandon (`docs/SAMPLING.md` §8.3).
3. **NAEP's items are paper-equivalent and device-neutral.** Ours are rendered media, and the
   renderer is part of the instrument.
4. **NAEP publishes its trend as the main event.** Ours is explicitly a subscale, not the index.

---

## 4. Equating

### 4.1 The design

**Common-item non-equivalent groups (NEAT), with the anchor form as an external anchor.** Each wave
draws a different sample; the anchor items are the only thing common to both. External, not
internal: internal anchoring would put frozen items inside the reported operational score, which
would drag old content into the headline and defeat the re-versioning the operational form exists to
do.

### 4.2 The method, and why

**Chained equipercentile equating as the primary method, with Levine observed-score linear equating
as the published sensitivity check.** Reasons, in order:

- It does not require an IRT fit. T2's response data has a documented distributional problem — a
  large fraction of a general population lands at or near chance (`docs/TRACK-REVIEW.md` §2.1) — and
  a lump at the bottom is exactly what breaks an IRT scaling.
- Chained methods are the standard choice when the groups differ substantially in ability, which
  two panel waves in different years may. Levine's assumptions fail differently from chained ones, so
  running both and publishing the gap is a real check rather than a decoration.
- Standard guidance is that a common-item set should be **at least 20 items or 20% of the form,
  whichever is larger**, and should mirror the full form in content and difficulty (Kolen & Brennan,
  *Test Equating, Scaling, and Linking*). **UNVERIFIED at source level** — written from the standard
  guidance, not re-read tonight; confirm the exact wording before publication. Our anchor is 40 items
  and is itself the common set, so the floor is met with margin, and the 20-item figure is what §2.5
  falls back to after a leak.

**Equate on item-level correct/incorrect responses, not on the reported T2 points.** The reported
score passes through d′ with a declared floor of `D_PRIME_FLOOR = −1.0`, a criterion term and a
scaling (`docs/TRACK-REVIEW.md` §9.3). Every one of those is a policy constant that may be re-decided,
and equating on top of them would tie the trend line to a scoring decision instead of to the
responses. The raw responses are the durable object.

**No equating engine is being built tonight**, and none is needed before wave 1: there is nothing to
equate until a second wave exists. What wave 1 must do is *store what equating will need* — item-level
responses, item ids, per-item timing, device class, and the anchor form id.

### 4.3 The assumptions

1. The anchor items measure the same construct in both waves.
2. Item parameters are invariant across the two groups: an item is as hard in 2027 as in 2026.
3. The groups differ only in ability, not in what ability means.
4. The anchor is a miniature of the form it links, in content and difficulty spread.
5. Administration is identical: same exposure time, same order, same rendering, same instructions.

### 4.4 What breaks them here

- **Assumption 2 is the one that fails, and it fails in the direction of the whole problem.** A
  frozen item can get easier without anybody touching it, because the *population's* exposure to
  2026-vintage generators keeps growing. That is item-parameter drift caused by the world, and the
  anchor cannot separate it from ability. §5 states the consequence rather than hiding it here.
- **Exposure and practice.** Rules in §2.1 bound it; they do not remove it. The evidence base's own
  practice-effect finding is qualitative — reliability "was substantially impacted by intrinsic
  measurement noise … and to a smaller extent by practice effects", with much within-subject
  variance unexplained (Karvelis et al. 2024, PLoS ONE 19(11):e0312255, via
  `EVIDENCE-RELIABILITY-AND-TIME-PRESSURE.md` §A1). **VERIFIED, and it gives no retest gain size.**
  We do not know ours. A within-panel retest arm at 24 months would tell us.
- **Device mix.** Assumption 5 fails silently if the handset mix moves between waves. Mitigations
  already committed in `docs/SAMPLING.md` §6: no anchor score depends on latency, device is never a
  weighting margin, an untimed device-insensitive block is carried, and measurement invariance is
  tested across device groups before means are compared.
- **Self-selection.** Track A cannot be equated at all; its composition changes with whatever drove
  traffic that year. This is why the anchor is panel-only.
- **Language.** Media items are largely language-free; message items are not. Invariance across
  en/ja/ko is an open item in the spec, and DIF screening on the anchor runs before any cross-country
  trend statement.

---

## 5. What the index may and may not attribute a change to

The deliverable. A fall in the AILX number can mean at least five different things, and the design
separates some of them and not others.

| Candidate explanation | Separable? | By what |
|---|---|---|
| **The generators got better** | **Yes, for the anchor construct.** | Generator vintage is frozen in the anchor. The operational-minus-anchor gap is the frontier effect, confounded with the operational form's content change, so it is an indication and not an estimate. |
| **The judge or assistant model changed** | **Yes, by construction.** | The anchor has no model in it. Severity shifts of up to 133/1,000 points (§1.1) cannot reach the frozen line. |
| **The candidates changed** | **Partly.** | Only within the frozen construct, and only after the other four explanations are excluded. It is the residual, never the first reading. |
| **The form was burned** | **No, not from the score.** | A leak looks exactly like improvement. The four side signals in §2.4 are the only defence, and none is conclusive alone. |
| **The cohort changed** | **Partly, for Track B; no, for Track A.** | Weighting, the reporting floors and the published NRBA (`docs/SAMPLING.md` §9, §10) handle composition. They do not handle a change in who agrees to sit a 45-minute test. Not at all for the self-selected web cohort. |
| **The devices changed** | **Partly.** | Invariance testing across device classes decides whether means may be compared. If only metric invariance holds, we may compare relationships and not means, and we say so instead of averaging anyway. |
| **The population's exposure to synthetic media grew** | **No.** | Indistinguishable from skill on a frozen form. This is the largest unfixed confound in the design. |

### 5.1 The sentences this licenses, and the ones it does not

**May say:** "Detection of 2026-vintage synthetic media among internet-using adults 18–65 in
[country] changed by X points between 2027 and 2029 (95% CI a–b, including a linking error of L),
measured on a frozen 40-item form held constant across both waves."

**May say:** "On the current form, which re-versions annually against the frontier, the 2029 level is
Y. It is not comparable to 2027."

**May not say:** "AI literacy fell." The anchor is a fifth of the composite.

**May not say:** "People got worse at spotting fakes" without naming the vintage. They got worse, or
better, at spotting *these* fakes.

**May not say:** anything about the frontier's effect as a number. The operational-minus-anchor gap
mixes the frontier with the new form's content, and we cannot pull them apart.

### 5.2 The linking error is not a footnote

Any trend statement adds a linking-error term to the standard error of the difference, and it does
not shrink with sample size. PIAAC Cycle 2's cross-cycle linking error is **3.27 for literacy and
2.95 for numeracy** on a 500-point scale, roughly ±0.07 SD — larger than our entire sampling error at
n = 1,500. **VERIFIED** (`docs/SAMPLING.md` §4.2). Ours is unknown until two waves exist, and there is
no honest way to guess it. What would tell us: wave 2.

### 5.3 The renderer is part of the instrument

Freezing the items is not freezing the form. Exposure time is a measurement decision that AILX
already declares — human accuracy on synthetic-image detection moves from **72% at 1 second to 82%
at 20 seconds** (`AILX-Spec-2026.1.md` §04). **VERIFIED.** A 15% faster image decode, a new swipe
animation, a changed confidence control or a different default zoom is a change of the same kind.
The anchor's renderer is therefore pinned by digest with its items, and a renderer change forces the
same bridge wave a content change would.

---

## 6. Cost

Per cycle, per country, unless stated.

| Line | Quantity | Note |
|---|---|---|
| Items authored, once | 40 per language × 3 = **120 shipped** | Media items are largely language-free, so the true authoring load is nearer 40 media + 8 message × 3. Weighting the form toward media is partly a translation-cost decision. |
| Items drafted to ship those | **~360** | Three drafted per one shipped; SWE-bench Verified filtered **68.3%** of candidates (`AILX-Spec-2026.1.md` §09). **VERIFIED** as their figure, **ESTIMATE** as ours. |
| Human rater burden | **0** | No judged items. This is the strongest cost argument for a T2-only anchor. |
| LLM judge calls | **0** | A judged anchor would instead need ~200 labelled calibration examples per language and a paired 20-item severity monitor per wave (`EVIDENCE-JUDGE-AGREEMENT.md` §1, §2). |
| Testing minutes | **~17 min** of a 45–60 minute panel form | 40 items at ~25 s, from T2's 120 items in 50 minutes. 28–38% of the panel form, traded against response rate (`docs/SAMPLING.md` §8.3). **ESTIMATE.** |
| Marginal scoring cost per wave | **~0** | Arithmetic on response data (`docs/TRACK-REVIEW.md` §2.3). |
| Leak-detection analysis per wave | **3–5 analyst days** | Four signals, per item, within device class. **ESTIMATE**, no basis but the work involved. |
| Overlap (bridge) wave, at replacement | **one extra ~17-minute block**, once per anchor generation | The cost of keeping the series across a planned replacement. |

The number to argue about is 17 minutes. Everything else is small. `docs/SAMPLING.md` §8.3 says
length costs low scorers rather than refusals, which biases the mean; that is the real price of the
frozen line and it should be paid deliberately.

---

## 7. What the code does about this

The manifest may declare a frozen form:

```yaml
anchor:
  id: ltt-2026a
  exposure_budget: 12000
```

`packages/content-tools` validates it (`parseManifest`): the id is a stable lowercase slug that
outlives the instrument version, the budget is a positive whole number of administrations, and **a
redacted package must not declare an anchor at all** — a redacted package publishes its keys on
purpose, so an anchor inside one is a burned form that still looks comparable. That last rule is the
only part of this document a test can check, and it is checked
(`packages/content-tools/test/loader.test.ts`).

What the code deliberately does not do: count administrations, enforce the budget, or equate
anything. `content-tools` reads content and never sees a sitting. The count belongs to the exam
service in the private repo, and the equating belongs to a wave that does not exist yet.

---

## 8. Decisions taken in this document

1. The anchor form is T2 only, 40 items (32 media, 8 message), external, panel-only.
2. No composite trend is ever published. The frozen line is a named subscale.
3. Exposure budget 12,000 administrations per cycle, hard cap 15,000, no repeat inside 24 months.
4. Track A never sees the anchor.
5. Release only after the successor has been fielded twice; retired anchor items never re-enter an
   operational form.
6. Leak detection runs four signals every wave, with thresholds declared in advance (§2.4).
7. Hold three waves minimum, six target; replacement runs an overlap wave; six forced-replacement
   triggers, one of which is a renderer change.
8. Chained equipercentile equating on item-level responses, with Levine as the published sensitivity
   check. No equating engine before wave 2.
9. No standby anchor is authored. The residual risk is stated in §2.5.
10. The manifest carries `anchor.id` and `anchor.exposure_budget`, and a redacted package may not
    declare either.

## 9. Open questions

- **The linking error.** Unknown until wave 2. Nothing can substitute for it.
- **The smallest leak the canary subset can detect.** Unknown. A simulation on wave-1 responses would
  tell us.
- **Our practice effect at 24 months.** Unknown; the literature gives no size
  (`EVIDENCE-RELIABILITY-AND-TIME-PRESSURE.md` §A11 finds no minimum-trials guidance at all). A
  retest arm would tell us.
- **Whether asset monitoring on the open web is buyable.** Unknown. One vendor quote settles it.
- **Whether a pinned self-hosted assistant makes the T3 reliance block anchorable**, and at what
  serving cost. That is the only route to a frozen line for 0.40 of the composite.
- **The 30% / 5 pp / 1% / 20% thresholds in §2.4 and §3 are DECLARED, not derived.** Wave 1 gives the
  first baseline against which they can be re-set, and they should be re-set in public.
