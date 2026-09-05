# TRACK-REVIEW.md — are T1–T4 the right things to measure?

Status: analysis and recommendation, 2026-09-01. No track code was changed to write it.
Scope: the user's question — *"Are T1 through T4 the exact kind of material we should be testing,
and the most engaging?"* — judged against two goals that pull in opposite directions: a game people
choose to play, and a statistic a ministry would cite.

Sources: `Foray-Spec-2026.1.md` (§03, §04, T1–T4, §09), `docs/FUTURE-TRACKS.md`,
`docs/SAMPLING.md`, `packages/tracks/*/src`, and the research evidence base at
`/tmp/ailx-research-01a04bca/` (sections 1, 2 and 4).

---

## 0. The verdicts, up front

| Track | Verdict | One-line reason |
|---|---|---|
| **T1 Creative Build** | **KEEP — promote to flagship** | The only track whose construct is unambiguous, whose score has a human criterion, and whose artefact is inherently shareable. It is also the one that cannot enter the population statistic without surgery. |
| **T2 Discrimination** | **CHANGE — demote from 100 pts to a diagnostic block, and rename the construct** | The scored quantity (d′) is the exact statistic the best evidence says does not move with training and is partly a stable perceptual aptitude. Keep the items; stop calling the score AI literacy. |
| **T3 AI-Assisted Reasoning** | **KEEP — this is the load-bearing track** | Its 35 model-free points (RSR/RAIR) measure a behaviour under AI, not a perception. It is the only track measuring the failure mode the field actually worries about. |
| **T4 Generative Direction** | **CUT as a scored track; keep as the gallery/play surface** | It duplicates T1's scoring machinery, duplicates T1's construct claim, costs the most per candidate, and its distinctive component (brief compliance) is a better T3 rubric dimension than a track. |

**If forced to keep exactly one track: T3.** Not T1, which travels further, and not T2, which is
the one people would play. T3 is the only track whose score survives the question "what does a high
score let you predict?" — it measures whether a person keeps judgement while using a model, it does
so with an objective, un-gameable, model-free component, and its content ages with the models
rather than being burned by publication.

---

## 1. The frame: two goals, and which track serves which

The two goals are not equally served by the same material, and it is worth stating the asymmetry
before judging any track.

- **The game** needs: fast feedback, an obvious win condition, low setup, a shareable output, and a
  reason to come back tomorrow.
- **The statistic** needs: invariance across languages and devices, a compressible short form
  (`docs/SAMPLING.md` §5: 45–60 minutes, matrix-sampled, one session), variance that is not a floor
  or a ceiling, a defensible link between short form and full sitting, and content that does not
  burn when it is published.

These conflict most sharply on **exposure**. The game's best asset is a shareable item ("can you
tell which is real?"). Publishing that item destroys its use as a scored item forever
(`docs/FUTURE-TRACKS.md`, "The one-way door"). Any track whose game value comes from *showing the
item* is a track whose scored bank is a consumable. That is T2, and it is the central economic fact
about T2.

They conflict again on **effort**. Wise & DeMars put the motivated-vs-unmotivated gap at ~0.58 SD —
larger than any cross-national difference Foray would want to report. A viral surface recruits
motivated people; a probability panel recruits paid ones. If effort is not measured and modelled,
the published number is a motivation artefact wearing a literacy label.

---

## 2. T2 · Authenticity Discrimination — the hardest look

### 2.1 What a T2 score is a measure of

This is the paragraph that matters, so it is written without hedging.

The spec declares T2 `[Direct]`: "Discrimination accuracy is the construct. Sensitivity is measured,
not inferred" (§03). The code is faithful to that declaration —
`packages/tracks/t2-discrimination/src/scoring.ts` computes d′ = z(H) − z(F) with the log-linear
+0.5 correction applied to every candidate, exactly as specified, and scales
`60 × clamp01(d′ / 3.0)`. The implementation is not the problem. The construct is.

Four independent findings converge on the same conclusion, and they are not fringe:

1. **Training moves accuracy without moving sensitivity.** Gray et al. (R. Soc. Open Sci. 2025,
   N = 664) is the study the spec's headline rests on. Trained typical-ability participants reached
   51% accuracy and **d′ = −0.066, not different from chance** (t₆₉ = 1.092, p = 0.279). Only
   super-recognisers gained real sensitivity. The authors' own reading is that training removed a
   below-chance *bias*, not that it created discrimination.
2. **The best causal study says the same thing.** Kamali et al. (2026), a within-subject
   counterbalanced experiment with 32 intelligence analysts, found a +9 point accuracy gain
   **driven by a +14.2 point improvement on REAL images** — i.e. criterion correction, not new
   sensitivity.
3. **The reliable variance may be a training-resistant aptitude.** The Gauthier-lab latent-variable
   work (in press, *JEP: General*) finds AI-face discrimination predicted by `o`, a domain-general
   object-recognition ability, above face recognition, above `g`, and above AI experience — and
   describes `o` as "expected to be relatively resistant to training".
4. **Where sensitivity does exist, it comes from exposure, not literacy.** Russell et al. (ACL 2025):
   five heavy LLM users, with no training and no feedback, misclassified 1 of 300 articles; rare
   users sat at chance (TPR 56.7%, FPR 52.5%) while reporting high confidence.

Put together: **a T2 sensitivity score is a mixture of a stable perceptual aptitude, familiarity
with the specific generators in this year's form, and how much the person happens to use AI at
work.** None of those three is "applied AI literacy" as §03 defines it. The one component that
*does* move with instruction — the criterion, c — is explicitly excluded from the point total by
design ("c is reported as a diagnostic and does not enter the point total"). Foray has therefore
built a track that scores the part that does not move and discards the part that does.

There is a second, mechanical consequence that has not been noticed. `scoring.ts` clamps
`d′ / ceiling` at zero. Diel et al.'s meta-analysis (56 papers, 86,155 participants) reports pooled
d′ **not significantly different from chance**, and untrained controls in Gray were *below* chance.
So in a general-population panel a large fraction of respondents will land at or below d′ = 0 and
all of them receive **exactly 0 of 60 points**. That is a floor pile-up: a spike of identical scores
at the bottom of the distribution. A floor pile-up cannot be IRT-scaled, cannot yield plausible
values, and makes a national mean move with the size of the spike rather than with ability. The
single most-quoted Foray output — "the country scores X on synthetic-media discrimination" — would
be, in large part, a measure of how many people the clamp swallowed.

### 2.2 Engagement

T2 is the most engaging thing in the instrument and it is not close. Swipe, instant feedback,
"I got 14 of 20", an image you can screenshot. Every viral AI-literacy artefact of the last three
years has this shape. If Foray travels, it travels on T2.

It is also the surface the evidence warns hardest about. Geissler et al. (N = 1,200, five arms,
pre-registered, two-week follow-up) found the **gamified and feedback arms did not beat control even
immediately** (65.7%, p_adj = 0.310; 60.0%, p_adj = 1.000), while plain textual and visual
instruction did (+7.5 and +13 points) — and at two weeks **no arm differed from control at all**.
The playful T2 loop is the intervention shape that the only well-powered longitudinal test found
does not work.

### 2.3 Scoring cost

Zero marginal cost. Arithmetic on response data, no model in the loop. At N = 500 and at
N = 50,000 the cost is identical. This is T2's real and only structural advantage, and it is a large
one.

### 2.4 Burn rate — the fatal economics

T2 items are consumables with a short half-life, burned by two independent processes:

- **Publication burns them instantly.** The moment an item appears in a share card, a practice deck
  or an archived form, its answer circulates. `docs/FUTURE-TRACKS.md` already states this as a
  one-way door.
- **Model progress burns them without anyone touching them.** The spec's own table: detector
  accuracy 87% on ProGAN (2018) → 24% on Midjourney v7 → 18% on Firefly v4. Six-fingered hands
  are dead tells. The 291-generator benchmark and Deepfake-Eval-2024 (open-source SOTA AUC down
  45–50% on in-the-wild media) say the same thing from the machine side.

Re-versioning cadence needed: **quarterly at minimum for the media block, and continuously if the
practice surface publishes items.** Tier A of §T2 says 75% of items are generated in-house, so the
cost is authoring labour plus generation, per quarter, in three languages, at 120 items per form —
and the practice surface needs a *disjoint* pool on top of that (Hausknecht: identical forms plus
coaching is the worst case for contamination, d > 0.26). This is the most expensive content
pipeline in the instrument and it is attached to the least defensible construct. That combination
is what makes the recommendation a demotion rather than a fix.

### 2.5 What a psychometrician attacks first

In order: (a) the floor pile-up at d′ ≤ 0 and what it does to the composite z-score;
(b) measurement invariance across en/ja/ko when the item mix (kanji/hangul rendering, culturally
specific scenes) plausibly differs in difficulty by language — the spec itself files this as an
`[Unverified]` hypothesis; (c) modality non-equivalence — Groh et al. (Nat. Commun. 2024, N = 2,215)
found accuracy swinging ~25 points across modality on identical content, so a single "T2 score"
aggregates four different abilities; (d) Ramon et al. (2024) found **no relationship** between face
ability and video deepfake detection while Davis et al. (2025) found one for static images —
i.e. the literature says there is no single discrimination trait to score; (e) test–retest, which
nobody has measured for this construct and which Geissler's decay result predicts will be poor.

### 2.6 Short-form viability

Excellent — and this is the awkward part. T2 is the *only* track that compresses cleanly into a
45–60 minute matrix block: short discrete items, fixed exposure, no rater, no artefact, no window.
Under `docs/SAMPLING.md` §5, T2 will carry most of the panel's measurement weight by default.
So the track with the weakest construct claim is the track that would dominate the published
national number. That is the strongest single argument in this document for changing T2 now rather
than later.

### 2.7 Recommendation — CHANGE

1. **Rename the construct and restate the claim.** T2 measures *how a person's belief about
   authenticity responds to evidence* — sensitivity **and criterion together** — not "AI literacy".
   The evidence base's own recommended wording: training corrects a systematic bias, it does not
   build a lasting detection skill.
2. **Score the criterion.** Move points onto |c| (distance from an unbiased criterion) and onto
   calibration, which is already 25 pts and is the most defensible thing in the track. Reduce the
   pure-d′ weight from 60. A candidate who is at chance but knows they are at chance is
   demonstrating the literacy; the current scoring gives them zero.
3. **Fix the floor before the panel wave.** Do not clamp at zero for reporting; retain signed d′ in
   the raw record so a below-chance result is a datum, not a tie.
4. **Reduce T2 from a 100-point track to a shorter diagnostic + calibration block** inside the
   sitting, and let the freed weight go to T3. Keep the full deck as the free, public, playable
   surface — that is where it earns its keep.
5. **Publish the practice/operational pool separation and a retest cool-down** (the INBDE model)
   before the practice surface ships, or the population trend will track practice uptake.

---

## 3. T1 · Creative Build

### 3.1 Construct validity

T1 is the cleanest construct in the instrument, for a reason that is easy to undersell: **it has an
external standard.** The site renders or it does not; contrast ratios are met or they are not; the
required brief elements are present or absent. Thirty of its hundred points are not a judgement at
all, and the spec is right that the aesthetic 40 must go to blinded human pairwise comparison rather
than a VLM (VAB: 26.5% vs 68.9%; the LAION-Aesthetics audit scoring the Met's non-Western
collections at zero is on its own sufficient).

The honest weakness is different from T2's. T1 does not risk measuring the wrong thing; it risks
measuring **prior web-development experience** wearing AI's clothes. A candidate who has shipped
HTML for ten years will beat a candidate who has not, with the same model. The spec's answer is that
AI assistance is "unrestricted and expected" and that the prompt log is a required artefact — but
the prompt log currently earns zero points (`score.ts`: the process signal is "DIAGNOSTIC ONLY (F8),
reported in raw, never added to any point component"; all 10 rationale points come from a judged
coherence dimension). So the one piece of evidence that separates *directing a model well* from
*already knowing how to build a website* is collected and then discarded. That is the single
highest-value cheap fix in this document.

> Read after 2026-09-02: this paragraph describes the code again, and the round trip is the
> point. The prompt log was scored on 2026-09-01 (§9.1, 25 points) and unscored on 2026-09-02
> (TEN-80). The diagnosis above still stands — T1 partly rewards prior web skill and the prompt
> log is the only evidence that separates the two. What TEN-80 established is that the MEASURE
> proposed in §3.7 does not fix it: a volume-monotone process score has no published validation
> against an independent outcome, and the programmes that do score process penalise excess
> actions rather than paying for them. See `.research/ten-80-process-evidence.md`.

### 3.2 Engagement

T1 is the track that travels. Not because it is fun in the moment — 48 hours of building is work —
but because it produces **an artefact with the candidate's name on it, hosted at a URL, that they
would send to someone anyway.** The offboarding ramp already built (`docs/FUTURE-TRACKS.md`:
download, GitHub, Vercel) makes the output leave the platform intact. Nothing else in Foray creates a
thing a person wants to keep. T2 produces a score screenshot; T1 produces a portfolio piece.

The peer-judging session is also, quietly, the most engaging 40 minutes in the design: people like
looking at other people's work and choosing, and "which would you rather put your own name on" is a
question people answer willingly for free.

### 3.3 Scoring cost — and the counter-intuitive result

Comparative judgement scales far better than the raw comparison counts suggest, and the arithmetic
should be stated because it changes the decision.

Verhavert et al. (2019, meta-analysis of 49 CJ assessments) put **SSR .90 at 26–37 comparisons per
representation**. Total comparisons = N × r ÷ 2, because each comparison informs two artefacts. If
the raters are the candidates themselves, comparisons **per rater** = r ÷ 2 — *independent of N*.

| Cohort | r per artefact | Total comparisons | Comparisons per candidate-rater | Rater time |
|---|---|---|---|---|
| N = 45 (worked example) | 24 | 540 | 12 | ~15 min |
| N = 500 | 30 | 7,500 | 15 | ~19 min |
| N = 50,000 | 30 | 750,000 | 15 | ~19 min |

Estimates: ~75 s per forced-choice pair. The result is that **T1's judging cost per candidate is
flat in N.** This is the strongest practical argument for keeping T1 at scale, and it is the
opposite of what people assume about human-judged tasks.

Three caveats, all real. (a) The spec's r = 24 buys SSR ≈ .85, not .90 — Verhavert's .90 band starts
at 26. Raise r to 30 and the per-rater burden goes from 12 pairs to 15. (b) Bramley (2015) shows
adaptive pairing inflates SSR — up to **0.89 on pure noise** with a true SD of zero. The spec already
mandates non-adaptive pairing; that decision must never be traded for efficiency. (c) Reliability
.90 supports **bands**, not ranks. At N = 50,000, telling someone they are 12,043rd is not supported
by the measurement, and the report must not imply it.

The cost that does *not* scale is **rater turnout**. In one room on D+1 with a few dozen
candidates, everyone judges. Asynchronously at N = 50,000, judging is a second visit, and non-response among raters — not
comparison volume — is what breaks the design.

### 3.4 Burn rate

The slowest-burning track in the instrument. A brief ("build a personal site for this audience") does
not have an answer key to leak. What ages is the *difficulty*: as models get better at one-shot site
generation, the brief stops discriminating and the score compresses upward. That is a **ceiling**
problem arriving on a model-release cadence, not an item-security problem.

Cadence: **annual brief re-issue is enough for security; the discriminating difficulty needs a
yearly review against the current frontier.** Cheap — one brief, three languages, no bank. Compare
with T2's 120 items per form per quarter per language.

### 3.5 What a psychometrician attacks first

The Bradley–Terry reporting discipline (CIs on score differences only, because the Fisher information
matrix is singular under shift — the spec has this right), then rater collusion and self-exclusion,
then the style covariates: partialling out "word count, image count, palette size, DOM depth" is a
modelling choice that can be argued either way, and any covariate set is contestable. Then the big
one: **is aesthetic merit a construct with a true value at all**, or is a Bradley–Terry fit just a
formal average of taste? The spec's UI-Bench framing ("would you rather put your own name on it")
is the best available answer and should be stated as the construct, not as the wording.

### 3.6 Short-form viability

**Poor — and `docs/SAMPLING.md` §5 already names T1 as the problem.** The untimed build window does
not fit a matrix block; the recommended fallback is a 30-minute reduced-scope build given to a random
third of the panel, with option (b) — exclude T1 from the national composite — as the declared
fallback. There is a harder constraint the sampling doc does not spell out: **the 40 comparative
points need a rater pool, and panellists will not come back to judge each other.** So even a
completed panel T1 block yields at most the 30 gate points plus rationale, i.e. a different
measurement from the one candidates sit. T1's contribution to the population statistic is therefore
partial at best.

### 3.7 Recommendation — KEEP, and promote

1. **Make T1 the flagship.** It is the thing people show other people. Product-wise, it is the
   track that justifies the credential.
2. ~~**Score the prompt log.** Move at least 10 points onto the process signal that `score.ts`
   already computes and throws away. Without it, T1 partly rewards prior web skill.~~
   **Done on 2026-09-01, reverted on 2026-09-02 (TEN-80), and the recommendation is withdrawn
   rather than deleted.** The 25-point component was monotone in prompt volume; the evidence spike
   found no published study validating such a score against an independent outcome, null-to-negative
   correlations wherever volume was measured against a real outcome, and two operational precedents
   (PISA 2012, USMLE Step 3 CCS) that score volume in the opposite direction. The signal is computed
   and reported as a diagnostic and earns nothing. A REPLACEMENT that reads the relationship between
   a prompt and the change it produced is the surviving idea, and it needs evidence we do not have.
3. **Raise r to 30** so the reported reliability is honestly in the .90 band, and keep non-adaptive
   pairing permanently.
4. **Accept that T1 is a Track-A instrument.** Plan the national composite on T2–T4 with T1 stated
   as excluded, and report the T1-in / T1-out contrast as the sensitivity analysis §9 requires.

---

## 4. T3 · AI-Assisted Reasoning

### 4.1 Construct validity — the strongest in the instrument

T3 is the only track that measures **behaviour in the presence of a model** rather than a perception
or an artefact. The planted-error mechanism is the design's best idea: an assistant seeded with a
misattributed figure, a false causal claim, a fabricated citation and a wrong calculation, and the
score is whether the candidate caught them. That is a direct measurement with no judge in it, and
`packages/tracks/t3-reasoning/src/scoring.ts` implements it as such — 25 points RSR, 10 points RAIR,
20 points process quality from the transcript, all model-free; 45 points routed to a stored jury.

> Read after 2026-09-02: this review predates two changes and its numbers are the numbers at the
> time of review. T3 was re-weighted to 160 points, and the two components were renamed from `rsr`
> and `rair` to `errorCatchRate` (50 pts) and `adviceUptakeRate` (30 pts), in TEN-38 and then in
> TEN-72. RSR and RAIR are Schemmer et al.'s published statistics and T3 does not compute them; the
> names TEN-38 chose then read as the failure while the value held the credit for avoiding it. Every
> "RSR"/"RAIR" below that names a Foray component means those two. The allocation table in
> `packages/core/src/allocation.ts` is the live source.

The implementation is more careful than the spec. RAIR requires *deliberation before acceptance*: a
claim must have been challenged, or checked against the source after it surfaced, before its
acceptance earns full credit; a blind instant accept of correct advice earns half, because "the
candidate happened to be right, but exhibited the same behaviour that swallows planted errors."
That is a genuine measurement insight and it is in the code, not the spec.

T3's construct has a partial external warrant. The Microsoft/CMU study of 319 knowledge workers
found generative AI shifts critical thinking toward **verification, integration and stewardship** —
which is exactly what the process component scores — and that higher confidence in the AI goes with
less critical thinking. Nothing in T2's evidence base is this aligned.

The reliance half is weaker than this section said before (corrected 2026-09-02, TEN-32). RSR and
RAIR are real names with a real source — Schemmer et al., IUI '23, doi:10.1145/3581641.3584066 —
but **Foray does not compute either statistic.** Both are defined on a two-stage judge–advisor
design where the human answers first and the model advises second, and T3 collects no first-stage
answer. What T3 measures is over- and under-reliance as Passi & Vorvoreanu define them
(MSR-TR-2022-12): agreement with incorrect advice, and refusal of correct advice. Those rates are
established; the RSR/RAIR conditioning is not ours to claim. Two reviews (Eckhardt et al., ACM
CSUR 2025; Raees & Papangelis, arXiv:2604.23896) describe the appropriate-reliance construct as
fragmented with no consensus metric, and the published concept is defined for classification tasks
only, so its use on a 90-minute writing task is ours as well. No reliability figure exists for any
behavioural reliance measure. The full trace is in the private repo's
`docs/EVIDENCE-CALIBRATED-RELIANCE.md`; the limits a reviewer should see are listed in spec §T3,
"What this track cannot claim"; the study that would fix it is `docs/TRANSFER-STUDY.md` §3.

The weakness: **45 of 100 points are an LLM jury**, and the evidence for that is conditional — and
weaker than this paragraph originally said (corrected 2026-09-02, TEN-34). Naive LLM essay scoring
runs at QWK 0.02–0.48, not "< 0.30", and human–human agreement on ASAP is a *range*, 0.63–0.85 with
median 0.76, not a 0.72 ceiling. The locked-rubric, evidence-anchored, distribution-calibrated
version reaches QWK 0.708–0.712 in **one unreviewed preprint** (arXiv:2601.08654), on one dataset
with one model family — below that median human pair — **and it requires ~200 human-labelled
calibration examples**, per rubric, per language. Until those exist, the 45 points
are not the measurement the spec describes. Also: three models from three families is the adopted
design, but the demo path (`packages/report/src/judging.ts::judgeT3`) returns three *seeded samples
of one stub*, and the stub's score is essentially a length band. Heterogeneity is a plan, not a fact.

### 4.2 Engagement

The weakest of the four, honestly. Ninety minutes with a 50–70 page document and a 1,200-word write-up
is an exam, and it feels like one. Nobody shares their T3 essay.

But it has one asset nothing else has: **the reveal.** Telling a candidate afterwards "the assistant
lied to you four times; you caught two, and here is where" is a genuinely arresting experience, and
`packages/tracks/t3-reasoning/src/reveal.ts` exists to do it. That is the shareable object — not the
essay, the *catch rate*. "I caught 3 of 4 planted errors" is a better share card than any T2 score
because it is a story about the person, not a quiz result.

A short, playable version of exactly this — a 5-minute assistant conversation with one planted
error — is a better viral product than the T2 swipe deck and burns much slower.

### 4.3 Scoring cost

| Cohort | Model-free 35 pts | Jury 45 pts (3 models over ~1,200 words + transcript) | Human adjudication as specified |
|---|---|---|---|
| N = 500 | $0 | ≈ $0.10–0.20 each → **$50–100** | top+bottom decile = 100 reads |
| N = 50,000 | $0 | **$5,000–10,000** | **10,000 reads — not feasible** |

Estimates. The jury cost is fine at both scales. The part that does not scale is the spec's
"top and bottom deciles human-adjudicated": 20% of a 50,000 cohort is 10,000 expert reads. That rule
must become **a fixed audit sample plus appeals**, decided now, or it becomes a rule that is quietly
broken later — which is worse than changing it openly.

### 4.4 Burn rate

Moderate, and burning in an unusual direction. The primary source can be rotated cheaply. The
**planted errors** are the consumable: once "watch out for the fabricated citation about X" is public,
that item is dead. But the *error families* — fabricated citation, wrong calculation, false causal
claim, misattributed figure — are stable, so re-versioning means new instances of known families
rather than new families. That is the cheapest possible refresh.

The direction the spec has not planned for: **as models hallucinate less, planting errors becomes
less naturalistic**, and a candidate who trusts a 2028 model may be behaving correctly. T3's
difficulty calibration has to track model reliability, and the score has to be interpreted against a
declared base rate of planted errors. State the planted-error density in every report, the way
exposure time is declared for T2.

### 4.5 What a psychometrician attacks first

The 45-point jury, immediately, and rightly — no accredited human certification currently admits LLM
scoring as a score of record. Then RSR reliability: **4 planted errors is a 4-item subtest carrying
25 points.** A 4-item test cannot have decent reliability; a candidate who catches 2 of 4 versus 3 of
4 differs by 6.25 points on essentially a coin flip. **This is T3's most fixable and most serious
defect: raise the planted-error count to 8–12.** Then the transcript-derived process score, which is
a set of hand-chosen behavioural counts with no published validity evidence — report it, defend it as
descriptive, do not oversell it.

### 4.6 Short-form viability

**Better than it looks, if the essay is dropped.** A 20-minute assisted-reasoning block over a short
source with 4–6 planted errors, scored on RSR/RAIR and transcript behaviour alone, is a self-contained
matrix block with no rater, no judge, no artefact and no window — 35 of the 100 points survive
compression intact and they are the model-free ones. The 45-point analysis component cannot compress
(you cannot write 1,200 defensible words in a matrix block) and should be dropped from the panel form
rather than shrunk, with the linking done on the RSR/RAIR anchor items.

That is a strong result: **the most defensible component of the most defensible track is also the one
that survives the population short form.**

### 4.7 Recommendation — KEEP, and make it the centre

1. **Raise the planted-error count to 8–12** and report catch rate with a confidence interval.
2. **Move weight from the jury to the model-free components** — the current 35/100 model-free should
   be 50/100 or more. This also reduces the exposure the §04 design principle is built to bound.
3. **Do not ship the 45-point jury until the ~200-example human-labelled calibration set exists**,
   per language. Until then, report analysis quality as a band with a stated error, not as points.
4. **Build the short T3 as the panel block and as the viral product.** One planted error, five
   minutes, a reveal at the end.

---

## 5. T4 · Generative Direction

### 5.1 Construct validity

T4 claims to measure "direction, not generation" — can a person take a communicative brief to a
finished visual result. The 30-point brief-compliance component is the right idea and the spec's
defence of it is sound: show the work to blind viewers without the brief, ask what it communicates,
score the agreement. That is objective, model-free, and it is the only part of generative work that
has an answer.

The problem is that **the rest of T4 is T1 again.** Forty points of blinded pairwise comparative
merit on the same Bradley–Terry machinery; twenty points of process evidence from a prompt log;
ten points of provenance hygiene. Two tracks, one scoring apparatus, one claim type (`[Proxy]`,
"artefact quality proxies creative capability"). §03 maps T1 to "Create with AI 1–3, Manage AI 1–3"
and T4 to "Create with AI 1, 2, 4" — an overlap, not a distinction. If T1 and T4 scores correlate
above ~.6 in the calibration cohort, T4 is buying a hundred points of nothing, and that correlation
should be the first thing computed from the first cohort's data.

There is a second construct problem specific to image generation: **the model does most of the
variance.** A 2026 image model produces a competent image from a mediocre prompt. What separates
candidates is largely taste in *selecting* among outputs — which is real, but it is much closer to
T1's aesthetic comparison than to a distinct literacy.

The code makes this worse than the spec. `packages/tracks/t4-generative/src/score.ts` puts **80 of
100 points** (brief-fit 30, comparative 40, provenance 10) on stored judgment medians, and the
pipeline routes brief-fit to `queue: "judge"` — a **model** — not to the blind human viewer panel
whose humanness is the entire justification for that component (`plugin.ts:173`). As built, the one
objective thing in T4 is scored by the kind of judge the spec spent a page arguing against.

### 5.2 Engagement

Genuinely high in the moment, and the public gallery is a real asset. Making images is fun. But the
engagement does not convert into what Foray needs: the output is a picture that looks like every other
AI picture, the brief is someone else's, and the sharing value decays as generated images become
ambient. Compare T1, where the output is *the candidate's own site*.

### 5.3 Scoring cost — the highest of the four, by a wide margin

| Item | Per candidate | N = 500 | N = 50,000 |
|---|---|---|---|
| Final renders (3 × $0.134 + video $0.12) | ≈ $0.52 | $260 | $26,000 |
| Unlimited drafts (est. 30 × ~$0.03) | ≈ $0.90 | $450 | $45,000 |
| Comparative judgement (flat in N, as T1) | 15 pairs | — | — |
| Blind-viewer brief-compliance panel | needs a second human pool | feasible | needs its own recruitment |
| **Human approval of every gallery asset** | 4 assets | 2,000 approvals | **200,000 approvals** |

Estimates from spec §T4 model pricing. The generation cost is survivable. The **approval gate is
not**: the spec commits to "a human approves every asset before it becomes publicly visible", which
at 20 seconds per asset is ~1,100 person-hours at N = 50,000. Reviewing every asset is affordable
for a pilot cohort. It does not survive scale, and the alternatives (sampled approval, takedown-based moderation) are exactly the
weaker posture the spec refused. **T4 is the track whose governance model contradicts Foray's growth
plan.** That is a structural fact, not a cost line.

### 5.4 Burn rate

The fastest-ageing track after T2, for a different reason: **the brief does not burn, the model
does.** T4 pins Gemini 3 Pro Image and Veo 3.1 Fast by date suffix, correctly, for reproducibility.
But a score of record computed on a pinned 2026 model measures 2026 direction skill against 2026
tooling, and a 2027 candidate on a 2027 model is not comparable. Every model refresh is an equating
event. T2 needs new items; T4 needs a new *scale*, which is worse.

### 5.5 What a psychometrician attacks first

The T1–T4 correlation (redundancy), then the blind-viewer panel's inter-rater agreement on "what does
this communicate", which is an open-ended coding task and needs a codebook and a κ, then the
model-pinning equating problem above, then the same Bradley–Terry issues as T1 with a smaller
effective sample of raters.

### 5.6 Short-form viability

**The worst of the four.** Sixty minutes is already most of the 45–60 minute panel budget on its own,
and 70 of its 100 points (comparative 40 + blind viewer 30) require human panels that a probability
panel structurally cannot supply — panellists are paid once and do not return to judge each other.
A compressed T4 block would yield the 20 craft points and the 10 provenance points: 30 points of a
100-point track, measuring prompt-log shape and metadata hygiene. That is not T4.

**T4 cannot contribute to the population statistic.** By §6's own criterion — a track that cannot be
shortened cannot contribute at all — that is disqualifying for a track whose purpose includes the
ministry-citable number.

### 5.7 Recommendation — CUT as a scored track

Keep the runner, the gallery and the brief. Move them to the **play surface**: an unscored, public,
shareable generative challenge with the gallery it already has. It is good product. It is not a
hundred points of measurement.

What to do with the one thing T4 measures that nothing else does — *did the artefact communicate what
it was meant to communicate* — is to **move it into T3 as a rubric dimension**. T3 already produces a
written analysis for a named stakeholder; "would the stakeholder understand the position" is the same
construct, measured on material that is cheaper, compressible and already collected. This follows
`docs/FUTURE-TRACKS.md`'s own pattern of preferring an item family or rubric dimension over a track.

Redistribute the freed weight: T1 and T3 to 150 points each, T2 to 100, or a three-track 100/100/100
with T2 reduced. The four-track symmetry is aesthetic, not psychometric.

---

## 6. The divergence between spec and code — a finding in itself

Audited against `packages/tracks/*/src` (full detail in the audit notes accompanying this review):

- **Bradley–Terry does not exist anywhere in this repository.** Two doc comments and the stage-id
  string `"pairwise-comparative"` are the whole of it. **80 of the 400 spec points** — T1's 40 and
  T4's 40 — have no measurement code. In the demo they resolve through
  `packages/report/src/judging.ts`, a sha256-seeded stand-in over string length and regex.
- **T1's accessibility and functional gates do not exist.** No contrast check, no viewport check, no
  landmark or keyboard test; `cfg.requiredElements` is displayed to the candidate
  (`Runner.tsx:544`) and never verified. The 30 points the spec calls "machine-checkable" are, in
  code, another judgment median.
- **T4's brief-fit goes to a model judge**, not to the blind human viewer panel the spec requires.
- **T3's three-model heterogeneous jury is one stub with three fake model ids** (`judge.ts:25–41`),
  banding on answer length.
- **T2 is the only track that matches its specification.** Its scoring is implemented exactly as
  written. (Its item bank in this public repo is the 20-item redacted demo tier by design; the
  operational bank is in the private repo.)

Two conclusions follow, and they point the same way.

First, **"it is already built" is not an argument for keeping T1 or T4 as scored tracks**, because
the parts that make them defensible are the parts that are not built. The runners are built. The
measurement is not. Choosing what to build next is therefore a genuinely open decision, which is
what makes this review worth acting on.

Second, the §04 design principle — "no track is scored the same way as any other", so a flaw in
LLM-judge methodology damages at most 40–45 points out of 400 — **is currently false in the code.**
As implemented, T1 (100), T4 (80) and T3 (45) all resolve through stored judge values: ~~225 of 400
points~~, not 45. The principle is sound and worth restoring; it is not currently true.

> **Corrected — do not quote 225.** The count above is wrong twice over, and both corrections are
> kept rather than edited away because this section is the record of what the review believed on
> 2026-09-01. (i) The number was **241 of 400**, not 225: T4's `craft` is a blend and was judge-resolved
> for 96 of its 100 points, not 80 — see §9.2(a). (ii) That figure is now historical. After the
> restructure recorded in §9 the implemented judge exposure is **180 of 400** and the *designed*
> LLM-judge exposure is **80 of 400**, against 220 model-free, 40 machine-gate and 60 human-cj.
> `pointsByResolution()` in `packages/core/src/allocation.ts` is the only place those numbers live;
> `packages/core/test/spec-allocation.test.ts` checks the spec against it and
> `apps/web/test/allocationResolution.test.ts` checks it against the real `score()` paths.

---

## 7. What is missing

`docs/FUTURE-TRACKS.md` already ranks three additions and, importantly, already reaches the right
structural conclusion twice: injection detection is **a T2 item family, not a track**; verification
checkpoint placement is **a T3 rubric dimension, not a track**; eval design leads the fifth-track
candidates because a harness is an artefact and needs no run-verification. Nothing below re-proposes
those. The three candidates the parent task names are judged here on measurement grounds only.

### 7.1 Delegation and orchestration judgement — REJECT as a track, ADOPT as a T3 dimension

*The construct:* knowing what to hand to a model, how to specify it, and how to decompose a job
across several calls or agents.

*Why it is measurable:* it has an outcome criterion. A delegation decision is right or wrong in a way
an aesthetic judgement is not — the delegated subtask either came back usable or it did not. The
evidence is already collected: T3's transcript records decomposition and prompt iteration, and its
process component (20 pts) nominally scores exactly this.

*Why it fails as a track:* **the answer key has a six-month half-life, and it is model-specific.**
"Do not ask a model to do arithmetic" was correct in 2023 and wrong once tools arrived. "Decompose
long tasks into steps" is being eaten by long-horizon agents. An item keyed to a delegation boundary
is keyed to one model's current capability frontier — so the track would re-version faster than T2,
whose items at least stay wrong-in-a-stable-way. Worse, cross-year comparability dies: a candidate
who delegates more in 2028 than in 2026 may be *more* skilled, not less, and the scale cannot tell.

*Verdict:* real construct, unstable key. It belongs where its instability is bounded — as a scored
dimension of T3's process component, reported descriptively against a stated model and date, not as
a hundred-point track claiming a stable trait.

### 7.2 Verification behaviour under time pressure — ADOPT, and it is the cheapest thing on this list

*The construct:* not "do you know you should check", which everyone answers correctly, but **do you
check when checking costs you something.**

*Why it is measurable, well:* verification is an **observable event with a timestamp**, not a
judgement. `scoring.ts` already counts distinct claims checked against the primary source
(`verificationCount`, requiring the turn to name the claim it checked — a nicely strict definition).
The construct is a *rate under a manipulated cost*, and rates have better psychometric properties
than judgements: no rater, no key, no rubric, no language dependence, no cultural loading.

*What is missing is only the manipulation.* Today T3 gives 90 minutes and counts verifications. The
measurement people actually want is the **slope**: verification rate at 90 minutes versus at 30, or
under a visible countdown, or with a stated word target the candidate cannot hit if they verify
everything. Within-subject, randomised, cheap — it is a condition flag on an existing track, not new
code, and it produces a genuinely novel published finding (nobody has this number).

*The attack to pre-empt:* observing verification changes it. Candidates who know the transcript is
scored will verify performatively. Mitigate by scoring *discriminating* verification — did they check
the claims that were wrong — which the planted-error design already makes possible, and which
performative checking cannot fake.

*Verdict:* adopt for v2026.1 as a T3 condition. Highest ratio of measurement value to build cost in
this document.

### 7.3 Knowing when NOT to use AI — the strongest missing construct, and the hardest to score

*The claim first:* this is the highest-value unmeasured construct in the field. Every existing
instrument, Foray included, measures competence *conditional on using AI*. None measures whether the
person should have opened the model at all. The failure mode it detects is the most economically
consequential one in real organisations — reflexive delegation of judgement — and the Deloitte
Australia case in `docs/FUTURE-TRACKS.md` is precisely that failure, not a prompting failure.

*The three measurement objections, stated honestly:*

1. **There is no defensible answer key.** "Should you use AI for this?" is normative and contested.
   A ministry reviewer will ask who decided, and the honest answer is "we did". Any keyed
   should-not-use item is a values claim wearing a psychometric coat.
2. **Demand characteristics destroy the self-report version.** On an exam called *the AI Literacy
   Examination*, a candidate asked whether they would use AI learns within two items that the
   sophisticated answer is "not here, and I would verify". Situational-judgement items on this
   construct measure test-wiseness. This objection alone kills the obvious design.
3. **Under-use is a failure too, and the scale is two-tailed.** A person who refuses AI on a task
   where it would have helped is also failing. A one-directional "abstained = correct" key would
   score Luddism as literacy.

*The design that survives all three:* do not ask; **make abstention cost something and measure
behaviour.** Give a task where the assistant is genuinely available, where using it is *slower or
worse* on some subtasks and *faster or better* on others, and measure the candidate's realised
allocation against the outcome they achieved. The key is then not a normative claim but an empirical
one — did their use of the model make their answer better — which is objective, two-tailed by
construction, and immune to demand characteristics because it is inferred from what they did under
time pressure, not what they said.

This is measurable **and it is nearly free**, because T3's seeded assistant already creates the
asymmetry: on planted-error claims, using the assistant is actively harmful. RSR is, read this way,
already a partial measure of appropriate non-reliance. What is missing is the *positive* half —
tasks where the assistant is right and faster, so over-abstention is penalised — and RAIR is exactly
that. **Foray has accidentally built two-thirds of the best available measure of knowing when not to
use AI, and calls it "appropriate reliance" worth 10 points.**

*Verdict:* adopt, by promoting RSR/RAIR from 35 points inside T3 to the **named construct of the
track**, adding an explicit no-assistance-is-better subtask, and reporting a two-tailed reliance
index (over-reliance / calibrated / under-reliance) rather than a single number. Do not build it as a
fifth track: as a track it needs an answer key it cannot have; as a behavioural measure inside T3 it
needs no key at all.

---

## 8. What this adds up to

**The instrument's centre of gravity is in the wrong place.** T2 has the most engaging surface, the
cheapest scoring, and the weakest construct claim — and, because it is the only track that
compresses into a 45–60 minute matrix block, it would dominate the ministry-facing number by
default. T3 has the strongest construct, the only objective un-gameable measurement, the slowest
burn, and it is the track nobody would choose to play. The design work is to move weight from the
first to the second without losing the surface that makes people arrive.

**The single track to keep, if forced to one: T3.** With the changes above — more planted errors,
model-free weight raised, a time-pressure condition, and the reliance index reported two-tailed — it
measures the thing the field cares about, it survives the panel short form, its content ages
gracefully, and a psychometrician's first attack (the LLM jury) can be answered by shrinking the
jury's weight rather than defending it.

**The proposed shape.**

| | Scored instrument | Play surface | Population short form |
|---|---|---|---|
| T1 Creative Build | **150 pts** — flagship, prompt log scored, r = 30 | artefact + gallery | excluded, stated |
<!-- Superseded: T1 shipped at 160 with the prompt log scored (§9.1) and is 135 since TEN-80 unscored it. -->
| T2 Discrimination | **100 pts** — d′ *and* criterion, calibration weighted up | the swipe deck, disjoint pool | core block |
| T3 Reasoning | **150 pts** — 8–12 plants, reliance index, timed condition | 5-minute "the assistant lied" | RSR/RAIR block, essay dropped |
| T4 Generative | **cut** | gallery challenge, unscored | — |

**What to cut: T4.** It duplicates T1's construct and machinery, costs the most per candidate, has a
governance model (human approval of every asset) that does not survive scale, cannot be compressed
for the panel, and its one distinctive measurement — did the work communicate what it was meant to —
is better collected as a T3 rubric dimension. Cutting it also restores the §04 design principle by
removing 80 points of judge-resolved scoring.

**What to change first, in cost order:** ~~score T1's prompt log (already computed, currently
discarded)~~ [withdrawn 2026-09-02 — see §3.7]; raise T3's planted errors from 4 to 8–12; add the time-pressure condition; stop clamping
T2's d′ at zero and move points onto criterion and calibration; build Bradley–Terry, or stop claiming
it.


---

## 9. Addendum — what was implemented, 2026-09-01

This section records what the restructure actually did, and where the code disagreed with the
analysis above. Written after the change landed, not before.

### 9.1 The shape that shipped

| | Points | Composite weight | Change |
|---|---|---|---|
| T1 Creative Build | **135** | .36 | r = 24 → 30. Shipped at 160 with the prompt log scored for 25 model-free points, and back to 135 the next day when TEN-80 unscored it — see §9.6 |
| T2 Synthetic-Media Discrimination | **80** | .213 | criterion scored (15 pts); pure-d′ 60 → 25; floor spike removed; renamed |
| T3 Calibrated Reliance | **160** | .427 | two-tailed reliance index; 3 → 8 planted errors; model-free 35/100 → 115/160 |
| T4 Generative Direction | **0** | 0 | unscored showcase; runner and gallery stay |

Total 375 after TEN-80 (400 for the one day the prompt log was scored). Model-free measurement
went from 159 of 400 to 220 of 400, and is **195 of 375** now. The composite weights are
proportional to the points by construction, so all three moved when T1's 25 points went: a share of
a smaller instrument is a bigger share.

### 9.2 Four things the analysis above got wrong or left out

**(a) The judge-exposure number was 241, not 225.** §6 counted T4's judge-resolved points as 80
(brief-fit 30 + comparative 40 + provenance 10). It missed that `craft` is a blend: 50% steering
efficiency read from stored per-DRAFT judge values and 30% direction-note judgment are also
judge-resolved, so T4 was 96 of 100, not 80. Only `craft.quota` — 4 points — was model-free. The
true implemented exposure was **241 of 400**. Recount before quoting.

**(b) Cutting T4 under equal weighting would have PROMOTED T2, not demoted it.** This is the
single most important thing this document missed, and it is easy to miss because it hides between
two true statements. The composite is built from **z-scores**, not raw points, and §04's weights
were four equal quarters. Drop T4, keep "equal weighting", and T2 goes from a quarter of the
composite to a **third** — the exact opposite of the demotion §2.7 recommends. Point allocation
alone cannot demote a track. The weights had to move too, and they now follow the declared points
(T1 .40, T2 .20, T3 .40).

**(c) The evidence base does not support the reliance construct — it is silent on it.** A
citation-level check of `/tmp/ailx-research-01a04bca/` found **no definitions of RSR or RAIR, no
origin papers, no published index or scoring scheme for calibrated reliance, no two-tailed
treatment of reliance in the literature, and no evidence on verification behaviour under time
pressure or cost.** §7.2 and §7.3 above read as though that evidence exists. It does not, in this
base. The two-tailed index shipped anyway, because the design argument stands on its own — it is
behavioural, keyless, symmetric and immune to demand characteristics — but it ships **marked as
Foray's own construction with no external validity evidence**, in the scorer's module comment and
in spec §T3. The same check found no corroboration for the QWK 0.708–0.712 figure the spec quotes
for a calibrated jury; what the base contains is one small study (n = 67) with a low,
non-significant result. A follow-up spike (2026-09-02, TEN-32) then traced the figure itself to one
unreviewed preprint, arXiv:2601.08654 — one model family, one dataset — and measured human–human
QWK on ASAP at 0.63–0.85, median 0.76, which puts 0.71 below the median human pair. The same spike
reached the wider literature this base had missed: RSR and RAIR **are** defined, by Schemmer et al.
(IUI '23), and Foray computes neither of them. See §4.1. Those 45 points are marked unimplemented for more reasons than one.

Two other citation corrections: Verhavert's bands are SSR .70 at ~13 comparisons, .80 at 19–20,
.90 at **26–37** — so r = 30 is inside the .90 band, as §3.3 says. Diel et al. is k = 137 across
56 papers with pooled accuracy 55.54% [48.87, 62.10].

**(d) The evidence cuts against cutting T4 in one place, and it is worth naming.** PISA 2029's
Media & AI Literacy framework gives roughly half its test time to *create* alongside analyse and
evaluate. Cutting a generative track moves Foray away from that balance. The answer is that T1 is a
create track, it is now the flagship, and it has an external criterion — Foray did not stop
measuring creation, it stopped measuring it twice — but the tension is real and the spec states it.
Similarly, §2.1's case for demoting d′ is partly contradicted by Diel's own reading that *accuracy*
is confounded with criterion, which is the original argument for scoring d′ at all. d′ keeps 25
points and a renamed construct rather than being dropped.

### 9.3 Two design decisions this document did not anticipate

**The d′ floor is now a declared constant, and where it sits changes every score.** §2.7 says
"do not clamp at zero for reporting". Not clamping needs a bottom, and the bottom is a policy
choice: sensitivity scales from `D_PRIME_FLOOR = −1.0`, roughly "systematically calling real
content synthetic and synthetic content real". Moving that floor moves the whole distribution, so
it is declared, tested, and configurable per form rather than hidden in a clamp.

**Scoring the criterion opened a hole that silence could walk through.** A candidate who answers
nothing misses every signal item *and* false-alarms every noise item; the two probits cancel and c
lands at ~0 — an unbiased-looking criterion earned by not playing. The declared missing-response
rule (already used for calibration) now gates the criterion as well. A test pins it shut.

### 9.4 What is still not built

Bradley–Terry (60 points), T1's accessibility and functional gates (40 points), and T3's calibrated
three-family jury (45 points) — **145 points of specified measurement that does not exist**. All
three are now marked `implemented: false` in `packages/core/src/allocation.ts`, listed in spec §04,
and flagged inline at each score allocation. `packages/core/test/spec-allocation.test.ts` fails the
build if the spec and the allocation table stop agreeing, which is the guard whose absence let the
original §04 claim go wrong by a factor of five.

### 9.5 §7.2 shipped, minus the claim it was written with (2026-09-02, TEN-30)

The verification measure §7.2 asked for is built. The verification quarter of T3's Process component
now scores **discriminating** verification — a claim checked before the answer was final, resolved
afterwards the right way — and pays nothing for volume, so the performative-checking attack §7.2
names is priced out. T3's points did not move.

The manipulation is a form parameter, `timeBudgetMinutes`, recorded on every sitting as
`condition.timeBudgetMinutes`. Forms that declare nothing behave exactly as before.

Two corrections to §7.2's framing. First, the transcript cannot tell a check that found the
discrepancy from a lucky call after an idle press; it records that a claim was checked, not what was
read. The measure is defined on the stance that follows the check and the spec says so. Second,
§7.2 assumes the slope is the finding. The evidence base is thinner than that: reliance rose 0.48 →
0.54 under time pressure in 28 experts (Rosbach et al., MELBA 2026, t(27) = 2.55, p = .017), but the
**rate** of error adoption did not move (arXiv:2411.00998, p = 0.19), and *when* the assistant
speaks moved over-reliance more than the clock did (Swaroop et al., arXiv:2306.07458). Our timer and
our interface still vary together, so until the arm in `docs/TRANSFER-STUDY.md` §3.5 runs, a
condition comparison describes this form and not the construct.

### 9.6 The prompt log is unscored again (2026-09-02, TEN-80)

§3.7's second recommendation shipped on 2026-09-01 and was reverted the next day on evidence. The
component was `0.5 × min(1, distinctPrompts/3) + 0.5 × min(1, cycles/3)`, worth 25 of T1's 160
points, and both halves are **monotone in volume**.

The spike (73 sources examined, 44 read in full; report in `.research/ten-80-process-evidence.md`)
found: no published study validating a volume-monotone process score of AI-assisted work against an
independent outcome; null-to-negative associations wherever volume HAS been measured against a real
outcome (Copilot completions shown r = 0.01 n.s. against acceptance ratio ρ = 0.24, Ziegler et al.
MAPS '22; dialogue turns r = −0.01 against expert-rated artefact quality; help-seeking volume
r = −0.46 with learning gain); and two operational precedents that score process — PISA 2012
problem solving and USMLE Step 3 CCS — scoring volume **non-monotonically**, removing credit above
a budget. NAEP and PIAAC collect process data and do not score it. Our own constants made it worse:
full credit at three distinct trimmed, case-folded strings saturates in seconds, so the component
stopped discriminating between everyone who performed the ritual while docking about 4 points from
the candidate who solved the brief in two precise prompts.

What changed in code: T1 is **135 points**, the instrument is **375**, the composite weights
followed the points (.36 / .213 / .427), and `processSignal()` is still exported, still computed and
still reported in `raw` as `process.signal` with zero weight. The 25 points were removed, not
redistributed — the evidence supports deleting a component and says nothing about the other four
being worth more. `packages/tracks/t1-creative-build/test/score.test.ts` now asserts the
volume-invariance property TEN-80 asked for: identical judgments and 0 versus 400 prompt-log
entries produce an identical score.

**One finding reported and deliberately not fixed here.** T3's Process-quality component (35 points)
counts verification events, which is volume-shaped even after §9.5 narrowed it to *discriminating*
verifications. That is a T3 decision and this branch did not touch it. It is why the
volume-invariance test is written for T1 alone.
