# ADR: end-to-end tracing with OpenTelemetry

Status: **adopted — propagation in the browser, spans in the service** (§5).
Also carries a **correction to `docs/ADR-orpc.md` §5.2** (§4).
Date: 2026-09-03. Branch: `w/otel` (this repo) and `w/otel` in the PRIVATE
`rryoung98/ailx-backend`. No Linear issue.
Yardstick: `docs/ADR-zod-tanstack.md` §3.1 — the same builds, the same
`rm -rf apps/web/.next apps/web/out` between every run, and the same per-page
rule that counts every `<script src>` a page actually requests. That rule is a
script now, `docs/bundle-bytes.mjs`, so nobody has to re-derive it.

## 1. The question

We can see that a request was slow. We cannot see WHERE it was slow, because
the browser and the exam service are two deployments in two repositories and
nothing links a call to the work it caused. The founder's question was whether
adopting OpenTelemetry answers that — and whether it changes the oRPC decision
(`docs/ADR-orpc.md`), since both are about the seam between the two repos.

## 2. What was built

**The browser propagates; it does not instrument.** There is no
`@opentelemetry/*` package in this repo and there must not be one. The web SDK
costs tens of kB before it has sent a single span, and the DEFAULT build here
is a static export on GitHub Pages with no exam service to trace at all. What
the browser does instead is the one thing only it can do: mint a W3C
`traceparent` and put it on the wire.

- `apps/web/lib/data/traceparent.ts` — `newTraceparent()` builds
  `00-<32 hex>-<16 hex>-01` from `crypto.getRandomValues`. No dependency, no
  `uuid`, no SDK. A browser with no usable randomness gets NO header rather
  than a fabricated one, because a malformed trace id is dropped by a collector
  without telling anyone.
- `serviceHeaders(storage)` is the composition every service call uses: WHO
  (`authHeaders`, unchanged) and WHICH TRACE. Fifteen call sites moved onto it.
- `serviceFetch` traces ANONYMOUS reads too (`/wall`, `/gallery`), not only
  identified ones. The header is random hex and says nothing about the person.
- A fresh trace per call, deliberately. The browser holds no span processor,
  so pretending several calls share a trace would be a lie the service could
  not correct — and a stable trace id would be a second, quieter identifier.

**The service instruments.** In the private repo, the Node SDK with a span per
handler at the ONE place that already wraps every handler, `apiRoute`, and the
incoming `traceparent` continued so a browser call and its server work land in
one trace. The exporter is Cloud Trace, configurable and OFF BY DEFAULT, so
tests and local runs need no collector and no credentials. Span attributes are
route, status and identity PRESENCE — never a provider key, a token, item
content or a candidate's answer, and a test pins the attribute set so a future
attribute cannot leak one.

**The seam claim was not quite true, and that is a finding.** The design said
every browser call goes through `serviceFetch`. It does not: `serviceFetch` is
the only READ path, and the writes (`PracticeDrill`, `ReviewActions`,
`Moderation`, `siteExport`, `siteUpload`, `localPractice`, `persistence`,
`ShareLink`, `CredentialPanel`) each call `fetch` with `authHeaders()`
themselves. The single injection point that DOES exist is the identity header
builder, so the trace was composed with it and every call site moved.
`apps/web/test/traceparent.test.ts` fails if any file goes back to
`await authHeaders(` on its own, so the seam is enforced rather than described.

## 3. What propagation cost: about nothing, and less than that

Baseline is `main` at `d4a4aee`; "after" is this branch. Both build modes,
`rm -rf apps/web/.next apps/web/out` between every build, never concurrently.

| artifact bytes | baseline | this branch | delta |
|---|---|---|---|
| static export, all JS in `out/_next/static`, raw | 2,313,967 B | 2,311,498 B | **−2,469 B** |
| the same, gzipped | 688,135 B | 687,704 B | **−431 B** |
| hosted, all JS in `.next/static`, raw | 2,627,142 B | 2,625,912 B | **−1,230 B** |
| the same, gzipped | 787,305 B | 787,040 B | **−265 B** |

Per page, the gzipped sum of every `<script src>` the page requests — the
figure ADR-zod-tanstack §3.1 showed is the comparable one:

| page | static baseline | static after | delta | hosted baseline | hosted after | delta |
|---|---|---|---|---|---|---|
| `/` | 235,824 B | 236,767 B | +943 B | 272,410 B | 273,367 B | +957 B |
| `/wall` | 238,000 B | 238,943 B | **+943 B** | 274,589 B | 275,546 B | **+957 B** |
| `/exam` | 277,115 B | 276,679 B | −436 B | 320,561 B | 320,053 B | −508 B |
| `/report` | 297,274 B | 296,839 B | −435 B | 338,458 B | 337,948 B | −510 B |
| `/methodology` | 177,793 B | 178,002 B | +209 B | 214,456 B | 214,679 B | +223 B |
| `/practice` | 181,692 B | 182,637 B | +945 B | 218,361 B | 219,318 B | +957 B |
| `/daily` | 235,812 B | 236,021 B | +209 B | 272,666 B | 272,889 B | +223 B |
| `/validate` | 268,849 B | 269,792 B | +943 B | 306,867 B | 307,824 B | +957 B |

Next's own numbers did not move at all: "First Load JS shared by all" is
103 kB before and after in both modes, and every per-page first load is
unchanged except `/report`, which Next rounds from 235 kB to 236 kB.

**Noise floor, measured rather than assumed.** The hosted build was run twice
over the identical tree: 787,040 B vs 787,031 B gzip total, and every page
differed by 7 B. So build-to-build variance is under 10 B gzip, and the ±950 B
moves above are real — they are just not cost. The module is ~200 B of source;
the rest is webpack redistributing modules between chunks, which is why some
pages fall by 400–500 B while others rise. The total artifact size FELL in both
modes.

**The claim to test was "browser propagation costs ~0 bytes". It holds.**
Under a kilobyte gzip on the worst page, nothing at all on the shared chunk,
and less total output than before. For comparison, TanStack Query cost +7.8 kB
gzip on every page (ADR-zod-tanstack §8), and the number in the next section is
forty times this one.

## 4. The correction to ADR-orpc §5.2

ADR-orpc reported oRPC as **+22 kB gzip on `/wall`**, quoting Next's per-page
"First Load JS". TEN-65 then showed that number UNDER-reports, because it does
not count async chunks the page still fetches. The ADR says so and asks for the
figure to be redone. Redone, with `docs/bundle-bytes.mjs`, on the restored
spike package (`git checkout 71e68b3^ -- packages/spike-orpc`) wired into
`app/wall/page.tsx` exactly as before:

| oRPC spike client on `/wall` | before | after | delta |
|---|---|---|---|
| static export, gzip of every `<script src>` on `/wall` | 238,045 B | 276,134 B | **+38,089 B** |
| hosted build, the same | 274,578 B | 314,334 B | **+39,756 B** |
| static, all JS gzipped | 688,161 B | 727,249 B | +39,088 B |
| hosted, all JS gzipped | 787,313 B | 811,501 B | +24,188 B |
| Next's `/wall` first load, static | 108 kB | 150 kB | +42 kB |
| Next's `/wall` first load, hosted | 108 kB | 151 kB | +43 kB |

**The corrected figure is +38.1 kB gzip on the static export and +39.8 kB on
the hosted build — about 1.7× the published +22 kB.** Build-to-build noise on
those runs was at most 35 B, so the difference is not measurement slop.

Be precise about WHY it differs, because the obvious explanation is the wrong
one. It is **not** the TEN-65 under-report: on this tree Next's own per-page
number says +42 kB, slightly MORE than the corrected sum, because here the
oRPC code lands in a first-load chunk rather than an async one. The difference
is the BASELINE. `main` has moved since 2026-09-02 — zod 4 and TanStack Query
landed — and the spike was restored onto today's `main`, not replayed on
`w/ten-37`. The single largest component is that the spike pins `zod@^3.24.0`
while the app now ships zod 4.1.11, so the oRPC chunk carries a SECOND COPY of
zod: on the static export the whole cost is one new 35,018 B gzip chunk
containing both.

So: **both numbers are honest measurements of different trees.** ADR-orpc §5.2
should cite +38.1 kB gzip on `/wall` with the baseline named, and should not
claim that the old number was a methodological error. The decision it supports
gets stronger, not weaker, and nothing else in that ADR changes.

## 5. The decision

**Adopt tracing in the shape above: propagation here, spans and export in the
service.** It costs this repo under a kilobyte on one page, no dependency and
no SDK, and it buys the first thing that can say where a request spent its
time across two deployments.

**It does NOT change the oRPC decision.** That was the founder's actual
question and the analysis put to us was "no". Testing it against what was
built, the analysis holds, for a reason worth stating plainly: tracing needs
CONTEXT PROPAGATION and a COLLECTOR, not a protocol. The whole browser half is
one header and 90 lines; the service half is one wrapper. Neither wants a typed
RPC layer, and oRPC would not have made either shorter.

Nor does tracing touch any of oRPC's three defects:

- **bundle cost** — now measured worse, not better: +38.1 kB gzip on `/wall`
  (§4), against +0.9 kB for this work;
- **a runtime dependency inside purity-enforced `contract`** — tracing adds
  none. `packages/contract` gains nothing on this branch: the traceparent
  helper lives in `apps/web/lib/data/`, where env, I/O and `crypto` are
  allowed, and the header name is the W3C spelling, so no shared constant and
  no `sync:shared:check` coupling was created;
- **`JsonifiedClient` erasing payload types to `unknown`** — untouched by a
  header.

**The flip condition in ADR-orpc §9 is unchanged by this work.** That ADR flips
if "the two repos merge, or the frontend starts importing the service's types",
because then one compilation sees both sides. Tracing links the two repos at
RUNTIME, in a trace viewer, and deliberately at no other level: this branch
introduces no shared package, no shared type and no shared build. A trace is
evidence after the fact; it is not a compiler. If anything it makes the flip
LESS likely to be needed, because the failure mode oRPC was meant to catch —
a browser calling a route the service does not have — now shows up as a 404
span in a trace instead of a silence.

**The flip condition for THIS decision** is different and worth writing down:
adopt the OTEL web SDK only if a question arrives that a server span cannot
answer — real user timing inside the browser, or a candidate-visible failure
that never reached the service. Then the cost is measured against §3's table
on the HOSTED build only, and the static export must still ship none of it.

## 6. Honest limits

- **We trace calls, not sessions.** Each call is its own trace. Following one
  candidate's sitting end to end is not possible from these traces and is not
  meant to be — a stable client-side trace id would be an identifier we do not
  want to mint.
- **The browser contributes no span.** A trace begins at the service. Time
  spent in the page, in DNS, or in a proxy is invisible; what the trace shows
  is what the service did with the request.
- **The sampled flag is a hint, and a forgeable one.** The browser always
  sends `01`. A plain `ParentBasedSampler` would obey that, which would let any
  caller pin sampling to 1 and decide our Cloud Trace bill; the service's
  sampler caps a REMOTE parent with its own ratio
  (`AILX_TRACE_SAMPLE_RATIO`, default 1) for exactly that reason. The exporter
  is off by default, so a deployment with no exporter records nothing however
  many headers arrive.
- **An anonymous read now costs a CORS preflight.** A custom header makes a
  GET non-simple, so `/wall` and `/gallery` cross-origin gain one round trip
  they did not pay before; identified reads already paid it, because
  `x-ailx-dev-user` is custom too. The service allows `traceparent` and
  `tracestate` in `Access-Control-Allow-Headers` — without that the browser
  would strip the header and the continuation would silently never happen.
- **"Every handler" is not literally every route.** `apiRoute` wraps most of
  them, but `/livez`, `/readyz`, the three capability routes (share token,
  credential code) and the served T1 site bypass it and carry no span. The
  private repo writes the list down and a test there fails if it changes.
- **The funnel emitter is NOT traced, on purpose.** `lib/data/funnel.ts` posts
  with `credentials: "omit"` and no identity header, and is documented as
  anonymous by construction (docs/KPI.md). Adding a header to it would buy a
  one-span trace with nothing else in it, so it was left alone.
- **Server-rendered reads are not traced.** `generateMetadata` and the
  `app/s/[token]/card.png` route fetch from the server, not the browser, and
  do not go through `serviceHeaders()`. They would need their own propagation.
- **Nothing goes near `score()`.** `runPure` traps clock, randomness, network
  and deferred scheduling, so a span around a scorer throws — correctly. The
  recompute path is untraced and must stay untraced; §5's timing questions are
  about HTTP handlers, not about scoring.
- **`packages/contract` is unchanged.** No OTEL import, no new dependency, no
  purity-allowlist edit, and therefore no `sync:shared:check` pressure on the
  private repo from this half.
- **The bundle numbers are artifact bytes and per-page script sums, not what a
  visitor downloads**, exactly as in ADR-zod-tanstack §3.1. Only the deltas are
  comparable.
- **The §4 correction was measured on today's `main`, not on `w/ten-37`.** It
  is the number that applies if somebody adopts oRPC now, which is the only
  number worth carrying forward, but it is not a like-for-like replay of the
  2026-09-02 measurement and does not pretend to be.

## 7. The review, and what it changed

`codex exec` was run over the branch diff, asked for defects and not praise.
Eight findings. Six changed the code; two are answered here.

- **Accepted, and the sharpest one.** `docs/bundle-bytes.mjs` treated a
  missing HTML root as an empty page table and an unresolvable `<script src>`
  as zero bytes. Both make a measurement look BETTER exactly when it is
  invalid. It now throws on the first and exits non-zero on the second.
- **Accepted.** The all-zero-id test used real randomness, so it would have
  passed with the check deleted. It stubs `getRandomValues` to return zeroes
  and asserts no header comes out.
- **Accepted.** The seam test grepped for the literal `await authHeaders(`,
  which a call without `await` would have walked straight past. It strips
  comments, matches any call, and is joined by the check from the other
  direction: every module that spells `${apiBase()}` into a `fetch` must reach
  the trace seam, with a floor on the number of modules found so the check
  cannot quietly stop matching.
- **Accepted.** The "no OTEL SDK" test read only `apps/web/package.json`. It
  reads every workspace package manifest now. A transitively pulled SDK is
  still beyond a source-text test, and the test says so.
- **Accepted, as documentation.** The CORS preflight cost of a custom header
  on a previously simple GET, and the forgeable sampled flag, are both real.
  The first is written down at the seam and in §6; the second was fixed in the
  service, whose sampler now caps a remote parent.
- **Answered, not changed.** "The per-page sum misses a chunk fetched by a
  dynamic `import()` after hydration" is true, and it is why the artifact
  total is reported beside it. The script header now says so.

An earlier run of the same review wandered onto a sibling branch and reviewed
code this branch does not touch. Its findings are not recorded here, because
they are not about this diff.

## 8. The gates

- `AILX_TEST_FORKS=2 pnpm test`: **207 files, 2819 passed, 10 skipped, 0 failed.**
- `pnpm -r build`: green, including `packages/core/test/frontendOnly.test.ts`
  (no `app/api/**` route, no server adapter, no banned dependency) and
  `packages/content-tools/test/public-tree.test.ts`.
- `AILX_BACKEND=1 pnpm --filter @ailx/web build`: green.
- `pnpm lint`: 0 errors, 122 warnings, 42 infos — one fewer warning than the
  baseline, and no new rule carried.
- The private repo's own gate set, including `pnpm sync:shared:check`, is on
  its own PR.
