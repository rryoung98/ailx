# TEN-80 research spike — is there evidence for scoring the PROCESS of AI-assisted work?

**Scope.** Evidence review only. No code, no doc outside `.research/`, no Linear change except one
comment on TEN-80. Five parallel searches (Exa, OpenAlex, arXiv, Crossref, Semantic Scholar,
Europe PMC, direct fetch via `r.jina.ai`). 73 sources examined; **44 read in full text**, the rest
marked UNVERIFIED below and in the per-question ledgers.

**Full ledgers:** `.research/parts/q1.md` … `q5.md`. This file is the synthesis and carries every
load-bearing number.

---

## VERDICT (5 sentences)

No published study validates a volume-monotone process score of human–AI work against an
independent outcome — the cell is empty, and that emptiness is itself the finding. Where volume has
been measured against a real outcome it is null-to-negative, not positive: `shown` completions
r = 0.01 (n.s.) against a ratio measure ρ = 0.24 in GitHub Copilot telemetry, dialogue turns
r = −0.01 against expert-rated artefact quality, help-seeking volume r = −0.46 with learning gain,
and 54 keystroke/revision features that beat no baseline for essay grade. The two high-stakes
programmes that *do* score process — PISA 2012 problem solving and USMLE Step 3 CCS — both score it
**non-monotonically in volume**, downgrading credit for excess actions, which is the exact opposite
of `processSignal`. The relationship measure the comment on TEN-80 proposes is directionally right
but cannot be labelled reliably: "is this revision Better" reached Fleiss κ = 0.201 across 7
annotators, and the best classifier's top feature was *length difference* — it re-learns the volume
heuristic. `processSignal` is therefore unvalidated in the strong sense (no supporting evidence),
contradicted in the specific sense (its shape is what the literature penalises), and trivially
gameable at N = M = 3 by three distinct throwaway strings and three whitespace revisions.

---

## The measure under test

`packages/tracks/t1-creative-build/src/score.ts`, 25 of 160 points, `resolvedBy: "model-free"`:

```ts
export const PROCESS_FULL_CREDIT_PROMPTS = 3;
export const PROCESS_FULL_CREDIT_CYCLES  = 3;

0.5 * Math.min(1, distinctPrompts / 3) + 0.5 * Math.min(1, cycles / 3)
```

`distinctPrompts` dedupes on trimmed, case-folded prompt text. A `revised` entry closes a cycle only
if a new distinct prompt is open ahead of it in log order. Nothing inspects the artefact diff.

Two facts about the constants that matter for every section below. **N = M = 3 is a low cap**, so the
metric saturates fast and the realistic failure is not "the vibecoder wins by spraying 50 prompts" —
it is that *everyone who does the ritual* reaches the ceiling and the component stops discriminating,
while the one candidate who solves the brief in two precise prompts is docked ~4 of 160 points for
efficiency. **Distinctness is exact string identity**, so the cost of full credit is three different
strings, not three different ideas.

---

## Q1 — Does any published work score the PROCESS of human–AI collaboration and validate it against an outcome?

**Answer: no. Nothing validates a volume-monotone process score. The nearest hits split three ways.**

### Volume entered into a regression on a graded outcome — 2 positives, both confounded

- **Yang, Jiang, Li, Herman, Luo, Chappell Moots & Lovett (2025).** *Analysing nontraditional
  students' ChatGPT interaction, engagement, self-efficacy and performance.* **British Journal of
  Educational Technology** 56(5). doi:10.1111/bjet.13588. FULL TEXT.
  n = 73 chat logs coded for prompt number, Depth of Knowledge, relevance, originality; outcome =
  instructor-graded artefact. R² = 0.17, F(3,69) = 4.70, p < 0.01; **prompt number β = 0.256,
  p = 0.03**. Mean 7.03 prompts (SD 7.04).
  **The caveat that kills it:** prompt number correlates **r = 0.747 with Depth of Knowledge** and
  r = 0.738 with relevance. Volume is a proxy for questioning quality in a setting where nobody was
  paid to prompt more. → **SUPPORTS, heavily qualified.**
- **Choi, Lee, Han & Han (2025).** *Effects of Prompt Elements on Problem-Solving Performance and
  User Experience.* SAGE Open. doi:10.1177/21582440251381680. FULL TEXT. → **SUPPORTS**, same
  confound: unincentivised setting, prompt richness not separated from prompt count.

Neither study tested whether the proxy survives being *scored*. That is the whole question.

### The one study with an expert-rated artefact outcome found nothing

- **Jiang, Chen, Li, Liu & Clarkson (2025).** *AI-Augmented Co-Design in Healthcare: Log-Based
  Markers of Teamwork Behaviors and Collective Intelligence Outcomes.* **Behavioral Sciences**
  15(12), 1704. doi:10.3390/bs15121704. FULL TEXT.
  Six four-person teams. **Number of Dialogue Turns vs expert-rated Technical Performance:
  r = −0.014** (95% CI −0.984 to 0.875). NDT vs perceived performance **r = −0.922**
  (ρ = −0.928). Total duration vs self-rated performance r = −0.750. Verbatim: *"Teams with more
  balanced participation tended to report higher perceived performance, whereas simply having more
  turns did not."*
  Statistically weak (n = 6 teams, enormous CIs, authors report descriptively). It is nonetheless
  the only expert-rated-outcome test of turn volume found, and the answer was zero.
  → **CONTRADICTS.**

### The revision-cycle half has direct disconfirming evidence

- **Oppenlaender, Linder & Silvennoinen (2024/2025).** *Prompting AI Art: An Investigation into the
  Creative Skill of Prompt Engineering.* **International Journal of Human–Computer Interaction.**
  doi:10.1080/10447318.2024.2431761. FULL TEXT.
  Study 3, n = 50 crowdworkers, deterministic Latent Diffusion (fixed seed 1040790415) so pre/post
  image sets are comparable. Participants were **instructed** to improve their own prompts; mean
  Levenshtein distance 28.1 (SD 25.0). Result: **"about half of the sets remained the same, 15% were
  worse, and a third were better."** 7.33% of prompts were not changed at all, six of those being
  pasted random text. Only 1 of 50 used community-standard modifiers in all three prompts despite
  explicit instruction.
  This is the only study located that re-rated artefacts across a revision cycle. A revision improves
  the artefact **a minority of the time**, and a cycles counter pays full credit to the 15% who made
  it worse and to the people who pasted noise. → **CONTRADICTS.**

### Instruments that score process but were never validated

`Li et al. (2025)` human–AI interaction capability assessment (J. Intelligence 13(6) 62) and the
**AI Prompt Writing Rubric** (TOJET 25(2)) both score process. The rubric reports **Fleiss
κ = 0.29** — the only inter-rater figure found for any prompt-process rubric. The Prompt Engineering
Competence Scale (doi:10.1177/02666669251336455) is self-report and not relevant.

### Two secondary findings worth carrying

1. **AI literacy moved to knowledge tests taken before the task, not to scored process.** GLAT (Jin
   et al., arXiv:2411.00283) predicted AI-assisted task performance at **β = 0.220, p = .040**,
   while a self-report ChatGPT-literacy scale did not (β = −0.159, n.s.). This supports AILX being a
   performance exam. It says nothing for `processSignal`.
2. **The two log studies that *did* separate competent from incompetent users did it structurally.**
   Chen & Jia (2026, arXiv:2606.00040, ENA) found the high-literacy signature was *refinement
   commands co-occurring with clarification questions*; Jiang et al. found *participation balance
   and pacing*. Both are model-free and computable from a log. Neither has criterion validity yet.

---

## Q2 — Is interaction VOLUME known to correlate with quality? (the crux)

**Answer: raw counts are null-to-negative in every literature checked. Normalised RATES and
behaviour KINDS carry the signal.**

### Programming with LLMs

- **Ziegler, Kalliamvakou, Simister, Sittampalam, Li, Rice, Rifkin & Aftandilian (2022).**
  *Productivity Assessment of Neural Code Completion.* **MAPS '22**, arXiv:2205.06537. FULL TEXT,
  Appendix B table. n = 1,780–2,047 developers, one dataset:

  | measure | statistic |
  |---|---|
  | `accepted_per_shown` (a **ratio**) | ρ = **0.24**, p < 0.0001 |
  | `shown` (a raw **count**) | r = **0.01**, p = 0.75 |
  | `active_hour` (**time on task**) | r = **−0.05**, p = 0.03 |

  The ratio explains roughly 4× the variance of the matching raw count; the count is
  indistinguishable from zero and time is *negative*. → **CONTRADICTS.** Caveat: the outcome is
  self-reported productivity, not a graded artefact.
- **METR / Becker, Rush, Barnes & Rein (2025).** RCT, 16 experienced OSS developers, 246 real issues
  in their own repos. AI made them **19% slower** while they believed it made them **20% faster** —
  a ~39 pp perception–reality gap. Heavy AI interaction volume tracked *worse* real throughput, and
  the practitioners could not perceive it. → **CONTRADICTS.**
- **Perry, Srivastava, Kumar & Boneh (2023), CCS.** Reports **no relationship between prompt count
  and security** of the resulting code; what predicted secure code was the **kind** of successive
  prompt edit (expand scope / reduce scope / reword / change task). → **QUALIFIES, and points at the
  fix.**
- **Peng, Kalliamvakou, Cihon & Demirer (2023)** and **Vaithilingam, Zhang & Glassman (2022)** both
  invert the naive reading: speed gains do not come with quality gains, and heavier reliance tracks
  worse comprehension of the produced code.

### Intelligent tutoring systems — the deepest and most damning well

- **Aleven, McLaren, Roll & Koedinger (2004).** *Applying Cognitive Modeling to Meta-Cognitive
  Skills.* **ITS 2004.** FULL PDF (cs.cmu.edu/~bmclaren/pubs/AlevenEtAl-HelpSeeking-ITS2004.pdf).
  n = 40 students, ~47,500 actions; **72% of student actions were unproductive help-seeking**.
  Total meta-cognitive bugs **r = −0.61** with learning gain. **Help Abuse (37%, mostly clicking
  through hints — pure volume, no cognition) r = −0.46, p < 0.01.** Try-Step Abuse r = 0.02 n.s.;
  Help *Avoidance* r = −0.10 n.s.
  Note the last two carefully: **less volume is not better either.** The productive/unproductive
  distinction is what carries the −0.61. → **CONTRADICTS.**
- **Baker, Corbett & Koedinger (2004), CHI.** Gaming-the-system students learn about **two-thirds**
  as much, controlling for prior knowledge. → **CONTRADICTS.**
- **Kai, Almeda, Baker, C. Heffernan & N. Heffernan (2018).** ASSISTments, **287,093 student–problem-set
  pairs.** Beck & Gong's purely **count-based** wheel-spinning rule flags **46.9%** of pairs where a
  behaviour-aware definition flags **9.1%** — *a count-only rule over-flags by 5× on the same data.*
  This is the most direct available indictment of count thresholds. → **CONTRADICTS.**

### Writing-process research — a clean null

- **Conijn, Cook, van Zaanen & Van Waes (2022).** *Early prediction of writing quality using
  keystroke logging.* **IJAIED.** doi:10.1007/s40593-021-00268-w. FULL TEXT.
  n = 126, **54 keystroke features including revision counts**, outcome = human grade. **Exactly one
  significant correlation over the full writing process** (long pauses, r = 0.22; max |r| = 0.24).
  **No regression model beat the mean baseline at any timepoint.** Classification peaked at
  **AUC = 0.57** against a 52% baseline.
  This is the closest published analogue to what `processSignal` attempts — an automated, model-free
  process signal validated against human grades — and it did not work. → **CONTRADICTS.**
  Their own review cites prior time-on-task correlations of 0.40–0.52 (Guo 2018; Sinharay 2019,
  UNVERIFIED secondary): the strongest pro-volume evidence found anywhere, about *time* not counts,
  and it failed to replicate here.

### Human–AI dialogue

Huang et al. (CHI '24 LBW, **abstract only**) found conversation length of 0/3/5/7 turns did not
change output quality. Laban, Hayashi, Zhou & Neville (2025, **abstract only**) report a 39% quality
drop in multi-turn versus single-turn LLM interaction. Both flagged UNVERIFIED.

---

## Q3 — Is there evidence for the RELATIONSHIP measure?

**Answer: yes, the relationship beats the count — but "did it improve the artefact" cannot be
labelled reliably enough for a model-free scorer, and the trained version re-learns volume.**

- **Afrin, T. & Litman, D. (2018).** *Annotation and Classification of Sentence-level Revision
  Improvement.* **BEA @ NAACL**, W18-0528, pp. 240–246. https://aclanthology.org/W18-0528.pdf
  FULL TEXT. **The key reliability number.** 940 essay revisions, 7 crowd annotators, asked exactly
  "is the revised sentence Better": **Fleiss κ = 0.201 (slight)**, rising only to **0.263** on 5-of-7
  agreement. Best classifier **F1 = 0.551** against a **0.454** majority baseline.
  **Worse for us:** the classifier's top features included **length difference** (+4.81 weight for
  predicted-Better, −3.99 for NotBetter). A trained quality model partly re-learns the volume
  heuristic we are trying to escape. → **CONTRADICTS a model-free "productive revision" scorer.**
- **Zhang, F. & Litman, D. (2015).** *Annotation and Classification of Argumentative Writing
  Revisions.* **BEA @ NAACL**, W15-0616. https://aclanthology.org/W15-0616.pdf FULL TEXT.
  N = 1,262 revisions. Partial correlation with Draft-2 score (Draft-1 regressed out):
  **meaning-changing revisions r = 0.546, p < 0.001; surface revisions r = 0.137, p = 0.363 n.s.**
  Human coding κ = 0.74–1.00 per category, but the **end-to-end automatic pipeline reaches only
  P 40.25 / R 45.05.**
  **Honest note: raw count was not null there — r = 0.516.** Volume is *dominated* by type, not
  worthless. → **QUALIFIES.**
- **Faigley, L. & Witte, S. (1981).** *Analyzing Revision.* **College Composition and Communication**
  32(4), 400–414. FETCHED via ERIC ED200978. Expert adult writers were the **least frequent
  revisers** (137 changes / 1,000 words) versus advanced students at 236. Only the *composition* of
  revision separated expertise (12% vs 35% text-base changes). → **CONTRADICTS a monotone score
  directly: on this data, the expert scores lower.**
- **Bosu, A., Greiler, M. & Bird, C. (2015).** *Characteristics of Useful Code Reviews: An Empirical
  Study at Microsoft.* **MSR 2015.** FULL PDF. A review comment that **triggered a code change within
  one line of the highlighted lines** predicted human-judged usefulness at **88% precision / 78%
  recall**; the human oracle reached **Fleiss κ = 0.947** — because they asked the *receiving
  developer*, not a third party. Also: more files in a change → **lower** proportion of useful
  comments. → **SUPPORTS an outcome-LINKED, model-free coupling signal (not a quality judgement).**
- **Forsgren, Storey, Maddila, Zimmermann, Houck & Butler (2021).** *The SPACE of Developer
  Productivity.* **ACM Queue** 19(1). Explicit norm: activity metrics alone *"should never be used in
  isolation either to reward or to penalize developers."* → **CONTRADICTS.**
- **Afrin & Litman (2023), Findings of EACL**, pp. 2550–2561: with **expert** coders plus context
  plus feedback, κ rises to 0.72–0.83, and gold desirable-revision counts correlate r = 0.20–0.45
  with improvement while **undesirable revisions are n.s.** The relationship measure works — under
  conditions AILX cannot meet in a pure scorer.

**The one evidence-backed, model-free move** is a *coupling link*, not a quality judgement: "the
prompt was followed by a change to the artefact within a bounded window", deterministic from the
diff. That is Bosu's change-trigger. It is **not** "the prompt improved the artefact".

---

## Q4 — What does the assessment literature say about scoring process at all?

**Answer: "collect but do not score" is REFUTED as a universal rule — and what replaces it is worse
for us. Where process IS scored operationally, extra actions LOSE points.**

- **OECD (2014).** *PISA 2012 Results Volume V: Creative Problem Solving.* ISBN 978-92-64-20807-0.
  FULL PDF. Verbatim: *"information contained in log files about the sequence of actions performed by
  students was used to inform scoring of items where appropriate. For example, when it could be
  established that students had guessed an answer, they received no credit."* MP3 PLAYER Item 2:
  *"If the number of clicks used (**no more than 13**) indicates that students have been efficient…
  they receive full credit; but if they reach the goal in a less-efficient manner (**more than 13
  clicks**), they only receive partial credit."* Field trial ≈ 39% full, ≈ 33% partial.
  → **CONTRADICTS.** Process is scored, and the sign on volume is **negative**.
- **USMLE / NBME**, Computer-based Case Simulations, official scoring page. FULL PAGE. Operational in
  Step 3 since November 1999. *"Indicated patient management actions are awarded credit while actions
  that are not indicated and pose greater potential risk to a patient decrease your score"*;
  *"If you order something that is unnecessary and excessive, your score will decrease"*; *"you will
  be scored lower if you take an aggressive approach when restraint and observation are the standard
  of care."* Weights are codified **per case** by expert physicians.
  → **CONTRADICTS.** The other operational precedent, same negative sign on volume.
- **NCES / NAEP**, official technical documentation. TWO PAGES FETCHED. Score scales are estimated by
  IRT **from item responses**; the 2017 process-data logs are a **separate research release** for
  secondary analysis. → For NAEP, "collect but do not score" **holds**.
- **Naumann, J. (2019).** *The Skilled, the Knowledgeable, and the Motivated.* **Frontiers in
  Psychology** 10:1429. FULL TEXT. PISA 2009 digital-reading log files, **N = 32,669, 19 countries**:
  comprehension skill × time on task **b = +0.26** (SE .01, CI [.23,.28]) on **hard** tasks but
  **b = −0.08** (SE .01, CI [−.10,−.07]) on **easy** tasks; strategy knowledge +0.07 vs −0.02. Reading
  *enjoyment* — a motivational, construct-irrelevant variable — also drives it.
  → **CONTRADICTS.** Volume indicators are **not monotone in skill**, and the sign depends on task
  difficulty, which our single global formula cannot condition on.
- **Goldhammer, Hahnel, Kroehne & Zehner (2021).** *Preconditions for the utilization of process
  data.* **Large-scale Assessments in Education** 9:20, open access. FULL TEXT. A simple time/count
  indicator *"does not include much information; it is not self-explanatory"* — the highest
  interpretative-ambiguity class in their taxonomy. → **QUALIFIES / CONTRADICTS.**
- **Koretz, Stecher, Klein & McCaffrey (1994).** Vermont portfolio assessment, ERIC ED365699. FULL
  TEXT. Inter-rater **r = .28–.57, κ = 0.17**; the state declined to publish its own statistics. The
  nearest documented failure analogue — but it is **product-side**, not process-side, so do not
  overclaim it.

**Every operational process-scoring rule found also has per-task expert-derived weights, a large
zero-weight region, and a negative region. `processSignal` has one global formula, no zero region and
no negative region.**

ETS work (Ercikan, Guo & He 2020, **abstract only**) proposes detecting *differential response
processes* by analogy with DIF. Putting process in the score imports subgroup differences, and we
have no item-level DIF screen to catch them.

**Negative result, stated plainly:** no published study validates a volume-monotone process
indicator against an external criterion of work quality, and **no documented case exists of a
programme scoring process by volume and having to withdraw it.** PISA 2015+ log-file scoring position
was not pinned down and remains open.

---

## Q5 — The counter-evidence, sought deliberately

**The strongest objection is not gaming. It is that monotonicity itself is empirically false.**

- **Goldhammer, Naumann, Stelter, Tóth, Rölke & Klieme (2014).** *The time on task effect in reading
  and problem solving is moderated by task difficulty and skill.* **Journal of Educational
  Psychology** 106(3), 608–626. doi:10.1037/a0034716. N = 1,020, PIAAC German field test.
  The time-on-task effect **reverses sign by task type**: positive in problem solving and rising with
  difficulty; **negative in reading**, *"the more negative, the easier a task was"*, and **more
  negative as skill increased**. Their conclusion: time on task **"has no uniform interpretation."**
  Our formula hard-codes one sign for every candidate and every brief. → **CONTRADICTS.**
  [Partially verified: abstract plus body excerpts; the pedocs OA PDF would not download. Crossref and
  Semantic Scholar confirm the record, 286 citations.]
- **Baker, Corbett, Koedinger & Wagner (2004).** *Off-Task Behavior in the Cognitive Tutor Classroom:
  When Students "Game the System".* **CHI 2004**, 383–390. FULL PDF.
  Gaming is **defined** as "systematic and rapid" actions, several within a 20-second window —
  i.e. *high-volume interaction with the help system*. **r = −0.38** with post-test
  (F(1,68) = 11.82, p < 0.01); **partial r = −0.34** controlling pre-test and general achievement. No
  other off-task category was significant (talking −0.19 n.s., inactivity −0.08 n.s.). Prior
  knowledge itself is only r = 0.32.
  **`processSignal` is a gaming-frequency counter with the sign flipped.** → **CONTRADICTS.**
- **Shavelson, Baxter & Gao (1993).** *Sampling Variability of Performance Assessments.* CRESST
  ED359229 / **Journal of Educational Measurement** 30(3), 215–232. FULL 30-PAGE TEXT.
  **Person × task interaction = 82% / 49% / 48%** of total variance (Science / Math / CAP) and
  **60% / 55%** for Navy / Marine job performance. In the p × r × t × o study, p×t×o = 59%, p×t = 32%,
  **rater components ≈ 0**. **G = .04 with one task, one rater, one occasion**; about **15 tasks** are
  needed for G = .80. *"Task sampling variability appears to be fact, not artifact."*
  **T1 is one task.** → **CONTRADICTS.**
- **Koretz & Barron (1998), RAND MR-1014.** A *performance* assessment chosen specifically to resist
  coaching still inflated: 4th-grade reading gains had no echo in NAEP; math NAEP gains ≈ ¼ of the
  KIRIS gains; science ACT gains ≈ ⅕. → **CONTRADICTS.**
- **Gao, Schulman & Hilton (2022), arXiv:2210.10760.** Reward-model overoptimisation — the mechanism
  by which a proxy that correlates with quality stops doing so once it is optimised against. Directly
  relevant: Yang et al.'s r = 0.747 confound is exactly a proxy that has never been optimised against.
- **Liang, Yuksekgonul, Mao, Wu & Zou (2023), Patterns 4(7) / arXiv:2304.02819.** FULL PDF. Seven GPT
  detectors misclassified **non-native TOEFL essays at 61.22% average FPR**, near-zero for native
  essays, driven by low perplexity — a surface-text proxy penalising a narrow lexicon. **Mechanism
  only**; see the honest gap below.
- **Wise & Kong (2005), AME 18(2).** FULL PDF. Response-time effort detects non-engagement
  (ω² = .26 on performance, ω² = .00 on SAT-V) and is used to **filter**, not to award points. This is
  the model for a defensible use of process data.
- **Saito, Wachi, Wataoka & Akimoto (2023), arXiv:2310.10076.** Verbosity bias in LLM judging —
  longer outputs win on preference irrespective of quality. One line, adjacent, but it is the same
  failure shape.

### Two honest negatives that must not be papered over

1. **NO published study links non-native English proficiency to prompt count or prompt length with an
   AI assistant.** Searched across Exa, OpenAlex, arXiv, Crossref and Semantic Scholar. The language
   worry is plausible *by mechanism* (Liang et al.) and our exact-string `distinctPrompts` dedup is a
   surface-text proxy of exactly that kind — but it is **unevidenced as applied to us.** Do not ship
   it as a finding. It is a cheap DIF study we could run on our own logs first.
2. **The PISA computer-familiarity story is weaker than assumed.** Akyol (2021, Boğaziçi J. 35(2),
   FULL TEXT) finds a large causal mode effect on the 2015 switch (Turkey: −28.85 math, −29.52
   science, −39.975 reading, diff-in-diff) but explicitly reports **no heterogeneity by computer
   possession**. Reusens et al. (2025, Findings IJCNLP-AACL, abstract only) found generative tasks
   *"largely robust to nativeness bias"*, which cuts against us.

### The anchor anecdote and the policy — both verified, neither is evidence

- **HN item 47724105** is a real comment by user *Aurornis*, 2026-04-10, retrieved via the Algolia
  API. It independently names two of our mechanisms — tool-familiarity bias and "inverted signals"
  from "high token spend". It is an **anonymous anecdote of unknown n and must never be cited as
  support.**
- **Anthropic, "Guidance on Candidates' AI Usage"** (updated 2025-07-10), verified. Claude is
  forbidden in take-home assessments and live interviews (*"This is all you"*), permitted only for
  prep and polish. A **policy, not evidence** — but an existence proof that a sophisticated party
  declined to score AI-interaction behaviour.

### How our formula is gamed, concretely

At N = M = 3, full credit costs three distinct strings and three artefact changes:

| attack | effort | result |
|---|---|---|
| paraphrase-split one real instruction into three | seconds | `distinctPrompts` = 3 |
| ask three throwaway questions never used in the artefact | seconds | `distinctPrompts` = 3 |
| make three trivial whitespace/format revisions after each prompt | seconds | `cycles` = 3 |
| append a space to the same prompt three times | seconds | dedup key differs → counts 3× |
| **one expert prompt that fully solves the brief, zero revisions** | high skill | **signal = 1/6 → ~4 of 25 points** |

The last row is the inverted signal, in our own scorer, quantified.

---

## Mapping: our measure to the nearest published measure

| our term | nearest published measure | what the literature found | class |
|---|---|---|---|
| `distinctPrompts` count | `shown` completions, Ziegler et al. 2022 | r = 0.01, p = 0.75 (null) vs ratio ρ = 0.24 | CONTRADICTS |
| `distinctPrompts` count | prompt number, Yang et al. 2025 | β = 0.256, p = .03 — but r = 0.747 with prompt quality | SUPPORTS, confounded |
| `distinctPrompts` count | dialogue turns, Jiang et al. 2025 | r = −0.014 vs expert-rated quality | CONTRADICTS |
| `distinctPrompts` count | help-seeking action volume, Aleven et al. 2004 | Help Abuse r = −0.46 with learning gain | CONTRADICTS |
| `distinctPrompts` count | "gaming the system", Baker et al. 2004 | rapid high-volume actions, r = −0.38 post-test | CONTRADICTS |
| `cycles` count | revision count, Faigley & Witte 1981 | experts revise **least** (137 vs 236 /1000 words) | CONTRADICTS |
| `cycles` count | revision count, Zhang & Litman 2015 | r = 0.516 raw, **dominated** by type r = 0.546 vs 0.137 | QUALIFIES |
| `cycles` count | keystroke revision features, Conijn et al. 2022 | 54 features, no model beat baseline, AUC 0.57 | CONTRADICTS |
| `cycles` count | prompt-then-regenerate, Oppenlaender et al. 2024 | ⅓ better, ½ same, **15% worse** | CONTRADICTS |
| monotone-in-volume shape | click count, PISA 2012 MP3 Item 2 | **>13 clicks → partial credit** (negative sign) | CONTRADICTS |
| monotone-in-volume shape | action list, USMLE Step 3 CCS | "unnecessary and excessive → your score will decrease" | CONTRADICTS |
| monotone-in-volume shape | time on task, Goldhammer et al. 2014 | sign **reverses** by task type and skill | CONTRADICTS |
| capped at N=M=3 | count-based wheel-spinning threshold, Kai et al. 2018 | count-only rule over-flags **5×** vs behaviour-aware | CONTRADICTS |
| a proposed "improved the artefact" term | revision-improvement label, Afrin & Litman 2018 | **Fleiss κ = 0.201**; top feature = length difference | CONTRADICTS |
| a proposed "prompt caused a change" term | change-trigger, Bosu et al. 2015 | 88% precision / 78% recall for usefulness | **SUPPORTS** |
| 25/160 weight on one task | performance-assessment G-study, Shavelson et al. 1993 | person×task 48–82%; G = .04 at one task | CONTRADICTS |
| any scored process term | response-time effort, Wise & Kong 2005 | used to **filter**, not to award points | QUALIFIES |

---

## What we still cannot claim

1. **We cannot claim `processSignal` measures competence.** Nothing validates a volume-monotone
   process score against an outcome. Not "weak evidence" — **no evidence.**
2. **We cannot claim the literature proves our signal is negatively valid.** Every CONTRADICTS entry
   is an analogue: tutoring systems, code completion, essay keystrokes, image prompts. None ran our
   formula on our task. The shape is condemned; the specific instrument is untested.
3. **We cannot claim the HN anecdote as evidence.** Verified as a real comment, unknown n, anonymous.
4. **We cannot claim a language or tool-familiarity bias in prompt count.** Unevidenced. Plausible by
   mechanism only, and one adjacent finding (Reusens et al.) cuts against it.
5. **We cannot claim a model-free scorer can identify a "productive" prompt.** κ = 0.201 for humans
   on the nearest task; the trained classifier leans on length.
6. **We cannot claim "collect but do not score" is the universal assessment norm.** It is NAEP's and
   PIAAC's. PISA 2012 and USMLE Step 3 score process — non-monotonically, with per-task expert
   weights and negative regions.
7. **We cannot claim raw volume is worthless.** Zhang & Litman got r = 0.516 from raw revision count,
   and Yang et al. got a significant positive β. In *unincentivised* settings volume is a real proxy
   for engagement. The failure mode is what happens when it is scored.
8. **We cannot claim our cap solves the problem.** N = M = 3 bounds the *upside*; it does not make the
   measure a competence measure, and it makes the component non-discriminating for anyone who does
   the ritual while still docking the efficient candidate.

---

## RECOMMENDATION — three options, priced by evidence

### (a) Stop scoring it; keep it as diagnostic telemetry. **Best supported.**

Redistribute the 25 points to the judged dimensions, keep computing `processSignal` and show it on
the report as an uninterpreted observation.

**Evidence already in hand:** the entire Q1–Q5 body. Two operational precedents that score process do
so with the opposite sign (PISA 2012, USMLE). NAEP and PIAAC collect and do not score. Wise & Kong's
response-time effort is the template — process data used to **filter/flag**, never to award points.
The strongest single number is Conijn et al.: the closest published analogue to what we built, 54
features, and it beat no baseline.

**Evidence this option still needs:** essentially none to justify *removing* the claim. It needs a
decision about where the 25 points go — moving them to judged dimensions changes T1's weighting and
therefore every T1 digest, so it is a scored-behaviour change with a snapshot regeneration.

### (b) Keep it, bounded, reported as unvalidated.

Leave the formula, cap the weight far below 25/160, and label it on the report as an unvalidated
process observation.

**Evidence in hand:** thin but non-zero. Yang et al. (β = 0.256) and Choi et al. give a positive
association between prompt volume and graded outcome in unincentivised settings; Zhang & Litman's raw
revision count reached r = 0.516. That is the whole case, and both are confounded with quality.

**Evidence it still needs, and it is expensive:** (1) a within-AILX study showing the score is
associated with judged artefact quality **at fixed candidate**; (2) the volume-invariance test TEN-80
already demands — two transcripts, same outcome, very different spend, scores equal within tolerance
— which **this formula will fail by construction**; (3) a DIF screen on prompt count by first
language and prior tool familiarity (nobody has published it; we would be first and it is cheap);
(4) an answer to Shavelson: person×task variance of 48–82% means a single-task process score has
G ≈ .04, so the bound would have to be very low to be honest. Note that (2) is unsatisfiable without
changing the formula, which collapses (b) into (a) or (c).

### (c) Replace it with a relationship measure.

Score the **coupling**, not the quality: a prompt counts only if the artefact changed within a
bounded window in a way traceable to it.

**Evidence in hand:** Bosu, Greiler & Bird (2015) is the one genuinely supporting citation in this
review — change-trigger predicts human-judged usefulness at 88% precision / 78% recall, with an
oracle at κ = 0.947. Perry et al. (2023) found the *kind* of prompt edit predicted secure code while
prompt count did not. Zhang & Litman: type dominates count (0.546 vs 0.137).

**Evidence it still needs — and one hard constraint.** Afrin & Litman put the ceiling at
**κ = 0.201** for "is this better", so the measure must stop at *"the prompt was followed by a change
to the artefact"* (deterministic from the diff, stays pure, stays model-free) and must **not** attempt
*"the prompt improved the artefact"*. The moment it judges improvement it needs a model on the score
path, which collides with the AGENTS.md recompute invariant unless the judgment is persisted and
content-addressed like T3/T4. It also still needs its own validation: no published work operationalises
a "productive prompt" for an AI assistant with any reliability statistic, so (c) would be a novel
measure and must ship unvalidated or not at all. Bosu's own data adds a warning: **more files changed
→ lower proportion of useful comments**, so even the coupling measure is not monotone-safe.

### The honest bottom line

For the specific thing we shipped — a capped, volume-monotone count of prompts and cycles worth 25 of
160 points — the answer is **no evidence in favour, and a consistent body of analogous evidence
against the shape**. That points at **(a)**. Option (c) is the only one with a supporting citation,
but it is a research project, not a fix, and it should be built as diagnostic first and scored only
after it survives the volume-invariance test TEN-80 asks for.

---

## Unverified sources (abstract, snippet or metadata only — not read in full)

Q1: Heilman et al. 2026 (arXiv:2606.00438); PECS (doi:10.1177/02666669251336455); AICOS
(arXiv:2503.12921v2); AAEE 2025 full-paper_182; Shrivastava 2026 (highlights only). MAILS itself was
never read — ScienceDirect blocked the fetch, and no MAILS numbers are cited here.
Q2: Laban et al. 2025; Huang et al. CHI '24 LBW; Beck & Gong 2013 (Springer-blocked — its 38% and
10-opportunity figures are **secondary**, quoted from Kai et al.'s fetched text); Guo 2018 and
Sinharay 2019 (secondary, via Conijn et al.). GitClear is a gated industry teaser, not peer-reviewed,
and is not load-bearing anywhere in this document.
Q3: Sommers 1980 (metadata only); Kashefi et al. ArgRewrite V.2 (abstract only); Fitzgerald 1987
(abstract only).
Q4: Bergner & von Davier 2019 (JEBS 44(6):706–732); Greiff, Wüstenberg & Avvisati 2015 (Comp&Educ
91:92–105); Perelman 2014; Clauser et al. 1997; Ercikan, Guo & He 2020; Wise, Bhola & Yang 2006;
Ercikan & Pellegrino 2017 (TOC only).
Q5: Goldhammer et al. 2014 (abstract + body extract, PDF would not download); Goldhammer et al. 2021
(abstract only in the Q5 pass — fetched in full in the Q4 pass); Reusens et al. 2025; Koretz 2008;
"Judging the Judges" arXiv:2604.23178.

Also not pinned down: **PISA's log-file scoring position from 2015 onward.** Left as an open question
rather than assumed to match 2012.
