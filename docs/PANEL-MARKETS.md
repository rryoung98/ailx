# PANEL-MARKETS.md — what a probability sample costs in Japan and Korea, and what it does not

Status: evidence review, September 2026. Written to settle one question: can AILX buy a national
population statistic in Japan and Korea on the same terms as in the US and the UK? It cannot, and
this document says what it can buy instead, at what price, and what has to be true before the
trilingual exam is allowed to produce a trilingual statistic.

Companion documents: `docs/SAMPLING.md` (the two-track design and the release rules),
`docs/POSITIONING.md` (why a population statistic is the ambition), `AILX-Spec-2026.1.md` §01–02.

Labels follow `docs/SAMPLING.md`. **VERIFIED** means a primary source was read and is cited.
**ESTIMATE** means our arithmetic or judgement, with the assumption written beside it. **UNKNOWN**
means we do not know. Every source below was read on 2026-09-02. Currency conversions use
1 USD = 160.16 JPY = 1,374.61 KRW (ECB reference rate, 2026-09-01). **VERIFIED.**

---

## 1. The finding, in four sentences

**No probability-based online panel can be bought in Japan or South Korea.** Ipsos sells
KnowledgePanel in ten countries and neither is among them; every major Japanese and Korean panel is
opt-in. **VERIFIED.**

**Probability fieldwork, however, is on sale in Japan** — as an omnibus ride, in person, on someone
else's questionnaire. **VERIFIED.** Korea sells ad-hoc mobile RDD by the project. **VERIFIED.**

**Neither of those can carry a 45–60 minute assessment**, which is what a Track B wave needs
(`docs/SAMPLING.md` §5). An omnibus sells questions, not testing time.

**So the AILX position is: the exam is trilingual, the first population statistic is not.** The
first wave covers the US and the UK, whose frames are rentable. Japan and Korea field when
commissioned fieldwork is funded and a local partner is contracted.

## 2. Japan — the vendors

| Vendor | Product | Recruitment | Probability? |
|---|---|---|---|
| Macromill | マクロミルモニタ | open self-registration, points | **No** — opt-in. **VERIFIED** |
| Intage | マイティモニター (Cue Monitor + docomo d-point + MApps) | self-registration, blended third-party bases | **No** — opt-in. **VERIFIED** |
| Rakuten Insight | 調査パネル, ~2.2m members (Jan 2026) | recruited from Rakuten service users | **No** — opt-in. **VERIFIED** |
| Cross Marketing | MotheR network ~14.1m; リサーチパネル 4.9m | free self-registration, points | **No** — opt-in. **VERIFIED** |
| NTT Com Online | Freeasy, ~13m monitors (Jun 2024) | partner/affiliate opt-in; quality control by blacklist, not by frame | **No** — opt-in. **VERIFIED** |
| Nikkei Research | 日経リサーチアクセスパネル | **closed** — survey invitations and reward points ended December 2025 | **No panel at all now.** **VERIFIED** |
| Nikkei Research | 日経電話世論調査 | RDD over landline and mobile number space, ~13–14k numbers drawn, ≥900 completes | **Yes**, but ad-hoc telephone, not a panel. **VERIFIED** |
| Video Research | ACR/ex | area random sampling, in-person recruitment, loaned tablet, ~10,700 completes | **Probably**, but a syndicated media study; placement terms **UNKNOWN** |
| Central Research Services | 季刊・住基オムニバス | stratified two-stage random sample from the Basic Resident Register, in-person, 2,000 issued, ~1,100 completes | **Yes — purchasable probability fieldwork.** **VERIFIED** |
| Nippon Research Center | NOS omnibus | households from a residential map database, area sampling as fallback, visit placement, 1,200 completes | quasi-probability; frame is commercial, not a register. **VERIFIED** design, probability status part **ESTIMATE** |

Sources: vendor methods pages (macromill, intage, insight.rakuten, cross-m, freeasy-survey,
monitor.nikkei-r, nikkei-r pollsurvey, videor, crs.or.jp/survey/omhh.html, nrc.co.jp/solution/nos).

One legal gate worth knowing: Basic Resident Register access is granted only for surveys whose
results will be published. **VERIFIED** (CRS). A commercial-only AILX wave may not qualify for the
best frame in the country.

## 3. Korea — the vendors

| Vendor | Product | Recruitment | Probability? |
|---|---|---|---|
| Gallup Korea | 갤럽패널 | open self-signup | **No** — opt-in. **VERIFIED** |
| Gallup Korea | Daily Opinion and commissioned polls | random draw of carrier-supplied mobile virtual numbers, CATI | **Yes** — ad-hoc telephone, purchasable. **VERIFIED** |
| Hankook Research | Master Sample®, ~970k (Mar 2026) | self-declared willingness, recruited on and offline since 2001; draws are **proportional quota** | **No** — opt-in with a quota draw, despite the "통계적 대표성" wording. **VERIFIED** |
| Macromill Embrain | 패널파워, ~1.78m | self-registration, cash rewards | **No** — opt-in. **VERIFIED** |
| Kantar Korea | 칸타모바일패널 | application and screening; purchase diary | **No** — opt-in, and a shopper panel. **VERIFIED** |
| Realmeter | weekly tracker | 100% mobile RDD, ARS self-completion, quota completion | probability draw, quota completion; ad-hoc telephone. **VERIFIED** |

**No Korean vendor sells RDD-recruit-to-web as a standing product.** Whether one will quote it as a
bespoke job, and at what conversion, is **UNKNOWN**.

## 4. The counter-examples, and why they do not count

- **PbOPSS-23** — Probability-based Online Panel for Social Science since 2023, Ochanomizu
  University, PI Sugino Isamu, JSPS KAKENHI 22H00070, to March 2027. Members recruited by random
  sampling and mail invitation; about 1,000 registrants; fieldwork contracted out. Its own page
  says there are still almost no probability-based online panels in Japan. **VERIFIED.** It is a
  research panel running about one survey a year, with no survey time for sale.
- **KPOP** — Korean Probability-based Online Panel, a recruitment pilot by Kim Jibum and Kim Hyelin
  (Sungkyunkwan) with the European Social Survey HQ. Mail push-to-web, 570 households, four
  mailings, **~21% response (N = 112)**. 조사연구 2025;26(3):91–123, DOI 10.20997/SR.26.3.4.
  **VERIFIED.** A feasibility study, not an operating panel.
- **JGSS and KGSS** — real probability samples, run as academic infrastructure. JGSS draws from the
  electoral register or the Basic Resident Register, two-stage, and contracts fieldwork to Central
  Research Services; KGSS is multistage area probability, face to face, and its 2021 wave was
  collected by Gallup Korea. **VERIFIED.** Module inclusion is by academic collaboration, on an
  annual-to-biennial cadence. Whether paid question placement is possible at all is **UNKNOWN**.
- **JLPS, JHPS-KHPS, KLIPS, KLoSA** — probability longitudinal cohorts. Panel studies, not vendors.
  **UNKNOWN** whether any takes paid placement.
- **Official statistics** — Japan's 2025 Population Census reached a provisional **48.2%** internet
  response rate against 37.9% in 2020 (統計調査ニュース No.468), and Statistics Korea's Social Survey
  is a two-stage stratified PPS cluster sample with an internet self-completion option. **VERIFIED.**
  Both are government channels. Neither is available to us.

The honest summary of §2–§4: **the panel claim holds; the "nothing exists" version of it does not.**
Japan has a purchasable probability frame with an in-person mode, and Korea has purchasable
probability telephone fieldwork. What neither country has is a probability sample that can be sent
a long web assessment.

## 5. Response rates, with year and source

| Country | Design | Year | Rate |
|---|---|---|---|
| JP | Asahi Shimbun, first national ABS push-to-web mail survey | 2023 | **22%** |
| JP | ABS push-to-web, Ome City, n = 1,000 addresses, no pre-notice | 2023 | **RR3 = 19.2%** |
| JP | same study, arms: no incentive / pen / ¥300 QUO card | 2023 | 12.6% / 20.4% / **28.5%** |
| JP | NHK mixed mode, Basic Resident Register frame, web first | 2016 / 2017 / 2021 / 2023 | 43.5% / 54.5% / 48.4% / **51.9%** |
| JP | JGSS, two-stage random, interview or placement | 2015 / 2018 / 2023 / 2024 | 52.4% / 54.3% / 51.5% / **54.5%** |
| KR | KGSS, multistage area probability, face to face | 2003 / 2016 / 2018 / 2021 | 66% / 47% / 43% / **50%** |
| KR | Gallup Korea Daily Opinion, mobile virtual-number RDD, CATI | 2023-07 | **13.8%** (1,000 of 7,233) |
| KR | Gallup Korea Daily Opinion | 2026-08 | **9.7%** (1,000 of 10,303) |
| KR | Realmeter weekly, mobile RDD, ARS | 2026-05 | **3.7%** |
| KR | KPOP mail push-to-web recruitment pilot, 570 households | 2025 | **~21%** (N = 112) |

All **VERIFIED**. Japanese figures from Watanabe Kentaro (2024), *The Effect of Prepaid Incentives on
Non-respondents in Push to Web Address Based Sampling Mail Surveys in Japan*, 行動計量学 51(2):59–68,
DOI 10.2333/jbhmk.51.59, and 放送研究と調査 74(12) (2024) for NHK; JGSS per-wave pages; KGSS from the
KOSSDA cumulative record; Korean telephone rates from the vendors' own published release tables.

**The 19% in the issue is right, and it is the smaller problem.** The larger one is the last three
rows: Korean telephone response has fallen to **9.7% at Gallup and 3.7% at Realmeter**, so
"RDD phone-to-web" is a route into a sample that four in ten people never even answer. Any Korean
design has to be argued on non-response bias, not on the response rate, and the NRBA
(`docs/SAMPLING.md` §10) is the deliverable that decides whether the number is publishable.

## 6. Cost anchors, and the one assumption they break

| Item | List price | Per complete | Status |
|---|---|---|---|
| JP probability, CRS 住基オムニバス, ~1,100 completes | ¥200,000/question (Q1–5), ¥190,000 (Q6–10), ¥180,000 (Q11+) | ¥1,773 = **$11.07** for a 10-question ride | price **VERIFIED**, arithmetic **ESTIMATE** |
| JP visit omnibus, NRC NOS, 1,200 completes | ¥200,000/question, tapering to ¥130,000 | ¥1,500 = **$9.37** for 10 questions | price **VERIFIED**, arithmetic **ESTIMATE** |
| US probability, NORC AmeriSpeak omnibus, 1,000 adults | $1,000/question (Q1–5), $850, $750 | **$9.25** for 10 questions | price **VERIFIED**, arithmetic **ESTIMATE** |
| US probability, Ipsos KnowledgePanel omnibus, 1,000 adults | from $1,000 per question unit | ~**$1.00** per complete-question | **VERIFIED** |
| JP opt-in web, Rakuten Insight | 1,000 completes × 10 questions = ¥249,000 | ¥249 = **$1.55** | **VERIFIED** |
| JP opt-in web, Freeasy | ¥10 per question per response | ¥100 = **$0.62** | **VERIFIED** |
| JP ABS push-to-web, marginal cost per extra response from reminder waves 2–3 | ¥7,107 none / ¥3,683 pen / ¥2,918 QUO card | **$44.38 / $23.00 / $18.22** | **VERIFIED** (Watanabe 2024 §4.3) |
| KR fieldwork, any per-complete price | — | — | **UNKNOWN** — no rate card found; public tenders publish lump sums only |

**Read the first three rows together, because they break an assumption we were carrying.**
`docs/SAMPLING.md` §13.1 prices Japan and Korea at about **double** the US per-complete rate. On the
only published rate cards that compare, a Japanese probability omnibus complete ($9.37–$11.07) and a
US probability omnibus complete ($9.25) are within two dollars of each other. **The 2× premium in
§13.1 has no source, and this review did not find one.** It is ours, and it is now marked as such.

Two things stop that from making Japan cheap:

1. **An omnibus ride is not an assessment.** It buys a few questions on somebody else's
   questionnaire, in person, in someone else's field period. A Track B wave needs 45–60 minutes of
   matrix-sampled testing on a device, on a probability sample, per country. Nobody publishes a
   price for that, in any of the four countries. **UNKNOWN.**
2. **The real gap is probability versus opt-in, and it is about 7×, not 2×.** ¥1,773 against ¥249
   for the same nominal ten questions and roughly a thousand completes. **ESTIMATE** from two
   verified rate cards; the modes and sample sizes differ, so treat it as an order of magnitude and
   not a quote.

So the budget in `docs/SAMPLING.md` §13 stands as an engineering estimate, and the JP/KR line of it
is now supported by one thing only: no panel exists to rent, so recruitment must be built and paid
for per wave. **Three real quotes should replace the whole table before any money is committed.**

## 7. The decision

**The exam is trilingual. The first population statistic covers two countries.**

1. **Wave 1 is US + UK.** Both frames are rentable, both are English, and the wave proves the
   pipeline — short form, weighting, plausible values, NRBA, release bundle — before it is asked to
   survive a foreign address frame. `docs/SAMPLING.md` §13.3 option B, at an estimated $0.8–1.2M.
   **ESTIMATE.**
2. **Japan and Korea are a funded phase, not a date.** The trilateral release is estimated at
   $1.9–2.8M against $0.8–1.2M for US + UK, so adding the two countries costs roughly
   **$1.1–1.6M more** — the low-to-low and high-to-high difference between options B and C in
   `docs/SAMPLING.md` §13.3, not an interval on a measured quantity. **ESTIMATE, ours** — §6 above
   says why no published source supports the JP/KR half of it.
3. **The named condition.** Japan or Korea fields when all four hold: the money is committed; a
   local fieldwork partner is contracted with a written sampling design; a pilot has produced a
   realised response rate and a non-response bias analysis; and the realised n clears the 1,000
   floor in `docs/SAMPLING.md` §4.5. Missing any one of them, the country is suppressed and we
   publish the reason.
4. **Until then, no AILX output describes a Japanese or Korean population.** ja/ko convenience data
   is used for what it is good for: item calibration, DIF screening across en/ja/ko, individual
   credentials. The `docs/SAMPLING.md` §11 rules apply unchanged, and the word "national" is not
   available for it.
5. **What we say in public.** "The exam runs in three languages. The first population statistic
   covers two countries." Both halves, in that order, in the same breath.

## 8. What is still UNKNOWN

1. Per-complete price of a bespoke national probability survey in Japan, and any Korean price at
   all. The Watanabe figures cover reminder postage and incentives only.
2. Whether a Korean vendor will quote RDD-recruit-to-web, and at what conversion rate. KPOP's ~21%
   is mail push-to-web, not RDD-to-web.
3. Whether question or module placement is purchasable on JGSS, KGSS, ACR/ex or NHK's mixed-mode
   surveys, and on what terms.
4. AmeriSpeak's and Pew ATP's actual recruitment rates. Both pages make a claim and publish no
   number.
5. Whether AILX qualifies for Basic Resident Register access at all, given the publication condition
   on that frame.
6. What happens to PbOPSS-23 when its grant ends in March 2027.
7. Whether Video Research's ACR/ex meets a strict known-selection-probability standard; the
   published design says only "area random sampling".
