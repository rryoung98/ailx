# TRACK-REVIEW.md — are T1–T4 the right things to measure?

Status: analysis and recommendation, 2026-09-01. No track code was changed to write it.
Scope: the user's question — *"Are T1 through T4 the exact kind of material we should be testing,
and the most engaging?"* — judged against two goals that pull in opposite directions: a game people
choose to play, and a statistic a ministry would cite.

Sources: `AILX-Spec-2026.1.md` (§03, §04, T1–T4, §09), `docs/FUTURE-TRACKS.md`,
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
larger than any cross-national difference AILX would want to report. A viral surface recruits
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
design ("c is reported as a diagnostic and does not enter the point total"). AILX has therefore
built a track that scores the part that does not move and discards the part that does.

There is a second, mechanical consequence that has not been noticed. `scoring.ts` clamps
`d′ / ceiling` at zero. Diel et al.'s meta-analysis (56 papers, 86,155 participants) reports pooled
d′ **not significantly different from chance**, and untrained controls in Gray were *below* chance.
So in a general-population panel a large fraction of respondents will land at or below d′ = 0 and
all of them receive **exactly 0 of 60 points**. That is a floor pile-up: a spike of identical scores
at the bottom of the distribution. A floor pile-up cannot be IRT-scaled, cannot yield plausible
values, and makes a national mean move with the size of the spike rather than with ability. The
single most-quoted AILX output — "the country scores X on synthetic-media discrimination" — would
be, in large part, a measure of how many people the clamp swallowed.

### 2.2 Engagement

T2 is the most engaging thing in the instrument and it is not close. Swipe, instant feedback,
"I got 14 of 20", an image you can screenshot. Every viral AI-literacy artefact of the last three
years has this shape. If AILX travels, it travels on T2.

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

### 3.2 Engagement

T1 is the track that travels. Not because it is fun in the moment — 48 hours of building is work —
but because it produces **an artefact with the candidate's name on it, hosted at a URL, that they
would send to someone anyway.** The offboarding ramp already built (`docs/FUTURE-TRACKS.md`:
download, GitHub, Vercel) makes the output leave the platform intact. Nothing else in AILX creates a
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
| N = 45 (spec) | 24 | 540 | 12 | ~15 min |
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

The cost that does *not* scale is **rater turnout**. At N = 45 in one room on D+1, everyone judges.
Asynchronously at N = 50,000, judging is a second visit, and non-response among raters — not
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
2. **Score the prompt log.** Move at least 10 points onto the process signal that `score.ts` already
   computes and throws away. Without it, T1 partly rewards prior web skill.
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

The implementation is more careful than the spec. RAIR requires *deliberation before acceptance*: a
claim must have been challenged, or checked against the source after it surfaced, before its
acceptance earns full credit; a blind instant accept of correct advice earns half, because "the
candidate happened to be right, but exhibited the same behaviour that swallows planted errors."
That is a genuine measurement insight and it is in the code, not the spec.

T3's construct also has the best external warrant. The Microsoft/CMU study of 319 knowledge workers
found generative AI shifts critical thinking toward **verification, integration and stewardship** —
which is exactly what the process component scores — and that higher confidence in the AI goes with
less critical thinking. RSR/RAIR come with a survey literature. Nothing in T2's evidence base is
this aligned.

The weakness: **45 of 100 points are an LLM jury**, and the evidence for that is conditional. Naive
LLM essay scoring runs at QWK < 0.30 against a human ceiling of 0.72. The locked-rubric,
evidence-anchored, distribution-calibrated version reaches QWK 0.708–0.712 — **but requires ~200
human-labelled calibration examples**, per rubric, per language. Until those exist, the 45 points
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
should be the first thing computed from the summit data.

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
engagement does not convert into what AILX needs: the output is a picture that looks like every other
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
at 20 seconds per asset is ~1,100 person-hours at N = 50,000. That commitment was made for a
45-person summit with three foreign ministries watching, and it is correct at that size. It does not
survive scale, and the alternatives (sampled approval, takedown-based moderation) are exactly the
weaker posture the spec refused. **T4 is the track whose governance model contradicts AILX's growth
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
As implemented, T1 (100), T4 (80) and T3 (45) all resolve through stored judge values: 225 of 400
points, not 45. The principle is sound and worth restoring; it is not currently true.

---
