# AILX Positioning — From Calibration Cohort to Industry Default

Status: working memo, August 2026. Sources: competitive research in this session
(certification landscape, gamified-assessment precedents, demand evidence, and
formation histories of CFA / CompTIA / CNCF / ETS).

## The claim

**AILX is the first cross-nationally normed, annually re-versioned, task-performance-based
AI-literacy examination for adults.** Every qualifier is load-bearing (see spec §01).

"No precedent" — as heard from strategic-intelligence people at frontier labs — is
false as a market claim and true at the measurement layer:

- **Market layer (crowded):** OpenAI Certifications (Sept 2025; goal 10M Americans by
  2030; Walmart, Deere, Lowe's, BCG, Accenture), Google AI Essentials, Microsoft AI-900,
  AWS AI Practitioner, NVIDIA, Salesforce Agentforce, Anthropic Skilljar quizzes,
  Section, DataCamp, Pluralsight. All of it is MCQ, completion badges, or a vendor
  adoption funnel.
- **Measurement layer (empty):** nobody runs a timed, rubric-scored, authentic-task
  exam of human AI fluency, normed across countries, re-cut annually. Academic
  instruments (GLAT, AICOS, SAIL4ALL) are objectively keyed MCQ, not task performance.

Incumbents certify *familiarity*. AILX examines *capability*. Different category.

**Which qualifier is the moat.** Not "performance-based, not multiple choice". The first
draft of OECD's PISA 2029 Media & AI Literacy (MAIL) framework recommends that about half
of assessment time go to "analyse and evaluate" and "create" — the OECD is going
performance-based on this construct, with 80+ countries of sampling frame behind it. The
durable differentiators are the other two qualifiers: **adults** (MAIL tests 15-year-olds)
and **annual cadence** (PISA runs a three-year cycle, first MAIL data 2029). Lead with
those. Performance-based is a description of the instrument, not a defence of it.

## Why certifications structurally cannot cover the frontier

Certifications test declarative knowledge frozen at authoring time. Frontier practice
is procedural and moving: harness design, eval discipline, keeping a multi-hour
autonomous agent run on the rails, orchestrating agent fleets, knowing when to kill
versus steer. The gap between the median user (shallow chat) and frontier operators
(persistent, thousand-agent workloads) is now a named hiring market with no credential:

- MIT "GenAI Divide" (Aug 2025): 95% of enterprise pilots yield zero P&L return
  despite $30–40B spend — explicitly not a model-quality problem.
- NBER/OpenAI: ~700M users, ~80% of usage is shallow writing/info-seeking.
- Forward-deployed-engineer postings up ~800% Jan–Sep 2025; eval-harness discipline
  cited as the differentiator.
- Shopify and Duolingo grade employees on AI use in performance reviews with no
  measurement instrument. EU AI Act Art. 4 has applied to providers and deployers
  since 2 Feb 2025, and Regulation (EU) 2026/1744 (Digital Omnibus on AI, 8 July 2026)
  replaced it with a weaker duty to "support the development of" AI literacy that
  "does not require providers or deployers to guarantee any specific level". No measure
  is attached either way: the Commission's AI literacy Q&A says Art. 4 "does not entail
  an obligation to measure the knowledge of AI of employees". See docs/POLICY-BRIEF.md §2.

AILX answers this by construction: authentic task scoring (unfakeable by cramming)
and annual re-versioning (the item bank chases the frontier).

## The neutral-third-party seat is empty

Every serious incumbent is vendor-captive. A lab cannot credibly grade fluency on its
own product — its certification is a distribution play, which caps its value as a
measure. Labs therefore benefit from a neutral, non-sales examiner the same way rival
vendors benefited from CompTIA, CNCF, and ETS. Anthropic's "AI Fluency" 4D framework
maps nearly one-to-one onto AILX's four tracks: a natural endorser, not a competitor.
OpenAI's certification push *legitimizes the category* while creating the exact
neutrality vacuum it cannot fill itself.

## OECD is a resource, not a competitor

An earlier draft of this document called PISA 2029 MAIL "the biggest strategic threat".
That was a category error, and it is worth stating plainly because it changes who we
treat as a rival and who we treat as a source.

**PISA, PIAAC and ICILS ship reports.** They do not ship a product or a service. No
individual sits PISA to receive anything: PISA returns no individual scores at all, by
design. There is no credential, no consumer surface, no continuous availability, and no
mechanism by which a person can choose to be measured. OECD produces a national
statistic on a multi-year cycle for ministries. That is a different object from an
examination an adult can sit on a Tuesday and carry the result of.

So OECD cannot take our users, because it has none. What it has is precisely what we
lack, and can borrow:

- **Methodology we should copy rather than reinvent** — probability sampling frames,
  weighting, trend items linked by IRT onto a common metric with an explicit
  linking-error term, and published non-response analysis. Our sampling gap is the most
  dangerous thing on our roadmap; PISA and PIAAC have already made and documented the
  mistakes.
- **Construct legitimacy.** OECD-EC *AILit* (finalised 18 June 2026, 4 domains, 19
  competences) and the MAIL draft framework are becoming the reference definition of
  this construct. Alignment is an asset. Being legibly compatible with the definition
  everyone else uses is how a young instrument avoids looking idiosyncratic.
- **People.** Stuart Elliott (OECD, AI capability indicators) and Julian Fraillon
  (IEA/ICILS) are advisors to court, not opponents to out-manoeuvre.

**The residual risks are real but different from competition:**

1. **Definitional capture.** If AILit/MAIL becomes the standard vocabulary and our
   construct is incompatible with it, we look non-serious to exactly the policy audience
   we need. Mitigant: map our four tracks onto the AILit competences explicitly and
   publish the mapping.
2. **The "we already have PISA" objection**, which a ministry will raise. The answer is
   short and true: PISA measures 15-year-olds every three years and returns no
   individual result. It cannot tell a government what its *workforce* can do this year,
   and it cannot give a person anything to carry.

## Competitive risks — the entities that actually ship something

1. **ETS** — psychometric infrastructure, Futurenav Adapt AI (June 2025), already
   OpenAI's psychometrics partner. Mitigant: ETS was already disrupted by the exact
   playbook AILX runs (Duolingo English Test vs TOEFL: $65, 1 hour, gamified funnel);
   its metabolism is years-per-item-cycle, AILX's must be months.
3. **CodeSignal** — simulation-based AI assessments, 13M+ evaluations, but B2B hiring
   tool with no public credential or norming.
4. **Workera** — enterprise AI-readiness scores (Andrew Ng), quiz-leaning, B2B only.

Proof the components work: HackTheBox CPTS (consumer-priced hands-on exams at 4.3M-member
scale), Duolingo English Test (cheap normed exam accepted by every Ivy), Lakera Gandalf
(one authentic AI task, 1M+ players), Linux Foundation CKA (performance exams scale
commercially), Immersive Labs / Secure Code Warrior (enterprises pay for benchmarked
org-level scores). AILX is an assembly play, not a physics bet.

## Formation playbook (how neutral examiners actually got built)

| Pattern | Example | Time to industry default |
|---|---|---|
| Practitioner guild | CFA (Graham 1945 → ICFA 1959 → first exam 1963) | 15–25 yrs |
| Vendor consortium | CompTIA (1982), **CNCF/CKA (2017)** | 5–7 yrs / **2–3 yrs** |
| Philanthropic spinout | ETS (1947, donated tests + legitimacy) | inherited |

Load-bearing details:

- **CFA:** the 1963 exam was sat by 284 *already-eminent* analysts — the credential
  borrowed its sitters' reputations, not the reverse.
- **CompTIA:** certified the commodity layer *below* vendor differentiation, so IBM
  and Microsoft joined rather than fought; demand came from the org-level badge
  (Authorized Service Center: 50% certified staff).
- **CNCF/CKA:** rival vendors pay identical dues; money never buys technical control;
  CKA launched simultaneously with the org badge (KCSP: ≥3 CKAs, 22 firms day one).
  Fastest path on record.
- **Warning labels:** CFP/PMI had to painfully retrofit examiner/training separation;
  CompTIA's cert cashflow was eventually sold to private equity.

## Go-big sequence

AILX's fit is a **CNCF-consortium + CFA-eminent-cohort hybrid**. In order:

1. **Founding cohorts as the "class of 1963."** Seed early sittings with named,
   credible frontier practitioners (the people running persistent, thousand-agent
   workloads). Their names launder legitimacy into the instrument.
2. **Convene rival labs as equal founding members.** Identical dues, board seats,
   an independent exam board money cannot touch. The pitch to each lab: your own
   cert is a sales funnel; a neutral examiner grows the whole market.
3. **Org-level "AILX-Assessed Team" badge at launch.** Individual certs follow org
   mandates, not the reverse (KCSP, CompTIA ASC). This is the enterprise product:
   benchmarked org capability scores, sold into the 95%-pilot-failure problem.
4. **One anchor mandate.** One employer requiring AILX in hiring, or one
   ministry/procurement pilot. The exam is worthless until someone requires it and
   compounds fast after. EU AI Act Art. 4 is a weaker hook than it looks: it requires
   no measurement and carries no EU fine (docs/POLICY-BRIEF.md §2.2, §2.3).
5. **Structural hygiene from day one.** Nonprofit examiner owns the trademark and the
   secure anchor block; training/prep lives in a separate entity. This makes the
   neutrality claim legally credible — and is why audit-grade score recomputability
   (spec core invariant) is a strategic asset, not just engineering discipline.

Sequencing of value capture: (1) enterprise performance assessment is the wedge,
(2) the frontier/agentic talent signal is the moat, (3) Art. 4 compliance is a
distribution hook, (4) the mass consumer credential is the long game.

Historical base rate for this path: **3–7 years to industry default** — with the
Art. 4 vacuum and the FDE hiring boom as the kind of external demand shock that
compressed CNCF's timeline to two.

## The research flywheel — and the governance it requires

The quarterly research cadence (see `docs/FUTURE-TRACKS.md`) is the technical and research
moat. Nobody else is systematically studying what frontier practice looks like and then
turning it into a measurable instrument every quarter.

That research needs domain expertise from people at the edge, which suggests an advisory
relationship with frontier startups and labs. The exchange is real in both directions:
AILX gets expertise it cannot buy, and advisors get visibility and credibility from being
named in the methodology behind the instrument that defines AI fluency.

Historical precedent supports it. CompTIA was founded by competing vendors; CNCF has rival
companies fund a vendor-neutral hands-on exam; ETS was created by institutions donating
their own tests. Competitors cooperate on a neutral body when it grows the whole market.

### The risk, stated plainly

The strategic asset is NEUTRALITY (see the positioning above: every incumbent credential is
vendor-captive, and the "ETS of AI" seat is empty). If advisory participation reads as
sponsorship — "advise us and get advertising" — the instrument becomes exactly the thing
it was built to replace, and the neutrality claim dies quietly. A single visible instance
of a vendor's product appearing in a challenge they advised on is enough to do it.

### Rules that keep it defensible

Adopt before the first advisor is signed, not after:

1. **Test the skill, not the tool.** Challenges must be model- and vendor-agnostic:
   a candidate should be able to score well using any frontier stack. Anything that only
   works with one vendor's product is a defect, not a feature.
2. **Disclosed membership.** Publish who advises, and what they contributed. Undisclosed
   influence is the thing that ends credibility.
3. **Recusal.** An advisor may not shape, review, or approve any challenge or item where
   their product or company is materially advantaged.
4. **No placement, ever.** Advisors receive credit and credibility, never product
   placement, logo positioning inside challenges, or preferential treatment of their tools.
   If it functions as advertising, it is sponsorship and it needs a firewall.
5. **Separation of powers.** Advisors inform research inputs; an independent examiner
   function owns the final instrument. Keep the decision rights explicit and separate,
   as the CNCF model does with technical control never following the money.
6. **Say no publicly.** The ability to reject an advisor's suggestion, on the record, is
   what makes the rest of it believable.

### Why this is worth the discipline

The advisory network compounds: better research produces a better instrument, which
attracts better advisors, which improves the research. But it only compounds while the
scores mean something. Neutrality is not a constraint on the flywheel — it is the bearing
the flywheel spins on.
