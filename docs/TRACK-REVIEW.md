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
