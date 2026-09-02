# AILX Positioning — From Calibration Cohort to Industry Default

Status: working memo, August 2026. Sources: competitive research in this session
(certification landscape, gamified-assessment precedents, demand evidence, and
formation histories of CFA / CompTIA / CNCF / ETS).

## The claim

**AILX is the first cross-nationally normed, annually re-versioned, task-performance-based
AI-literacy examination for adults.** Every qualifier is load-bearing (see spec §01).

**What the norm covers at first release.** The exam runs in three languages. The first
population statistic covers two countries, the US and the UK. They are the only
two markets in our framing where a probability panel can be bought (`docs/PANEL-MARKETS.md`).
Japan and Korea need commissioned fieldwork. Japan needs address-based push-to-web.
Korea needs RDD phone recruitment. This would cost roughly double per complete.
It is a funded phase with a price, about $1.1–1.6M on top of the US + UK wave,
based on our estimate. It does not have a date. Say the two-country version in public.
A cross-national adult AI-literacy norm over two countries is still one more than
anybody else has.

"No precedent" — as heard from strategic-intelligence people at frontier labs — is
false as a market claim and true at the measurement layer:

- **Market layer (crowded):** OpenAI Certifications (Sept 2025; goal 10M Americans by
  2030; Walmart, Deere, Lowe's, BCG, Accenture), Google AI Essentials, Microsoft AI-900,
  AWS AI Practitioner, NVIDIA, Salesforce Agentforce, Anthropic Skilljar quizzes,
  Section, DataCamp, Pluralsight. These are MCQ, completion badges, or vendor
  adoption funnels.
- **Measurement layer (empty):** nobody runs a timed, rubric-scored, authentic-task
  exam of human AI fluency, normed across countries, re-cut annually. Academic
  instruments (GLAT, AICOS, SAIL4ALL) use objectively keyed MCQ, not task performance.

Incumbents certify *familiarity*. AILX examines *capability*. They are different categories.

**Which qualifier is the moat.** It is not "performance-based, not multiple choice".
The first draft of OECD's PISA 2029 Media & AI Literacy (MAIL) framework recommends
spending about half of assessment time on "analyse and evaluate" and "create".
The OECD is moving to performance-based assessment of this construct. It has sampling
frames across 80+ countries. The durable differentiators are the other two qualifiers:
**adults** (MAIL tests 15-year-olds) and **annual cadence** (PISA runs a three-year cycle,
first MAIL data 2029). Lead with those. Performance-based describes the instrument.
It does not defend it.

## Why certifications structurally cannot cover the frontier

Certifications test declarative knowledge frozen at authoring time. Frontier practice
is procedural and changes quickly. It includes harness design, eval discipline, keeping
a multi-hour autonomous agent run on the rails, orchestrating agent fleets, and knowing
when to kill rather than steer. The gap between the median user, who uses shallow chat,
and frontier operators running persistent, thousand-agent workloads is now a named
hiring market with no credential:

- MIT "GenAI Divide" (Aug 2025): 95% of enterprise pilots yield zero P&L return
  despite $30–40B spend — explicitly not a model-quality problem.
- NBER/OpenAI: ~700M users, ~80% of usage is shallow writing/info-seeking.
- Forward-deployed-engineer postings up ~800% Jan–Sep 2025; eval-harness discipline
  cited as the differentiator.
- Shopify and Duolingo grade employees on AI use in performance reviews with no
  measurement instrument. EU AI Act Art. 4 has applied to providers and deployers
  since 2 Feb 2025. Regulation (EU) 2026/1744 (Digital Omnibus on AI, 8 July 2026)
  replaced it with a weaker duty to "support the development of" AI literacy that
  "does not require providers or deployers to guarantee any specific level". Neither
  version includes a measure. The Commission's AI literacy Q&A says Art. 4 "does not entail
  an obligation to measure the knowledge of AI of employees". See docs/POLICY-BRIEF.md §2.

AILX addresses this through authentic task scoring, which cramming cannot fake,
and annual re-versioning, which keeps the item bank aligned with frontier practice.

## The examiner seat is empty

Every serious incumbent is vendor-captive. A lab cannot credibly grade fluency on its
own product. Its certification distributes that product, which limits the certification's
value as a measure. Labs benefit from an examiner that sells no model, as rival vendors
benefited from CompTIA, CNCF, and ETS. Anthropic's published "AI Fluency" 4D framework
maps nearly one-to-one onto AILX's four tracks. This is an observation about a public
document. It is not a relationship or an endorsement. OpenAI's certification push
legitimises the category and cannot fill the seat itself.

AILX does not claim to be neutral. The next section says what it claims instead.

## What we can claim today

Someone funds every examiner. Editorial independence does not change who selected
the donors or set the agenda. It also does not prevent the next cheque from being
withheld. A funded body that calls itself neutral hands a critic the easiest line there is.

We claim facts about the method because readers can check them:

- **The practice keys are published.** `instruments/demo-2026.1` includes 20 T2 items with
  their keys and rationales in public by design. It carries no score of record.
- **Every score is recomputable from stored inputs, byte for byte.** `score()` is pure.
  `runPure` (`packages/core/src/purity.ts`) fails the build if it reads a clock,
  a random number or the network. For a score the browser issued, the report recomputes
  each track for the reader (`replayTrackScore`). A score issued by the exam
  service is marked `scoredBy: "server"` and claims no local replay.
- **A judge's output is a stored input.** Re-scoring is reproducible; re-judging is not.
  We state both. No model call runs on the recompute path.
- **Items are content-addressed.** An edit creates a new item. It never mutates one.
- **No score of record has been issued yet.** The judging pipeline is not built. The
  credential asserts a completed sitting and makes no claim about ability.

We cannot yet claim **"independent under published governance"**. We can make that claim
only when all of the following are published and true:

1. A diversified funding pool with a contribution cap per donor.
2. No donor veto over methods, staffing, publication, or timing.
3. An independent board, and a conflict register anyone can read.
4. Preregistered methods.
5. Mandatory publication of negative results.
6. Funding committed before results are known.

None of the six is in place today. Publishing an unmet standard has more value
than claiming an adjective we have not earned.

## OECD is a resource, not a competitor

An earlier draft of this document called PISA 2029 MAIL "the biggest strategic threat".
That was a category error. Correcting it changes who we treat as a rival and who we
treat as a source.

**PISA, PIAAC and ICILS ship reports.** They do not ship a product or service. No
individual sits PISA to receive anything. PISA returns no individual scores, by
design. It has no credential, consumer product, continuous availability, or way
for a person to choose to be measured. OECD produces a national statistic on a
multi-year cycle for ministries. An examination that an adult can take on a Tuesday
and carry the result of is a different product.

OECD cannot take our users because it has none. It has resources we lack and can use:

- **Methodology we should copy rather than reinvent** — probability sampling frames,
  weighting, trend items linked by IRT onto a common metric with an explicit
  linking-error term, and published non-response analysis. Our sampling gap is the most
  dangerous part of our roadmap. PISA and PIAAC have already made and documented the
  mistakes.
- **Construct legitimacy.** OECD-EC *AILit* (finalised 18 June 2026, 4 domains, 19
  competences) and the MAIL draft framework are becoming the reference definition of
  this construct. Alignment helps. Compatibility with the definition
  everyone else uses prevents a young instrument from looking idiosyncratic.
- **People.** Stuart Elliott (OECD, AI capability indicators) and Julian Fraillon
  (IEA/ICILS) are potential advisors, not opponents.

**The residual risks are real but different from competition:**

1. **Definitional capture.** If AILit/MAIL becomes the standard vocabulary and our
   construct is incompatible with it, we will look unserious to the policy audience
   we need. Mitigant: map our four tracks onto the AILit competences explicitly and
   publish the mapping.
2. **The "we already have PISA" objection**, which a ministry will raise. The answer is
   short and accurate. PISA measures 15-year-olds every three years and returns no
   individual result. It cannot tell a government what its *workforce* can do this year.
   It cannot give a person anything to carry.

## Competitive risks — the entities that actually ship something

1. **ETS** — psychometric infrastructure, Futurenav Adapt AI (June 2025), already
   OpenAI's psychometrics partner. Mitigant: ETS was already disrupted by the exact
   playbook AILX runs (Duolingo English Test vs TOEFL: $65, 1 hour, gamified funnel).
   Its item cycle takes years. AILX's must take months.
3. **CodeSignal** — simulation-based AI assessments, 13M+ evaluations, but B2B hiring
   tool with no public credential or norming.
4. **Workera** — enterprise AI-readiness scores (Andrew Ng), quiz-leaning, B2B only.

Several products show that the components work. HackTheBox CPTS sells consumer-priced
hands-on exams at 4.3M-member scale. Duolingo English Test is a cheap normed exam accepted
by every Ivy. Lakera Gandalf has one authentic AI task and 1M+ players. Linux Foundation
CKA shows that performance exams can scale commercially. Immersive Labs / Secure Code Warrior
show that enterprises pay for benchmarked org-level scores. AILX combines established
components. It does not depend on an unproven mechanism.

## Formation playbook (how cross-vendor examiners actually got built)

| Pattern | Example | Time to industry default |
|---|---|---|
| Practitioner guild | CFA (Graham 1945 → ICFA 1959 → first exam 1963) | 15–25 yrs |
| Vendor consortium | CompTIA (1982), **CNCF/CKA (2017)** | 5–7 yrs / **2–3 yrs** |
| Philanthropic spinout | ETS (1947, donated tests + legitimacy) | inherited |

Load-bearing details:

- **CFA:** 284 *already-eminent* analysts sat the 1963 exam. The credential
  borrowed the sitters' reputations, not the reverse.
- **CompTIA:** certified the commodity layer *below* vendor differentiation. IBM
  and Microsoft therefore joined rather than fought. Demand came from the org-level badge
  (Authorized Service Center: 50% certified staff).
- **CNCF/CKA:** rival vendors pay identical dues. Money never buys technical control.
  CKA launched simultaneously with the org badge (KCSP: ≥3 CKAs, 22 firms day one).
  It is the fastest path on record.
- **Warning labels:** CFP/PMI had to retrofit examiner/training separation.
  CompTIA's cert cashflow was eventually sold to private equity.

## Go-big sequence

AILX fits a **CNCF-consortium + CFA-eminent-cohort hybrid**. Follow this order:

1. **Founding cohorts as the "class of 1963."** Seed early sittings with named,
   credible frontier practitioners who run persistent, thousand-agent
   workloads. Their reputations give the instrument legitimacy.
2. **Convene rival labs as equal founding members.** Give them identical dues and board seats.
   Create an exam board whose decisions dues cannot buy. The pitch to each lab is direct.
   Its own certification is a sales funnel. An examiner that none of the labs owns grows
   the whole market.
3. **Org-level "AILX-Assessed Team" badge at launch.** Individual certs follow org
   mandates, not the reverse (KCSP, CompTIA ASC). This is the enterprise product:
   benchmarked org capability scores, sold into the 95%-pilot-failure problem.
4. **One anchor mandate.** Secure one employer requiring AILX in hiring or one
   ministry/procurement pilot. The exam has no value until someone requires it.
   Its value compounds quickly afterward. EU AI Act Art. 4 is a weaker hook than it looks.
   It requires no measurement and carries no EU-level fine. It carries only the national
   penalties Member States set under Art. 99(1) (docs/POLICY-BRIEF.md §2.2, §2.3).
5. **Structural hygiene from day one.** The nonprofit examiner owns the trademark and the
   secure anchor block. Training/prep belongs to a separate entity. That separation is
   one of the governance conditions listed above. Audit-grade score recomputability
   (spec core invariant) already exists. Anyone holding the stored
   inputs can recompute a score and get the same bytes.

Sequence value capture as follows: (1) enterprise performance assessment opens the market,
(2) the frontier/agentic talent signal protects the position, (3) Art. 4 compliance provides
a distribution hook, and (4) the mass consumer credential is the long-term product.

The historical base rate for this path is **3–7 years to industry default**. The
Art. 4 vacuum and the FDE hiring boom are the kind of external demand shocks that
compressed CNCF's timeline to two.

## The research flywheel — and the governance it requires

Quarterly research (see `docs/FUTURE-TRACKS.md`) is the technical and research
moat. Nobody else systematically studies frontier practice and turns
it into a measurable instrument every quarter.

This research needs knowledge from people working at the frontier. That supports advisory
relationships with frontier startups and labs. Both sides receive something concrete.
AILX gets expertise it cannot buy. Advisors gain visibility and credibility by being
named in the methodology behind the instrument that defines AI fluency.

Historical precedent supports this structure. CompTIA was founded by competing vendors.
CNCF has rival companies fund a hands-on exam that none of them controls. Institutions
created ETS by donating their own tests. Competitors cooperate through a body none of
them owns when doing so grows the whole market.

### The risk, stated plainly

The strategic asset is that nobody who sells a model decides what the exam measures.
Every incumbent credential is vendor-captive. The "ETS of AI" seat remains empty
because of it. Advisory participation becomes sponsorship if it means
"advise us and get advertising". At that point, the instrument becomes what it was
built to replace. One visible case in which a vendor's product appears in a challenge
that vendor advised on is enough. No later rule can repair the damage.

### Rules that keep it defensible

Adopt these rules before signing the first advisor:

1. **Test the skill, not the tool.** Challenges must be model- and vendor-agnostic.
   A candidate should be able to score well using any frontier stack. Anything that only
   works with one vendor's product is a defect, not a feature.
2. **Disclosed membership.** Publish who advises and what they contributed. Undisclosed
   influence destroys credibility.
3. **Recusal.** An advisor may not shape, review, or approve any challenge or item where
   their product or company is materially advantaged.
4. **No placement, ever.** Advisors receive credit and credibility, never product
   placement, logo positioning inside challenges, or preferential treatment of their tools.
   If it functions as advertising, it is sponsorship and it needs a firewall.
5. **Separation of powers.** Advisors inform research inputs. The examiner function
   owns the final instrument. State and separate the decision rights, as the
   CNCF model does by preventing money from buying technical control.
6. **Say no publicly.** Rejecting an advisor's suggestion on the record
   makes the other rules credible.

### Why this is worth the discipline

The advisory network creates a reinforcing cycle. Better research produces a better
instrument. A better instrument attracts better advisors. Better advisors improve the
research. This works only while the scores mean something. The rules above do not burden
the cycle. They preserve the value of the score.