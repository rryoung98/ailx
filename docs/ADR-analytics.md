# ADR: product analytics (GA4), and session replay deferred

Status: **GA4 accepted in principle for the HOSTED build only, behind consent and
behind a URL-redaction guard that does not exist yet (§7). Session replay
(OpenReplay) DEFERRED by the founder mid-review; the surface boundary worked
out before the deferral is recorded in §8 so it is there when we pick it up.**
Date: 2026-09-03. Branch: `w/analytics`.
Measurement method and house style follow `docs/ADR-orpc.md` §5.2: same build
modes, `rm -rf apps/web/.next apps/web/out` between runs, every `.js` under the
export's static directory, raw and gzip.
Nothing in this ADR is installed. The scratch build that produced §2 was
discarded; the driver that made it is not in the tree.

## 1. Lead with the constraint, because it decides the shape of everything else

**A screen recorder inside a sitting is a third copy of the operational item
bank.** Inside a sitting the screen carries item stems, options, the T3
scenario, the T4 brief and the candidate's own written answers. This repository
is built around keeping exactly that content out of places it does not belong:
the operational tier lives only in the private backend repo,
`packages/content-tools/test/public-tree.test.ts` fails the build if it comes
back, and `apps/web/test/bundleSecrecy.test.ts` greps the built chunks for it.
Those two guards inspect **this repo and its build output**. Neither of them can
see a recording sitting in a third system. A replay store is therefore outside
every mechanism we currently trust, and it holds the same secret.

The same sentence, with the exam hat on: item exposure is what makes an
instrument re-usable. `docs/TREND-FORM.md` budgets exposure for the anchor form
deliberately. A replay archive is unbudgeted exposure with an access-control
story we have not written.

GA4 does not record the screen, so it does not carry that risk. It carries a
different one, and the different one is sharper than it looks (§5).

## 2. Bundle cost, measured

Method: `pnpm -r --filter '!@ailx/web' build`, then per variant
`rm -rf apps/web/.next apps/web/out` and `pnpm --filter @ailx/web build`, twice —
once unset (static export, `out/_next/static`) and once with `AILX_BACKEND=1`
(hosted, `.next/static`). Sum of every `.js` file, raw and gzip -9.
The scratch variants mounted each tracker in `app/layout.tsx`, i.e. on every
page, which is the worst case and not what we would ship.

### 2.1 GA4 (`@next/third-parties` `GoogleAnalytics`)

| | static export | hosted (`AILX_BACKEND=1`) |
|---|---|---|
| baseline, raw | 2,313,963 B | 2,627,136 B |
| baseline, gzip | 688,139 B | 787,312 B |
| +GA4, raw | 2,322,216 B | 2,635,461 B |
| +GA4, gzip | 690,808 B | 790,221 B |
| **delta, raw** | **+8,253 B** | **+8,325 B** |
| **delta, gzip** | **+2,669 B** | **+2,909 B** |
| Next's "First Load JS shared by all" | 103 kB → 103 kB | 103 kB → 103 kB |
| any route's first-load number | unchanged | unchanged |

Read that last pair carefully, because it is the number people quote and it is
the number that misleads here. **Next reports no change on any route**, to its
own rounding. The component lands in its own lazily loaded chunk. The honest
in-repo cost is the artifact total: about **2.7 kB gzip**.

**And it is not the cost.** GA4's actual payload is `gtag.js`, fetched from
Google's CDN at runtime, and it is not in any number above. Measured
in-session, 2026-09-03, `https://www.googletagmanager.com/gtag/js?id=G-…`:

| encoding | bytes on the wire |
|---|---|
| brotli (`Accept-Encoding: br`) | **147,501 B** |
| gzip | 151,187 B |
| decompressed | 427,969 B |

**147 kB brotli from a third-party origin, against a 103 kB shared first load.**
Adding GA4 to a page more than doubles the JavaScript that page causes a browser
to fetch. The 2.7 kB in our own bundle is a rounding error on the true cost, and
an ADR that quoted only the 2.7 kB would be wrong by a factor of fifty.

### 2.2 What the STATIC GitHub Pages export would carry

Nothing, and that should stay true.

The static export is a public demo with **no service behind it**. It already
refuses to carry things it cannot use: `next.config.mjs` resolves `@clerk/nextjs`
to a stub there, so the Pages bundle carries no auth SDK at all, deliberately.
`lib/data/funnel.ts` is silent in that build by construction — with
`NEXT_PUBLIC_AILX_API_BASE` unset it mints no id, writes no storage and sends
nothing. `docs/KPI.md` says it in one line: "There is no third-party analytics
script, no cookie, and no consent banner, because there is nothing here to
consent to."

Putting GA4 in the export would reverse three decisions at once: it would put a
third-party script and a cookie into a build whose selling point is that it has
neither, it would oblige a consent banner on a demo that currently needs none,
and it would send 147 kB of Google to a visitor who came to click one drill. The
measured +2,669 B gzip is real but it is the small half of the argument.

**Decision: GA4 is hosted-build-only, and that is enforced the way the Clerk
stub is enforced — by the build, not by a reviewer.** The concrete mechanism is
below in §7.

## 3. What each tool would tell us that we cannot already answer

`docs/KPI.md` already defines eight funnel steps and they are already emitted,
first-party, cookie-free, with `credentials: "omit"`, into our own store. The
right question is not "what could GA4 show" but "what is GA4 the cheapest way to
learn that the append-only store cannot tell us".

| Question | Answered today? | Verdict |
|---|---|---|
| How many browsers open AILX; how many reach the landing page | yes — `visit_started`, `landing_viewed` | **do not buy GA4 for this** |
| Play started / completed, per mode | yes — `play_started`/`play_completed`, deduped per session | do not buy |
| D1/D7/D30 return | yes — derived from `firstSeenDay`/`dayIndex` downstream | do not buy |
| Sign-in, sitting started, share created, share opened | yes — steps 6-8 | do not buy |
| **Where a candidate abandons a sitting** | **no** | and GA4 must NOT answer it either — see below |
| **Whether the report is read**, and how far down | no | GA4 could (scroll/engagement), so could one funnel step |
| **Which external referrer sends people who come back** | no — the funnel carries no referrer, on purpose | GA4's real edge |
| Geography, device class, browser mix | no | GA4's real edge |
| Search terms and landing-page performance for the marketing site | no | GA4's real edge, paired with Search Console |

Two lines in that table deserve their own paragraph.

**"Where a candidate abandons a sitting" is not an analytics question here.**
`docs/KPI.md` is explicit: "Nothing inside a sitting is instrumented …
Responses, per-item timings, judgments and scores are exam evidence. They live
in the append-only store, are content-addressed and are replayable … They are
not funnel metrics and must never be copied into one." A sitting that stops
leaves an event log that stops. Abandonment is already a query over stored
evidence — a `SELECT` against the last event of an unfinished attempt — and
routing it through GA4 would both duplicate exam evidence into a third party and
break that rule. **We do not need a tool for this. We need a query.**

**What GA4 uniquely buys is acquisition, not behaviour.** Referrer, campaign,
country, device, and the search side of the marketing funnel. Our first-party
funnel deliberately carries none of those ("no name, no email, no account id, no
IP, no referrer, no user agent"), and adding them to it would mean re-opening a
decision that was made carefully. That is a real gap and GA4 fills it cheaply.
It is also, honestly, a *marketing* gap — it tells us where to spend attention,
not whether the instrument works.

## 4. Consent and law

Primary sources are listed in §13; the load-bearing findings are these.

**4.1 GA4 needs prior opt-in consent in the EU/UK, and there is no configuration
that avoids it.** The trigger is ePrivacy Art 5(3), not the GDPR, and it bites
on the storage/access event regardless of whether the data is personal — EDPB
Guidelines 2/2023 apply it to pixels, URL tracking and IP-only tracking, so a
"cookieless" build is not outside the rule. Analytics is not "strictly
necessary" for a service the user requested. So: **nothing loads before the
choice.** A tag that fires and is switched off afterwards has already done the
regulated act.

**4.2 The French audience-measurement exemption does not save us.** CNIL Sheet
n°16 grants opt-out treatment only where the tracker is inform-and-object,
audience/A-B only, **not cross-checked with other processing**, single-editor,
IP truncated to the last byte, 13-month life. The same page: "Most large
audience measurement offerings do not fall within the scope of the exemption,
regardless of their configuration", and it names Matomo as the shape that can.
GA4 does not qualify. The UK has no equivalent exemption at all.

**4.3 Consent Mode v2 is a signal relay, not a legal basis.** In advanced mode a
denial still sends a cookieless ping to Google carrying, by Google's own
documentation, user agent, screen resolution and IP address. If we adopt GA4 we
use **basic** mode: no Google script loads at all until consent.

**4.4 Transfers.** The 2022 Austrian/French/Italian Google Analytics decisions
turned on US transfers and are superseded by the DPF adequacy decision
(2023/1795), which survived its first annulment challenge (General Court,
T-553/23 *Latombe*, 3 Sep 2025). Do not treat that as permanent. **Plan for
suspension**: the GA4 mount must be removable by configuration, which it is if
it is one env var and one component (§7).

**4.5 Refusal must cost the candidate nothing, and this is the hard rule.**
GDPR Art 7(4) plus EDPB Guidelines 05/2020: consent is not free if refusal
brings detriment (para 13, 46-48); cookie walls are invalid (paras 39-41); and
Example 8 holds that a service degraded after withdrawal means "consent was
never validly obtained", with deletion as the remedy. So:

- refusing analytics may not change access to a sitting, the item set, timing,
  marking, the report, the credential, support or price;
- the analytics choice must be visibly disconnected from anything touching the
  score, and we should say so in the banner text, not only in the notice;
- the exam context makes this stricter, not looser: EDPB para 20-21 treats power
  imbalance — including the schooling analogue, where consent is genuine only
  "as long as students will not be denied education or services" — as a reason
  consent is unlikely to be free.

**Mechanically**: the funnel emitter, the session engine and every scoring path
must have no read of the consent state. Consent gates the GA4 mount and nothing
else. That is testable and §7 makes it a test.

**4.6 The `docs/SAMPLING.md` firewall survives only if no analytics identifier
is ever a join key.** §3 S1-S5 makes the dangerous computation *unwriteable*: a
non-nullable `frame`, weights on Track B only, an estimator that will not
compile against a convenience-frame schema. An analytics client id stored beside
a panel row would route around all of it — not by making the estimator wrong,
but by creating the join outside the estimator, in a spreadsheet, eighteen months
later. It also breaks CNIL's no-cross-checking condition and, statistically,
destroys the only property the bought panel is worth buying for: known selection
probabilities. There is, as far as we could verify, **no regulator guidance
on-point** about joining a bought survey panel to first-party web analytics; we
reason from purpose limitation and the vendor's own consent text.

Rule, stated so it can be tested: **a GA4 identifier (`_ga`, `client_id`,
`session_id`, a Measurement Protocol `cid`) may not appear in any AILX table,
export, share payload or CSV**, and no panel identifier may be sent to GA4. The
firewall is not "do not join"; it is "the two identifiers never meet in a place
where a join is possible".

**4.7 A DPIA is required before launch, and this is not a close call.** ICO's
mandatory high-risk list is hit at least four times: *innovative technology*
(LLM judging), *denial of service* (decisions about access to a benefit based to
any extent on automated processing — the credential path), *tracking*
("behaviour, including but not limited to the online environment"), and *data
matching* if any panel×web join were ever contemplated. Session replay would add
the whole of *tracking* on its own. **Record the decision NOT to run replay
inside the DPIA**; a documented refusal is worth more than an undocumented
absence.

**4.8 Candidate answers are the candidate's personal data**, including their
opinions (CJEU C-413/23 P, 4 Sep 2025: personal views are "necessarily closely
linked to that person"). Free text also invites volunteered Art 9 data. The exam
store has a retention basis for answers — marking, appeals, credential
verification. A replay copy of the same words has none. That asymmetry is the
whole of §8.

## 5. PII and secrets: what must never reach GA4, and the mechanism for each

Every row names a mechanism, not an intention. Rows marked **TO BUILD** are the
work this ADR asks for; they are cheap, and GA4 must not be mounted before them.

| Must never reach GA4 | Why it is sharp here | Mechanism |
|---|---|---|
| **A share token** | `/s/<token>` — 43 chars, 256 bits, and `docs/CREDENTIAL.md` §4 says the token IS the authorization. GA4 collects `page_location` (the full URL) **by default**, and `page_referrer` too, so a candidate who clicks from their share view to any other page leaks the token a second time on the NEXT hit. Mounting GA4 unmodified on the hosted build hands Google, and every GA4 report viewer, a working capability URL to a real report. | **TO BUILD**: one redactor applied to `page_location`, `page_path` AND `page_referrer` in the mount, replacing any `SHARE_TOKEN_RE` match with `/s/[token]` before the first `page_view`; plus a test asserting no GA4 call site can pass a raw URL from any of the three. `SHARE_TOKEN_RE` already exists in `@ailx/contract`. Outbound leakage is already handled elsewhere and stays that way: the share buttons carry `rel="noreferrer noopener"` (`features/share/ShareTargets.tsx`) and `FRONTEND.md` §4.1 sets `Referrer-Policy: no-referrer` on hosted candidate content. |
| **A verify code** | `/verify/<code>` is a public claim, but it names an individual's sitting. Not a secret; still an identifier we should not export. | Same redactor, same test. |
| **`auth_ref`** (`clerk:<sub>`) | a proven identity; `docs/PROGRESSION.md` calls it exactly that. | Exists: payload denylist tests already ban `authRef` from every outbound shape (`packages/report/test/{aggregates,credential,share,diagnosis}.test.ts`, `apps/web/test/shareView.test.tsx`). Extend the same list to the GA4 event allowlist. |
| **Item content, item ids, candidate answers** | the reason this ADR has a §1. | Exists for the bundle (`bundleSecrecy.test.ts`, `public-tree.test.ts`). **TO BUILD** for the wire: GA4 events come from a closed enum of step names, no free-form `event_label`, no page-content parameters. An enum is checkable; a convention is not. |
| **Provider keys / model API keys** | `FRONTEND.md` §4.3: no secret in `NEXT_PUBLIC_*`. | Exists, and the GA4 measurement id is genuinely publishable — it is a public id, like the Clerk publishable key. It still goes in env, not in the tree, for the same reason. |
| **An analytics id in a panel row, or a panel id in GA4** | §4.6. | **TO BUILD**: the S5-pattern guard test — no module reachable from panel-frame data may import the analytics module, and no GA4 parameter name may match the panel identifier. |
| **IP address** | unavoidable in any HTTP request to Google; GA4 does not offer true opt-out. | Not preventable. State it in the notice. This is one more reason GA4 is a marketing tool on marketing surfaces, not an exam instrument. |

The first row is the single biggest risk in this document. It is not a
hypothetical: `apps/web/app/s/[token]/page.api.tsx` exists, the route is live in
the hosted build, and GA4's default behaviour is to send the URL.

## 6. Surfaces

Same boundary for both tools, for one reason: a surface either can or cannot
show exam content.

| Surface | GA4 | replay (if we ever pick it up) |
|---|---|---|
| `/` landing, `/methodology`, `/validate`, `/wall`, `/gallery`, `/world` | yes | yes |
| `/s/<token>` share view | yes, **only with the URL redactor**, and never the token | no — it renders a real person's result |
| `/verify/<code>` | yes, redacted | no |
| `/practice`, `/daily` | yes — public released-practice content, no score of record | yes |
| `/exam` (a sitting) | **never** | **never** |
| `/report`, `/progress`, `/review` | **never** | **never** |
| the static GitHub Pages export, all of it | **never** (§2.2) | never |

`/practice` and `/daily` are on the "yes" side on purpose and it is worth
justifying, because it looks like an exception. They deal only from
`instruments/demo-2026.1`, the released-practice tier whose keys are published
deliberately, and they produce no score of record. There is nothing there for a
recorder to leak that the repository does not already publish.

`/report` is on the "never" side even though it holds no item stem. It holds the
candidate's own result, their player type and their diagnosis. That is the most
sensitive page in the product for the person it belongs to.

## 7. If GA4 ships, these are the conditions

Not a plan, a gate list. Each is a test or a build behaviour, in the pattern
this repo already uses for boundaries.

1. **Hosted only.** GA4 mounts behind `isServerMode()` and a
   `NEXT_PUBLIC_GA_MEASUREMENT_ID`; with the id unset nothing loads and no
   banner appears. A `frontendOnly.test.ts`-pattern test asserts the static
   export's `out/` contains no `googletagmanager.com` string. This is the same
   shape as the Clerk stub, and it is why the export keeps its "no third-party
   script" property by construction.
2. **Nothing before consent.** Basic Consent Mode: the script tag is not
   rendered until the visitor accepts. Test: render the layout with consent
   unset, assert no script element and no `dataLayer`.
3. **URL redaction before the first `page_view`** (§5 row 1), with a test over
   `SHARE_TOKEN_RE` and the verify-code pattern.
4. **A closed event enum.** Reuse the `FunnelStep` names; no free-form labels.
   Test: every GA4 send site takes the enum type.
5. **Refusal is inert.** Test: no module under the exam, session or scoring path
   reads the consent state. This is the mechanical form of §4.5.
6. **The firewall guard** of §4.6, written in the S5 pattern.
7. **Removable by env.** DPF suspension, or a decision to move to Matomo, must
   be one variable, not a refactor.

A reasonable alternative that this ADR does not recommend but does not dismiss:
**self-hosted Matomo, IP-truncated, 13-month, single-editor** is the only
configuration that can plausibly sit inside the CNIL exemption, and it would let
the marketing surfaces be measured with no banner in France. It costs an
operational burden GA4 does not, which is the same trade §8 rejects for replay,
so the two decisions should be made together rather than separately.

## 8. Session replay (OpenReplay): deferred, with the boundary kept

Deferred by the founder on 2026-09-03, mid-review. This section exists so the
work is not repeated. It is deliberately short. Only the facts that were already
established are recorded; the storage, cost and upgrade study was stopped and is
not here.

**Measured cost, since the scratch build had already run.** Same yardstick as
§2, tracker `@openreplay/tracker` mounted in the root layout:

| | static export | hosted |
|---|---|---|
| delta, raw | +161,848 B | +161,850 B |
| **delta, gzip** | **+49,193 B** | **+49,187 B** |
| Next's shared first load | 103 kB → 103 kB | 103 kB → 103 kB |

**49 kB gzip, in our own bundle, in both modes** — eighteen times GA4's local
footprint, and unlike `gtag.js` it is bytes we ship ourselves. On the static
export that would be 49 kB of recorder for a demo with nowhere to send a
recording.

**The boundary, tested and confirmed rather than assumed.** The founder's
starting position was "replay on the public marketing and gallery surfaces,
never inside a sitting or on the report". That position is right, and the reason
is stronger than "it feels risky":

> **OpenReplay's masking is a denylist, not an allowlist.** Non-input text
> nodes are recorded verbatim unless they look like an email address:
> `obscureTextEmails` defaults to `true`, `obscureTextNumbers` defaults to
> `false`, and there is **no built-in "mask all text" global mode**. The only
> way to mask a region is to opt it out per element
> (`data-openreplay-obscured`, `data-openreplay-hidden`) or to write your own
> `domSanitizer` function. Input values are the exception — obscured or ignored
> by default, and the official docs give two different defaults for
> `defaultInputMode` on two pages. Same-domain iframes are captured by default
> (`captureIFrames: true`); network bodies are not (`capturePayload: false`).
> Source: `docs.openreplay.com/en/sdk/sanitize-data/` and `/en/sdk/constructor/`.

That single fact settles the masked-recording-inside-a-sitting question, and it
settles it against. A masked recording inside a sitting would be **safe only for
as long as every item-rendering element in every track carries the attribute**.
The default is capture. So the failure mode is not "a leak happens if somebody
adds a bad selector" but "a leak happens if somebody adds a **normal** component
and forgets a defensive attribute" — a new T3 layout, a refactored option list,
a tooltip. **The cost of one missed selector is one operational item, in
plaintext, in a third system, discovered late or never**, because nothing greps
a replay archive the way `bundleSecrecy.test.ts` greps a bundle. Guarantees that
default to on are worth trusting; guarantees that default to off and depend on
every future component are not.

**The one operational fact worth carrying forward.** Self-hosted OpenReplay is
not a container. The official Helm chart deploys roughly twenty first-party
services (`alerts, api, assist, assist-api, assist-stats, canvases, chalice,
connector, db, ender, frontend, heuristics, http, images, ingress-nginx,
integrations, sink, sourcemapreader, spot, storage, utilities`) on top of
Postgres, ClickHouse, Redis, Kafka and MinIO
(`github.com/openreplay/openreplay/tree/main/scripts/helmcharts/openreplay/charts`).
**Verdict in one sentence: this is a standing operational burden with a database
fleet and a public ingest endpoint holding candidate-visible content, not a
weekend**, and nobody on this project is currently on call for it.

**When to pick it up.** If replay returns, it returns as: public surfaces only,
a separate project key that is never mounted under `/exam`, `/report`,
`/progress` or `/review`, a build-time test that the tracker module is
unreachable from those routes, and the DPIA entry from §4.7 written first. Legal
adds one line: replay needs the same prior consent as GA4, legitimate interest
cannot cure the Art 5(3) leg, and the live US exposure is CIPA §631 all-party
wiretap litigation, which self-hosting mitigates (no third-party ear on the
wire) but conspicuous prior consent mitigates more.

## 9. Recommendation

1. **Do not install anything in this PR.** Nothing here is wired up; the scratch
   build was discarded.
2. **Do not put GA4 in the static export, ever.** It is a demo with no service,
   no auth SDK and no cookie; 147 kB of Google and a consent banner buy it
   nothing. Enforce with a build test, not a rule (§7.1).
3. **GA4 on the hosted build is worth it for acquisition only** — referrer,
   country, device, campaign — and only after the seven gates in §7, of which
   the URL redactor (§5, row 1) is non-negotiable.
4. **Do not use GA4 for anything the funnel already answers**, and do not use it
   to measure inside a sitting. Abandonment is a query over the append-only
   store, not a metric to buy.
5. **Session replay stays deferred.** If the founder wants it sooner, the
   boundary in §8 is the price of entry.

## 10. What would make this the wrong call

- **The marketing questions stop mattering.** If acquisition is settled and the
  open question becomes "does the instrument work", GA4's unique value goes to
  zero and the funnel plus the event store answer everything left.
- **DPF adequacy is suspended or annulled on appeal.** Then GA4 becomes a
  transfer problem again and the answer is Matomo or nothing. §7.7 is what makes
  that a config change.
- **A first-party alternative gets cheap.** If the funnel grows a
  privacy-preserving referrer field — coarse, allowlisted, no full URL — most of
  §3's right-hand column is met without a third party or a banner. That is a
  smaller piece of work than adopting GA4 with its seven gates, and if somebody
  costs it and it lands under a week, prefer it.
- **OpenReplay ships an allowlist masking mode**, i.e. mask-all-text by default
  with explicit unmasking. The §8 argument is aimed precisely at the denylist
  default; if that default flips, re-read this.
- **A regulator publishes on-point guidance about panel×web joining** (§4.6 says
  we found none). It would very likely tighten, not loosen, S1-S5.

## 11. Honest limits of this document

- **The GA4 numbers are a worst case.** The scratch build mounted the component
  in the root layout, on every page. A hosted-only, consent-gated mount would
  put the same 2.7 kB gzip in a chunk fewer visitors fetch. The 147 kB `gtag.js`
  figure is what it is, and it was measured on one day from one CDN edge.
- **No consent-banner cost is measured.** A CMP is a second dependency with its
  own bundle, and this ADR did not price one. That is a gap in the §3 argument:
  the real cost of GA4 is GA4 plus a CMP plus a redactor plus seven tests.
- **The OpenReplay section is partial by instruction.** Storage per recording,
  release cadence, patch process, machine sizing, licence name and any GCP cost
  were NOT researched. Do not quote this ADR for those.
- **The legal note is research, not advice**, and its Japan/Korea paragraphs are
  explicitly low confidence. Two items are unverified: whether *Latombe* is under
  appeal, and whether any authority has ruled on advanced-Consent-Mode pings.
- **We did not measure what GA4 would actually report** for this site. The
  claimed unique value in §3 (referrer, geography, device) is GA4's documented
  behaviour, not something observed on our traffic.

## 12. Review

**codex review skipped: usage limit** — `codex exec` hit its ChatGPT usage
quota mid-run and produced no findings ("You've hit your usage limit … try
again at Sep 3rd, 2026 4:01 AM"). One defect was found by self-review before
that and is fixed above: the §5 redactor covered `page_location`/`page_path`
but not **`page_referrer`**, which leaks a share token on the hit AFTER the
share view. The privacy and consent reasoning in §4 and §5 has therefore had
no adversarial read. Treat it as unreviewed until it gets one.

## 13. Sources

Fetched in-session, 2026-09-03. Every legal claim above traces to one of these.

- ePrivacy Directive 2002/58/EC Art 5(3) — https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32002L0058
- EDPB Guidelines 2/2023, technical scope of Art 5(3) (paras 10, 12; pixels, URL and IP-only tracking) — https://www.edpb.europa.eu/system/files/documents/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf
- CNIL Sheet n°16, audience measurement exemption and the "most large audience measurement offerings do not fall within the scope" line — https://www.cnil.fr/en/sheet-ndeg16-use-analytics-your-websites-and-applications
- CNIL, Google Analytics and transfers (settings and IP handling are not enough; a proxy is) — https://www.cnil.fr/fr/google-analytics-et-transferts-de-donnees-comment-mettre-son-outil-de-mesure-daudience-en-conformite
- ICO, cookies and similar technologies under PECR — https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/cookies-and-similar-technologies/
- Commission Implementing Decision (EU) 2023/1795 (EU-US Data Privacy Framework) — https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32023D1795
- General Court, T-553/23 *Latombe v Commission*, 3 Sep 2025, action dismissed — https://curia.europa.eu/jcms/upload/docs/application/pdf/2025-09/cp250106en.pdf
- Google, Consent Mode behaviour on denial (cookieless pings carry user agent, screen resolution, IP) — https://support.google.com/analytics/answer/9976101?hl=en
- GDPR Art 7(4) — https://gdpr-info.eu/art-7-gdpr/ · Art 13 — https://gdpr-info.eu/art-13-gdpr/ · Art 35 — https://gdpr-info.eu/art-35-gdpr/
- EDPB Guidelines 05/2020 on consent (paras 13, 20-21, 39-41, 46-48, Example 8) — https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_202005_consent_en.pdf
- ICO, examples of processing likely to result in high risk (innovative technology, denial of service, tracking, data matching, invisible processing) — https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/examples-of-processing-likely-to-result-in-high-risk/
- CJEU, C-413/23 P *EDPS v SRB*, 4 Sep 2025 (opinions are personal data; pseudonymity is perspective-dependent) — https://curia.europa.eu/jcms/upload/docs/application/pdf/2025-09/cp250107en.pdf
- California Penal Code §631 (CIPA) — https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=PEN&sectionNum=631
- California Civil Code §1798.140 (CPRA definitions of "sharing" and cross-context behavioural advertising) — https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.140
- OpenReplay sanitisation defaults — https://docs.openreplay.com/en/sdk/sanitize-data/ and https://docs.openreplay.com/en/sdk/constructor/
- OpenReplay Helm chart service list — https://github.com/openreplay/openreplay/tree/main/scripts/helmcharts/openreplay/charts

Not verified, and flagged where used: whether *Latombe* is under appeal; whether any authority
has ruled on advanced Consent Mode pings; Japan APPI and Korea PIPA current article numbering;
any regulator guidance on joining a bought survey panel to first-party web analytics.
