# ADVISORS.md — who to ask, what to ask for, and what it costs

TEN-21. Written 2026-09-02. Nobody on this team can defend the numbers. Five people cover policy,
business and health, and none of them is a psychometrician or a survey methodologist. A named
advisor answers "who checks your psychometrics?" before a reviewer asks it.

This file has four parts: the verified list (§2), the ranking by what each person buys (§3), the
ask and its price per tier (§4), and one short draft per person (§5).

## 1. How to use this file, and what it is not

**Every affiliation below was fetched from a live page or a public API on 2026-09-02.** The
candidate list in TEN-21 was an input, not a roster, and checking it moved two names:

- **Tom Bramley is not at Cambridge University Press and Assessment.** He is Executive Director,
  Research and Analysis at **Ofqual**, since 2024. That is the exams regulator for England, which
  changes what he can accept from us. See §2.6.
- **Dragan Gasevic is not at Monash.** He is Chair Professor of Learning Analytics and AI in the
  Faculty of Education at the **University of Hong Kong**, since 2026-05-29. See §2.5.

One stated reason did not survive checking either. TEN-21 names Stefan Feuerriegel for
"intervention decay". His group ran the two-week follow-up that produced the null we care about,
but he has no paper whose subject is the decay of intervention effects. The person whose subject
that is is Jon Roozenbeek (§2.12). Cite the finding, not a specialism he does not claim.

**Nothing here has been sent.** No figure in §4 has been quoted to anyone. No email address in this
file was constructed from a pattern. Where an address appears, it was printed on the page cited
next to it. Where no address is given, none was published and none should be guessed.

**Verification marks.** VERIFIED means a page or API record was read today and is cited. UNCERTAIN
means the source is self-maintained or dated. COULD NOT VERIFY means the site blocked the fetch.
The research pass had no working web search (no Serper key) and used institutional pages, ORCID,
OpenAlex, Crossref and GOV.UK instead. Bot-blocked, and therefore unread: `gre.ac.uk`,
`monash.edu`, `cambridge.org`, `www.oecd.org` HTML.

## 2. The verified list

### 2.1 Stefan Feuerriegel, LMU Munich

- **Role: VERIFIED.** Full Professor and Head of the Institute of AI in Management, LMU Munich
  School of Management. https://www.som.lmu.de/ai/en/institute/contact-page/stefan-feuerriegel-840c1071.html
  (HTTP 200, 2026-09-02). ORCID 0000-0001-7856-8729; 116 OpenAlex works since 2024-01-01, latest
  2026-08-31, all under LMU.
- **Work that matches: VERIFIED.** Geissler, Robertson and Feuerriegel, "Designing Effective Digital
  Literacy Interventions for Boosting Deepfake Discernment", CHI 2026, doi:10.1145/3772318.3790428.
  N = 1,200 US participants, five interventions against control, 200 per condition, two-week
  follow-up.
- **The stated reason is off. UNCERTAIN to wrong.** No paper of his is about decay. His
  misinformation corpus is diffusion and mechanism work. The two-week arm of the CHI paper is the
  decay evidence, and it is one arm of one paper.
- **Contact:** institute inbox `ai@som.lmu.de`, printed on the page above. No personal address is
  published.
- **Why he is first.** His result is the sharpest thing anyone has said against our practice loop.
  Gamified scored 65.7% (p_adj = .310) and feedback 60.0% (p_adj = 1.000) against a control of
  61.3%. At two weeks no arm beat control. Foray practice is gamified drilling with immediate
  feedback, assembled from the two arms that failed. `docs/TRANSFER-STUDY.md` §1 says so in those
  words.

### 2.2 Katie Gray, University of Reading

- **Role: VERIFIED.** Associate Professor and Deputy Head of School (Business Development), School
  of Psychology and Clinical Language Sciences. https://www.reading.ac.uk/pcls/staff/katie-gray
  (HTTP 200, 2026-09-02).
- **Work that matches: VERIFIED.** Gray, Davis, Bunce, Noyes and Ritchie, "Training human
  super-recognizers' detection and discrimination of AI-generated faces", *R. Soc. Open Sci.*
  12(11):250921 (2025), doi:10.1098/rsos.250921. Crossref lists her Reading affiliation.
- **Contact: VERIFIED.** `k.l.h.gray@reading.ac.uk`, printed on the staff page.
- **Caveat worth saying out loud.** Her wider portfolio is face processing, autism and
  prosopagnosia. The deepfake-training strand is largely this one paper. Do not write to her as if
  detection training is her field.
- **Why she matters.** Foray modelled its artefact families on her five-minute training. In her data,
  trained typical-ability adults reached 51% accuracy at d' = -0.066, not different from chance
  (t69 = 1.092, p = .279). Training moved the criterion, not sensitivity.

### 2.3 Josh P. Davis, University of Greenwich

- **Role: UNCERTAIN.** Professor in Applied Psychology, University of Greenwich, from 2008-09-01
  with no end date, per his own ORCID record 0000-0003-0017-7159 (fetched 2026-09-02). His
  Greenwich staff page returns HTTP 403 to every automated fetch, so the role rests on ORCID plus
  the November 2025 publisher affiliation string, not on an institutional page. **Open
  `https://www.gre.ac.uk/people/rep/las/josh-p-davis` in a normal browser before writing.**
- **Work that matches: VERIFIED.** "The Super-Recogniser Advantage Extends to the Detection of
  Digitally Manipulated Faces", *Applied Cognitive Psychology* (2025), doi:10.1002/acp.70053. Also
  co-author on the Gray 2025 RSOS paper.
- **Contact: COULD NOT VERIFY.** No address seen on any readable page. Corresponding-author route
  through the RSOS paper works.
- **Watch out:** OpenAlex merges him with an unrelated Josh P. Davis who publishes antitrust
  reports.

### 2.4 Matt Groh, Northwestern Kellogg

- **Role: VERIFIED.** Assistant Professor of Management and Organizations, Kellogg, with a courtesy
  appointment in Computer Science at McCormick.
  https://www.kellogg.northwestern.edu/academics-research/faculty/groh_matthew/ (HTTP 200,
  2026-09-02).
- **Work that matches: VERIFIED.** "Human detection of political speech deepfakes across
  transcripts, audio, and video", *Nature Communications* (2024), doi:10.1038/s41467-024-51998-z.
  Also Ramon, Vowels and Groh, "Deepfake Detection in Super-Recognizers and Police Officers", *IEEE
  Security and Privacy* (2024), doi:10.1109/MSEC.2024.3371030.
- **The one positive training result in the file.** A 2026 preprint, "Generative AI Literacy
  Training Improves Intelligence Analysts' Discrimination of Real and AI-Generated Images"
  (arXiv:2606.28510). If training can move discrimination, he has the closest thing to a
  demonstration, and he is therefore the person most able to tell us whether our transfer design
  would detect it.
- **Contact: VERIFIED.** `matthew.groh@kellogg.northwestern.edu`, a mailto link on the Kellogg page.

### 2.5 Dragan Gasevic, University of Hong Kong (moved)

- **Role: VERIFIED, and TEN-21 is two years out of date.** Professor and Chair of Learning
  Analytics and Artificial Intelligence, Faculty of Education, University of Hong Kong.
  https://web.edu.hku.hk/faculty-academics/dgasevic (HTTP 200, 2026-09-02). ORCID
  0000-0001-9265-1908 employments: HKU from 2026-05-29, Monash 2019-07-01 to 2026-05-28.
- **Residual Monash role: COULD NOT VERIFY.** OpenAlex still prints Monash on his 2026 papers.
  `monash.edu` returns HTTP 403 to fetches. Treat "still at Monash" as unknown; treat HKU as
  primary and do not write to a Monash address.
- **Work that matches: VERIFIED.** Jin, Martinez-Maldonado, Gasevic and Yan, "GLAT: The generative
  AI literacy assessment test", *Computers and Education: Artificial Intelligence* (2025),
  doi:10.1016/j.caeai.2025.100436. A 20-item GenAI-literacy instrument with CTT and 2PL IRT, alpha
  0.80, omega 0.81, RMSEA 0.03, CFI 0.97. That is an AI-literacy instrument with a published
  validity argument, which is the thing Foray does not have.
- **Contact:** faculty office `edfac@hku.hk` and a JS-obfuscated personal mailto on the staff page,
  which a human browser will show.

### 2.6 Tom Bramley, Ofqual (moved, and the move changes the ask)

- **Role: VERIFIED.** Executive Director, Research and Analysis, Ofqual, since 2024.
  https://www.gov.uk/government/people/tom-bramley and
  https://www.gov.uk/government/organisations/ofqual/about/our-governance. ORCID 0000-0001-6407-4373
  lists Ofqual 2024 to present and Cambridge University Press and Assessment 2017 to 2024.
- **Work that matches: VERIFIED.** Bramley, "Investigating the reliability of Adaptive Comparative
  Judgment" (2015), doi:10.17863/cam.110782, the simulation our T1 decision rests on. Also Bramley
  and Vitello, "The effect of adaptivity on the reliability coefficient in adaptive comparative
  judgement", *Assessment in Education* 25(3) (2018), doi:10.1080/0969594X.2017.1418734.
- **Contact: COULD NOT VERIFY.** No personal address is published. The only public routes are
  Ofqual's enquiry forms at https://www.gov.uk/guidance/contact-ofqual. Do not guess an Ofqual
  address.
- **He is now a regulator, so the ask has to shrink.** A serving exams regulator cannot take a paid
  seat on the governance page of a body that wants to issue credentials. Ask for an opinion on the
  published document, expect a slow or absent reply, and do not treat silence as a verdict.

### 2.7 Alina von Davier, Duolingo

- **Role: VERIFIED, with a title correction.** Chief of Assessment, Duolingo, per
  https://englishtest.duolingo.com/research/our_team (JS page, read with a headless browser
  2026-09-02). TEN-21 says "chief assessment scientist", which is close and not her title.
- **Other roles: UNCERTAIN.** Wikipedia gives EdAstra Tech, Oxford and CMU affiliations. No primary
  page confirming them was reachable. Do not repeat them in an email.
- **Work that matches: VERIFIED.** Hao, von Davier, Yaneva, Lottridge, von Davier and Harris,
  "Transforming Assessment: The Impacts and Implications of Large Language Models and Generative
  AI", *Educational Measurement: Issues and Practice* (2024), doi:10.1111/emip.12602.
- **Contact: COULD NOT VERIFY.** Neither Duolingo research page publishes personal emails. Routes
  are the DET research site and LinkedIn.
- **Why she is the closest analogue.** The Duolingo English Test is a consumer-shaped product whose
  score institutions accept. That is exactly the split `docs/TRACK-REVIEW.md` §1 says Foray has not
  resolved.

### 2.8 Geoff LaFlair, Duolingo

- **Role: VERIFIED.** Principal Language Measurement Scientist, Duolingo, same team page. ORCID
  0000-0003-0306-6550 shows Duolingo since 2019-01.
- **Work that matches: VERIFIED.** Runge, Attali, LaFlair, Park and Church, "A generative AI-driven
  interactive listening assessment task", *Frontiers in Artificial Intelligence* 7 (2024),
  doi:10.3389/frai.2024.1474019. Also the *Duolingo English Test: Technical Manual* (2026), linked
  from https://englishtest.duolingo.com/research.
- **Contact: COULD NOT VERIFY.** No published personal address. The only Duolingo address seen on a
  live page is a co-author's corresponding address on the Frontiers article.
- **He is the practical half of §2.7.** Item security under a public practice loop, and short-form
  design, are operational problems he has shipped answers to.

### 2.9 Stuart Elliott, OECD

- **Role: UNCERTAIN, and this is the weakest entry in the file.** Senior analyst at the OECD leading
  the AI and the Future of Skills project, per a live 2023 event page
  (https://oecd-events.org/ai-wips-2023/speaker/c293270d-7fc9-ed11-9f73-000d3a46905b/stuart-elliott)
  and a February 2024 OECD slide deck that names him Project Leader
  (oecd.org/content/dam/.../AI%20Roundtable.pdf). **No 2025 or 2026 page confirming he is still
  there was reachable**; `www.oecd.org` HTML is Cloudflare-blocked to fetches.
- **Work that matches: partly VERIFIED.** *AI and the Future of Skills, Volume 2* (OECD, 2023),
  doi:10.1787/e0f758b7-en, and "Building an assessment of artificial intelligence capabilities"
  (OECD, 2021), doi:10.1787/01421d08-en. The 2025 OECD AI Capability Indicators
  (doi:10.1787/be745f04-en) carry no personal authors in Crossref, so **his authorship of the
  indicators could not be verified.**
- **Contact: COULD NOT VERIFY.** No address seen. The OECD pattern is firstname.lastname@oecd.org.
  That is a pattern, not an observed address, and it is not a licence to send.
- **Before writing to him, confirm he is still at the OECD from a normal browser.**

### 2.10 Julian Fraillon, IEA

- **Role: VERIFIED, with a title correction.** Senior Project Advisor, IEA, per
  https://www.iea.nl/about/org/staff (HTTP 200, 2026-09-02). Springer author bios call him
  International Study Director of ICILS 2013, 2018 and 2023; that title is snippet-level evidence
  only. The shift from study director to advisor may mean his ICILS 2023 cycle role is winding
  down.
- **Work that matches: VERIFIED.** Fraillon (ed.), *An International Perspective on Digital
  Literacy: Results from ICILS 2023* (Springer, 2025), doi:10.1007/978-3-031-87722-3, including the
  chapter on principals' reports of generative AI use, doi:10.1007/978-3-031-87722-3_9. Also the
  *ICILS 2023 Assessment Framework* (Springer, 2024), doi:10.1007/978-3-031-61194-0.
- **Contact: VERIFIED.** `j.fraillon@iea.nl`, printed on the IEA staff page. Secretariat:
  `secretariat@iea.nl`.

### 2.11 John Jerrim, UCL

- **Role: VERIFIED.** Professor of Education and Social Statistics, UCL Social Research Institute.
  https://profiles.ucl.ac.uk/48137-john-jerrim (rendered 2026-09-02). The numeric ID matters:
  `profiles.ucl.ac.uk/32261-john-jerrim` is a different person.
- **Work that matches: VERIFIED.** "Exclusion rates from international large-scale assessments: an
  analysis of 20 years of IEA data", *Educational Assessment, Evaluation and Accountability* (2023),
  doi:10.1007/s11092-023-09416-3. Also "Data Collection During a Pandemic. How Did COVID-19 Impact
  the Sample Composition in PIRLS 2021?" (2025), doi:10.1007/978-3-031-88002-5_8.
- **Contact: VERIFIED.** `j.jerrim@ucl.ac.uk` on the UCL profile. His personal site johnjerrim.com
  is stale: the CV is dated December 2015 and the contact page still gives an `ioe.ac.uk` address.
- **He is the person who writes the paper about your exclusion rates.** Better to hand him
  `docs/SAMPLING.md` than to be found by him.

### 2.12 People the issue missed

Same evidence standard. Each was checked on a live page or public API on 2026-09-02.

**Jon Roozenbeek, University of Cambridge and VU Amsterdam.** Director, Influence and Technology
Lab. https://www.psychol.cam.ac.uk/staff/jon-roozenbeek (HTTP 200). Email `jjr51@cam.ac.uk`,
printed on that page. Maertens, Roozenbeek and others, "Psychological booster shots targeting memory
increase long-term resistance against misinformation", *Nature Communications* (2025),
doi:10.1038/s41467-025-57205-x. This is the decay paper TEN-21 wanted when it wrote Feuerriegel's
name. He studies how intervention effects fade and what arrests the fade, which is the annual
re-sitting question in a different literature.

**Sven De Maeyer, University of Antwerp.** Full professor and Dean, Faculty of Social Sciences.
https://www.uantwerpen.be/en/staff/sven-demaeyer/ (email hidden behind a "Show email address"
control, phone +32 3 265 4932). Verhavert, Bouwer, Donche and De Maeyer, "A meta-analysis on the
reliability of comparative judgement", *Assessment in Education* (2019),
doi:10.1080/0969594X.2019.1602027. Our r = 30 comparisons per artefact comes from his 26 to 37 band
(`docs/COMPARATIVE-JUDGEMENT.md` §2). He is reachable and unconflicted, which Bramley is not.

**Ian Jones, Loughborough University.** Head of Department and Professor of Mathematics Education;
co-founder of the Comparative Judgement Research Consortium and scientific advisor to No More
Marking. https://www.lboro.ac.uk/departments/mec/staff/ian-jones/. Kinnear, Jones and Davies,
"Comparative judgement as a research tool: a meta-analysis of application and reliability",
*Behavior Research Methods* 57:222 (2025), doi:10.3758/s13428-025-02744-w. Contact route is a
"Send email" link with the address obfuscated, plus +44 (0)1509 228 217. He has an existing
commercial relationship with a CJ vendor, which is worth knowing before an advisory conversation.

**Jose Hernandez-Orallo, University of Cambridge (moved).** Director of Research, Leverhulme Centre
for the Future of Intelligence, and Research Professor at Cambridge; Professor on partial leave at
Universitat Politecnica de Valencia. https://josephorallo.webs.upv.es/ lists both emails,
`jh2135@cam.ac.uk` and `jorallo@upv.es`. "Evaluating General-Purpose AI with Psychometrics",
*Communications of the ACM* (2026), doi:10.1145/3769688. He does capability measurement from the
machine side. Foray measures humans working with machines, and the two arguments meet at whether a
capability scale means anything.

**Ronny Scherer, University of Oslo.** Professor and Director, Centre for Educational Measurement.
https://www.uv.uio.no/cemo/english/people/aca/ronnysc/, email `ronny.scherer@cemo.uio.no`, phone
+47 22 85 05 51. Siddiq and Scherer, "Is there a gender gap? A meta-analysis of the gender
differences in students' ICT literacy", *Educational Research Review* (2019),
doi:10.1016/j.edurev.2019.03.007. He is a measurement invariance person working on digital
competence, which is the DIF-across-languages-and-devices problem in `docs/SAMPLING.md`.

**Meike Ramon, Bern University of Applied Sciences (moved).** Professor of Applied Data Science
from 2025-03-01, per ORCID 0000-0001-5753-5493; earlier work carries Fribourg and Lausanne. Her BFH
profile page could not be read, so the role is self-reported. First author with Groh on the police
deepfake-detection study. She runs an operational assessment tool for super-recogniser selection,
so she has priced the thing Foray wants to price. No email seen, none invented.

**Sophie Nightingale, Lancaster University.** Senior Lecturer in Psychology.
https://www.lancaster.ac.uk/people-profiles/sophie-nightingale. Nightingale and Farid,
"AI-synthesized faces are indistinguishable from real faces and more trustworthy", *PNAS* (2022),
doi:10.1073/pnas.2120481119. Her 2025 and 2026 output has moved toward synthetic image abuse, so
detection is no longer her main line. Lower priority than the four above.

**Mojca Rozman, IEA Hamburg.** Listed under the International Studies Unit on the IEA staff page
with email `mojca.rozman@iea-hamburg.de`. Co-author of the ICILS 2023 Assessment Framework. Her
exact title is not on that page. Useful as the scaling contact if Fraillon is winding down.

### 2.13 What could not be verified, in one place

| Claim | Status |
|---|---|
| Josh Davis's current role from an institutional page | COULD NOT VERIFY, `gre.ac.uk` blocks bots. ORCID only. |
| Stuart Elliott still at the OECD in 2025 or 2026 | COULD NOT VERIFY, oecd.org blocked. Latest evidence is a Feb 2024 deck. |
| Elliott's authorship of the 2025 OECD AI Capability Indicators | COULD NOT VERIFY, no personal authors in Crossref. |
| Whether Gasevic keeps a Monash role | COULD NOT VERIFY, monash.edu blocks bots. |
| Von Davier's Oxford, CMU and EdAstra roles | UNCERTAIN, Wikipedia only. |
| Fraillon's ICILS "study director" title | UNCERTAIN, publisher snippet only. |
| Bramley's output after 2020 | UNCERTAIN, his later work is in Cambridge *Research Matters*, which OpenAlex does not index and cambridge.org would not serve. |
| Email addresses for Davis, Bramley, von Davier, LaFlair, Elliott, Ramon | Not published anywhere reachable. Do not guess. |

## 3. Ranking, by what each person buys

Different people buy different things, and they cost different amounts of goodwill. This ranking is
by what we get, not by seniority.

| # | Person | What they buy | Cost to us |
|---|---|---|---|
| 1 | Feuerriegel | An answer on whether `docs/TRANSFER-STUDY.md` §2 could catch the null his data predicts. If he says the design is sound, the practice loop has a defence. If he says it is not, we learn it before a wave, not after. | One email. No money. |
| 2 | Jerrim | A methods review of `docs/SAMPLING.md` before wave 1, from the person most likely to publish a critique of it otherwise. Also the strongest single route to UK panel-methods people. | One email, then $1 to 3k for a written review. |
| 3 | Gasevic | A named seat that answers "who checks your psychometrics?", from someone who has published a validated AI-literacy instrument. He is the best fit in the file for the governance page. | $5 to 15k a year. |
| 4 | Bramley | An opinion on the one reliability decision we have already made in writing: non-adaptive pairing, permanently, because of his 2015 simulation. | One email. He is a regulator now, so no seat and no fee. Expect no reply. |
| 5 | Gray | Confirmation or refutation that our held-out generator design tests what her between-subjects study could not. She is the origin of our artefact families, so her verdict lands on T2 directly. | One email. Possibly co-authorship on the transfer study. |
| 6 | von Davier | The fun-versus-serious argument, from the only operating example of a consumer-shaped assessment institutions accept. A named seat here would be the strongest single credibility signal available. | One conversation. A seat is unlikely and worth asking for anyway. |
| 7 | De Maeyer | A methods review of the CJ design, from the author of the meta-analysis our r = 30 comes from. Unconflicted, contactable, and cheaper than Bramley in goodwill. | $1 to 3k for a review. |
| 8 | Fraillon | Sampling credibility by association with ICILS, plus a real answer on whether our two rates can sit beside ICILS rather than compete with it. | One email. A seat later. |
| 9 | Groh | A read on whether training can move discrimination at all, from the only positive result in this literature. He is also the natural co-author on the first technical report. | One email. Co-authorship. |
| 10 | Roozenbeek | The durability question. Our whole annual re-sitting story is a decay claim nobody has tested past two weeks. | One email. |
| 11 | Scherer | Measurement invariance across languages and devices, which wave 1 needs and nobody here can do. | $1 to 3k review, or a seat later. |
| 12 | LaFlair | Item security under a public practice loop, and short-form design. Operational, not governance. | One conversation. |
| 13 | Davis | The aptitude question: how much of T2 is a stable perceptual trait rather than a learnable skill. | One email. |
| 14 | Hernandez-Orallo | The capability-scale argument, and a reviewer who will attack the construct rather than the statistics. | One email. |
| 15 | Elliott | The "we already have PISA" answer and the OECD orbit. Ranked last because his current role is unverified, not because the seat is unimportant. | Verify first, then one email. |

**Sequencing.** Send 1, 4 and 5 first, in the same week. They are unpaid opinions on documents that
already exist, and each of the three can only reply with something we want: agreement we can quote,
or a problem we would rather find now. Send 2 next, because a sampling review gates wave 1. Nothing
paid is offered before at least one of those four has replied, and no seat is offered before the
panel money is real. `strategy/PIPELINE.md` §3.1 sets that order and this file does not jump it.

**A refusal on grounds of time is noise.** A refusal that says the construct is not defensible, or
that T2 cannot carry the claim made of it, is the finding. Write it down. Do not shop the question
around until somebody agrees.

## 4. The ask, per tier, and what it costs

Every figure here comes from `strategy/PIPELINE.md` §3.4 in the private strategy repo, which argues
them from `strategy/FUNDING.md` and `docs/SAMPLING.md` §13.2. **They are planning figures. None is a
measurement, none is an offer, and none has been quoted to anyone.**

| Tier | What we ask for | Planning figure | Who it fits |
|---|---|---|---|
| 0 | One opinion on one disconfirming finding. One reply, by email. | $0 | Feuerriegel, Gray, Davis, Groh, Bramley, Roozenbeek, Hernandez-Orallo, Fraillon |
| 1 | A two-hour written review of one document, paid, one-off. | $1 to 3k | Jerrim (sampling), De Maeyer (CJ), Scherer (invariance) |
| 2 | A named seat on the governance page, paid, disclosed, with the right to resign publicly. | $5 to 15k per year, per seat | Gasevic, von Davier, Fraillon, Scherer |
| 3 | Named co-author on the first technical report. | Authorship, not money | Groh, Gray, Gasevic |
| 4 | An introduction to a probability-panel operator. | $0 to us, real goodwill to them | Jerrim, Fraillon, Elliott |
| 5 | Contracted work, after the panel is funded. | External psychometric review $30 to 60k per wave; sampling and weighting contractor $80 to 150k per wave | Nobody yet |

Read the tiers as an order, not a menu. Tier 0 comes first for everyone, including the people we
would most like in tier 2. Someone who will not spend twenty minutes on one finding will not defend
a number in public.

**Three rules that are not negotiable.**

- **No equity for advisory work.** `strategy/FUNDING.md` requires a nonprofit examiner that owns the
  trademark and the anchor block. An advisor holding equity in the examiner is a conflict on the
  exact axis the governance terms exist to protect.
- **A seat comes with the right to resign publicly and say why.** A named advisor who cannot quit
  loudly is decoration, and reviewers know the difference.
- **Serving regulators get tier 0 and nothing else.** That is Bramley now. Offering a fee to the
  Executive Director of Research at Ofqual is the kind of mistake that closes a door permanently.

Against a first cheque of $100k to $500k the whole advisory board is a low single-digit share of the
raise. The contractor lines in tier 5 are not. That is the honest reason contractors wait for the
money and advisors do not.

## 5. The drafts

One per person. Every one is under 200 words. Every one names one specific thing in Foray that this
person is placed to attack, and asks for exactly one thing.

**The rule behind all of them.** Approach with the disconfirming evidence in hand. Being the people
who found the problem is far stronger than being the people caught by it. So each draft leads with
the finding that hurts us, not with what we have built.

Fill in the bracketed link before sending. Send from a person, not a role account. No attachments.

### 5.1 Stefan Feuerriegel

> Subject: your two-week null, and a design meant to catch it
>
> Professor Feuerriegel,
>
> Geissler, Robertson and Feuerriegel (CHI 2026) is the strongest argument against the product I am
> building, so I would rather ask you about it than wait to be told.
>
> Foray is an AI literacy examination. Its practice loop is gamified drilling with immediate
> feedback, which is the two arms in your study that did not beat control: 65.7% at p_adj = .310 and
> 60.0% at p_adj = 1.000, against 61.3%. At two weeks no arm beat control. We have stopped claiming
> a training effect and written a study that could catch a null instead of hiding one: three arms,
> held-out generators, d-prime and criterion reported apart, follow-ups at 14 and 56 days. It is
> public at [link], section 2.
>
> One question. Would that design detect the effect if it exists, or is 56 days still too short to
> say anything about an annual re-sitting?
>
> A one-paragraph reply is all I am asking for.
>
> [name]

### 5.2 Katie Gray

> Subject: your d-prime of -0.066, and what we built on top of it
>
> Dr Gray,
>
> We modelled the artefact families in our AI-image discrimination task on your five-minute
> training. Then we read the result properly: trained typical-ability adults at 51% accuracy,
> d-prime = -0.066, t(69) = 1.092, p = .279. Training moved the criterion, not sensitivity. Our
> product was claiming an improvement your data does not support, and we have cut that claim.
>
> What we want to test now is whether discrimination transfers to generators nobody practised on. We
> split image sources into three disjoint sets: practised, held out, and the scored bank. The
> primary outcome is the change in d-prime on the held-out set alone, with the practised set
> reported beside it as a manipulation check. Design at [link], section 2.
>
> One question: does the held-out split answer the question your between-subjects design could not,
> or is it still measuring criterion movement wearing a different name?
>
> [name]

### 5.3 Josh P. Davis

> Subject: is our discrimination score measuring an aptitude
>
> Professor Davis,
>
> Your 2025 result that the super-recogniser advantage extends to digitally manipulated faces is a
> problem for us, and I would like your read on it.
>
> Foray scores adults on telling AI-generated images from camera-captured ones, and reports that
> score as literacy. If a meaningful share of the variance is a stable perceptual aptitude, then
> part of what we publish is a trait measure with a skill label on it. Diel and colleagues' 2024
> meta-analysis (k = 137, N = 86,155) puts pooled sensitivity at chance, which suggests the
> individual differences are doing more work than the training.
>
> One question: is there a defensible way to report the aptitude component separately, or does the
> honest version stop calling this track a literacy measure at all?
>
> I am happy to be told the second thing. It is cheaper to hear now.
>
> [name]

### 5.4 Matt Groh

> Subject: the one positive training result, and whether our test would find it
>
> Professor Groh,
>
> Almost everything we read says human deepfake discrimination does not train. Gray et al. (2025)
> got d-prime = -0.066 in trained adults. Diel et al. (2024) pooled to chance. Your 2026 preprint on
> intelligence analysts is the clearest counter-example I have found.
>
> Foray runs a practice loop and an exam on the same task. We are designing a transfer study rather
> than asserting an effect: held-out generators, d-prime and criterion reported apart, an active
> control that gets the same time as plain instruction, follow-ups at 14 and 56 days. Design at
> [link], section 2.
>
> One question: what separated your analysts from the null results, and would our design pick that
> difference up?
>
> If the answer is interesting, I would rather have you on the resulting paper than cite it at you.
>
> [name]

### 5.5 Dragan Gasevic

> Subject: our composite weights have no validity evidence, and GLAT does
>
> Professor Gasevic,
>
> Congratulations on the move to HKU. Writing about GLAT, which is the only AI-literacy instrument I
> have found with a published validity argument: 2PL IRT, alpha 0.80, omega 0.81, RMSEA 0.03, CFI
> 0.97.
>
> Foray has none of that. It weights four tracks at .40, .40 and .20 with no factor structure behind
> the weights, and its main reasoning track carries 160 points on a construct with no external
> validity evidence and no published reliability figure. We have written that down in public rather
> than waiting to be asked: [link].
>
> Two asks, in order. First, an opinion on one thing: whether a composite built from tracks that
> have not been shown to load on a common factor should be published at all. Second, if that
> conversation goes anywhere, a paid named seat reviewing the measurement claims before wave 1, on
> the condition that you can resign in public and say why.
>
> [name]

### 5.6 Tom Bramley

> Subject: we made your SSR call in writing, and I would like to know if it was right
>
> Dr Bramley,
>
> Your 2015 simulation set true reliability to zero and adaptive pairing still returned SSR up to
> 0.89, while non-adaptive pairing on the same random data stayed below 0.25.
>
> We used that to make a decision and wrote it down so a later efficiency argument has to overturn
> it rather than fill a gap. Our comparative judgement pairing stays non-adaptive, permanently. The
> headline reliability number is a split-panel correlation between two independently fitted
> Bradley-Terry halves, with Spearman-Brown stated beside the uncorrected half-panel value. SSR is
> reported only because the design is non-adaptive. Written up at [link], section 4.
>
> One question: at 30 comparisons per artefact, each half-panel fit sees 15. Is a split-panel
> correlation at that precision worth reporting, or does it need the doubled comparison budget to
> mean anything?
>
> I know your role at Ofqual limits what you can say about a third party's instrument. An opinion on
> the statistic alone would be enough.
>
> [name]

### 5.7 Alina von Davier

> Subject: the fun-versus-serious split, from someone stuck in it
>
> Dr von Davier,
>
> The Duolingo English Test is the only example I know of a consumer-shaped assessment whose score
> institutions accept. I am building something with the same tension and losing it.
>
> Foray wants to be a game people choose to play and a statistic a ministry would cite. Our own track
> review says those two goals pull apart, and the evidence is unkind to the game half: the one
> controlled study of gamified deepfake training found the gamified arm indistinguishable from
> control (p_adj = .310), and no arm survived two weeks. Meanwhile the panel short form that could
> produce a population statistic drops two of four tracks and is 53 minutes long, so it measures two
> rates and cannot honestly be called AI literacy.
>
> One question: at DET, what actually kept the score defensible while the product stayed consumer
> shaped? I am looking for the thing that had to be given up, not the success story.
>
> Twenty minutes on a call, or a paragraph by email.
>
> [name]

### 5.8 Geoff LaFlair

> Subject: item security with a public practice loop
>
> Dr LaFlair,
>
> A practical question from someone with your problem and none of your experience.
>
> Foray has a public practice mode and a scored sitting on the same task family. The practice corpus
> is published on purpose. The scored bank is private and rotated. Hausknecht and colleagues put
> retest and practice effects at d = 0.26, larger with identical forms plus coaching, so keeping the
> two disjoint is load bearing and we have no evidence it is enough.
>
> We are also designing a 53-minute matrix-sampled short form for a probability panel: a frozen
> anchor block, four rotated operational blocks, sixteen forms. Documented at [link].
>
> One question: how does DET decide when a practice surface has burned an operational item, and is
> that decision a statistic or a judgement?
>
> Happy to send the short-form design first if it is easier to react to something concrete.
>
> [name]

### 5.9 Stuart Elliott

> Subject: the measure the AI capability indicators do not cover
>
> Dr Elliott,
>
> The OECD AI Capability Indicators measure what AI systems can do. Foray is trying to measure
> something adjacent and unmeasured: whether adults keep their judgement while using those systems.
> EU AI Act Article 4 mandates AI literacy and attaches no measure to it, and every current index I
> can find is self-report.
>
> The honest version of our claim is narrow. Our panel form measures two rates, not a construct: how
> often adults tell 2026-vintage synthetic media from camera-captured media, and how often they
> catch planted errors in an assistant's output. We refuse to average the two, because the weights
> that would justify it do not exist. That is written down at [link].
>
> One question: is that pair of rates something a ministry could use, or does an indicator have to
> be a single number before anyone acts on it?
>
> The second answer would be useful to hear early.
>
> [name]

### 5.10 Julian Fraillon

> Subject: can two rates sit beside ICILS without pretending to be it
>
> Mr Fraillon,
>
> ICILS 2023 is the benchmark I keep measuring our work against and finding it short.
>
> Foray is building an AI literacy measure for adults. The gap we are trying to fill is narrow: ICILS
> covers grade 8 students in participating systems, and the adult population statistic for AI-era
> judgement does not exist. But our panel form is 53 minutes, it drops two of four tracks, and it
> can support two rates and no composite. Beside a full ICILS cycle that is a small claim, and I
> would rather say so than let it be read as more. Our sampling design and its limits are public at
> [link].
>
> One question: does a two-rate adult measure of this size have any standing next to a full
> assessment cycle, or does publishing it alongside ICILS damage both?
>
> If it has standing, I would like to ask you about a named seat later. Not in this email.
>
> [name]

### 5.11 John Jerrim

> Subject: our exclusion and non-response plan, before you find it
>
> Professor Jerrim,
>
> Your paper on 20 years of IEA exclusion rates is the review I expect our first wave to get, so
> here is the design before the data exists.
>
> Foray plans a bought probability panel of 1,500 to 2,000 realised completes in the US and UK, kept
> behind a schema-level firewall from a self-selected web cohort so the two can never be averaged.
> We publish a non-response bias analysis unprompted, and we hedge the convenience-sample findings
> in fixed language. The whole thing is public at [link], including the parts that do not work: no
> IRT model yet, so wave 1 reports design-based weighted rates with replicate standard errors and no
> plausible values.
>
> Two asks. First, an opinion on one thing: whether a 53-minute short form linked to a full sitting
> by an anchor block can carry a published linking error at this sample size. Second, if that is
> worth your time, a paid two-hour review of the sampling document before we approach a vendor.
>
> [name]

### 5.12 Sven De Maeyer

> Subject: r = 30 comes from your meta-analysis, and I want to know if we used it right
>
> Professor De Maeyer,
>
> Verhavert et al. (2019) puts reliability .90 at 26 to 37 comparisons per representation. Our exam
> had r = 24, below that band, and we moved it to 30 on the strength of your paper.
>
> Two things about our design that may not fit your evidence. The raters are the candidates
> themselves, not experts, with self-exclusion and blinded randomised pairs. And pairing stays
> non-adaptive permanently, because of Bramley's 2015 result, so we report a split-panel correlation
> as the headline and each half sees only 15 comparisons per artefact. Working at [link].
>
> One question: does the 26 to 37 band hold when raters are novices judging peers, or does peer
> rating need a different comparison count?
>
> If this is worth more than an email, we would pay for a written review of the design.
>
> [name]

### 5.13 Jon Roozenbeek

> Subject: our whole product is a decay claim nobody has tested
>
> Dr Roozenbeek,
>
> Your booster-shot paper is the only work I have found that treats fade as the main event rather
> than a limitation paragraph.
>
> Foray is an annual AI literacy sitting with a practice loop between sittings. That business model
> is a durability claim, and the evidence for it is nothing. The nearest study (Geissler, Robertson
> and Feuerriegel, CHI 2026) found no arm beating control at two weeks. Our own transfer design
> stops at 56 days, which we picked because nobody in this literature has gone further, not because
> it is defensible.
>
> One question: from the inoculation work, is there a spacing schedule that would make an annual
> re-sitting plausible, or does the decay curve say the interval has to be months rather than a
> year?
>
> If the answer is months, the product is wrong and I would like to know that now.
>
> [name]

### 5.14 Jose Hernandez-Orallo

> Subject: measuring the human half of a human-plus-model system
>
> Professor Hernandez-Orallo,
>
> Your work argues that AI capability needs measurement theory rather than benchmark scores. Foray is
> the mirror problem: measuring a person whose performance depends on a model that changes
> quarterly.
>
> The exposed part is comparability. Our items age with the models, so a 2027 score and a 2026 score
> are not on the same scale unless a frozen anchor block carries the link, and that anchor gets
> easier every year by doing nothing. Our reasoning track also carries 160 points on a reliance
> construct with no external validity evidence, and the closest published test-retest of advice
> taking reports ICC below 0.5.
>
> One question: does a capability scale mean anything when the instrument and the environment move
> together, or is the honest unit of measurement always a specific model at a specific date?
>
> A short answer would change what we publish.
>
> [name]

## 6. Where the evidence in the drafts comes from

Every number quoted in §5 traces to a document, not to memory.

- **Practice does not obviously work.** `docs/TRANSFER-STUDY.md` §1 and §2, on branch `w/ten-36`.
  Geissler, Robertson and Feuerriegel (CHI 2026); Gray et al. (*R. Soc. Open Sci.* 12(11):250921);
  Diel et al. (2024) meta-analysis, k = 137, N = 86,155.
- **The reliance construct has no external validity evidence.** `Foray-Spec-2026.1.md` T3, and
  `docs/TRANSFER-STUDY.md` §3. The test-retest problem is in the private repo's
  `docs/EVIDENCE-RELIABILITY-AND-TIME-PRESSURE.md`: Karvelis et al. (*PLoS ONE* 19(11):e0312255,
  2024) report ICC below 0.5 for advice taking over 153 trials.
- **SSR is not safe under adaptive pairing.** `docs/COMPARATIVE-JUDGEMENT.md` §4, on branch
  `w/ten-10`. Bramley (2015); Verhavert et al. (2019) for the 26 to 37 comparison band.
- **LLM judges do not agree with humans well enough to carry a score alone.** Private repo,
  `docs/EVIDENCE-JUDGE-AGREEMENT.md`: judge-human correlations in a .47 to .56 band, judge severity
  SD 8 to 15 times that of trained raters.
- **The short form measures two rates, not AI literacy.** `docs/SHORT-FORM.md` §2.3, on branch
  `w/ten-24`.
- **Sampling, weighting, non-response and the hedging language.** `docs/SAMPLING.md` §2, §4, §9,
  §10, §11, §13.
- **The game-versus-statistic tension.** `docs/TRACK-REVIEW.md` §1 and §0.

**Three of those documents are not on `main` yet.** `TRANSFER-STUDY.md`, `COMPARATIVE-JUDGEMENT.md`
and `SHORT-FORM.md` live on `w/ten-36`, `w/ten-10` and `w/ten-24`. **Do not send a draft whose
[link] points at a page that does not exist.** Merge first, or send the section as text.

Nothing in §5 cites the private repo by name, and nothing quotes operational item content. An
advisor who wants the evidence base gets it under an agreement, not in a cold email.

## 7. What this file does not decide

- **Who signs the emails.** These are drafts. The founder sends them, and a sent email is a
  different thing from a written one.
- **Whether a governance page exists yet.** Tier 2 offers a named seat on a page nobody has built.
  Build it before offering the seat, or the offer is a promise about the future.
- **Which of the fifteen we can afford.** At $5 to 15k per seat, three seats is $15 to 45k a year
  against a first cheque of $100k to $500k. Three is probably the ceiling and this file does not
  pick them.
- **What happens on refusal.** `strategy/PIPELINE.md` §3.1 says a refusal on the construct is the
  finding. It does not say who has to be told, and that should be written down before the first
  email goes out.
