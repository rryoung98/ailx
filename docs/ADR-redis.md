# ADR: Redis

Status: **not yet — rejected on today's measurements, with a named flip
condition** (§8). Nothing was installed and no application code was written.
Date: 2026-09-04. Branch: `w/redis-adr`. No Linear issue.
Yardstick: `docs/ADR-orpc.md` and `docs/ADR-zod-tanstack.md` — a number before
a preference. Where a number could not be taken, this document says so instead
of estimating, which is the rule `docs/LOAD-TEST.md` set for itself and then
broke twice.

## 1. The question

The founder's words were: add Redis "for the authentication and so forth ...
less back and forth between the API". That is two claims — that authentication
is doing repeated work worth caching, and that round trips are what makes the
system slow. Both are testable, and neither had been tested. This document
tests them.

The scope is deliberately narrow. **It does not ask whether Redis is a good
piece of software.** It asks what Redis would cache in THIS deployment, what
that thing costs today, and whether a cache of it would be correct.

## 2. The system the question is actually about

Read from the deployed services on 2026-09-04, not from a diagram.

| | |
|---|---|
| frontend | Vercel, `https://ailx-staging.vercel.app`, CDN-cached prerender |
| exam service | Cloud Run `ailx-backend`, project `tenken-staging`, us-central1 |
| service URL | `https://ailx-backend-z362vrxkja-uc.a.run.app` |
| database | Neon Postgres through the `-pooler` endpoint |
| auth | Clerk, verified BY THE SERVICE; the frontend verifies no token |
| admin | `https://ailx-admin.vercel.app`, `pg` with a module-level pool capped at 2 |

`gcloud run services describe` returns `containerConcurrency: 80`,
`maxScale: "4"`, `cpu 1`, `memory 512Mi`, and **no `minScale` annotation at
all** — so min-instances is 0 and a quiet period is followed by a cold start.
The pg pool is `DEFAULT_POOL_MAX = 3` (`services/api/src/context.ts:89-90` in
the private repo). That is the same 80-against-3 defect `docs/LOAD-TEST.md`
§1.1 found by reading; it is still deployed, and §8.3's preferred pair (pool 8,
concurrency 8) is still not applied — and that document is careful to call it
"a preference, not a decision. **The human picks.**"  **Hold that thought: it decides the
answer.**

The service mounts 49 routes, 45 of them under `/v1`. Seven routes need no identity: four under `/v1` (allocation, share view, share
views, credentials) plus `/livez`, `/readyz` and the two `GET /api/site/:digest`
snapshot routes. `GET /v1/gallery` and `GET /v1/aggregates` are NOT among them —
their handler comments say "unauthenticated by design", but both are mounted
through `apiRoute`, which 401s an anonymous caller, and
`services/api/test/app.test.ts:76,83` asserts exactly that. The comments describe the handler, not the route. This matters
below, because an authenticated route cannot be handed to a CDN.

## 3. What Redis would cache, one candidate at a time

### 3.1 Clerk JWT verification — it saves no network call, and probably costs more

This is the founder's first claim, and it is the one the evidence answers most
cleanly.

`@clerk/backend` is `^3.16.0`, resolved to **3.16.13**. The provider calls
`verifyToken(token, { secretKey })` and passes no key material
(`packages/backend/src/clerk.ts:11-29`). **The SDK already caches JWKS in the
process.** From the installed `dist/index.js:1725`, verbatim:

```js
var MAX_CACHE_LAST_UPDATED_AT_SECONDS = 5 * 60;
```

with a module-level `var remoteCaches = new Map()` (`dist/index.js:1817`) and
an expiry check at `dist/index.js:1919-1925`. The remote fetch runs only when
`skipJwksCache || cacheHasExpired(cache) || !cache.keys[kid]`.

| process state | fetches to `api.clerk.com` per request |
|---|---|
| warm, within 5 minutes of the last JWKS load | **0** |
| cold, or an unknown `kid` | 1 |

So a warm process fetches at most **12 times per hour**. That is a bound on a
LIVE process, not on the service: with `min_instances = 0` and Cloud Run
destroying an idle instance within 15 minutes, every scale-from-zero pays one
more fetch, so a bursty pattern can exceed 12 per instance-hour. The bound that
actually matters is the one Clerk publishes: **"No rate limit"** on
`GET /v1/jwks`. There is no pressure here to relieve.

Once the key is cached, verification is local crypto —
`subtle.importKey` then `subtle.verify` (`dist/index.js:1476-1500`), no I/O.
Measured over 1000 iterations after 200 warm-up, RSA-2048 RS256:

| path | µs per verification |
|---|---|
| `crypto.verify` with a reused KeyObject | **19.9 µs** |
| `importKey` + `verify` — exactly Clerk's shape | **77.4 µs** |
| `verify` only, key imported once | **39.3 µs** |

**Caching a JWT verification in Redis replaces roughly 80 microseconds of local
CPU with a network round trip, and buys a distributed invalidation problem on a
token that already carries its own `exp`.**

Two honest caveats, because this document's own rule is a number or an admission.
The 77 µs is a **synthetic bench** of Clerk's crypto shape on node 26 on an
Apple-silicon laptop — not a Clerk request against this deployment, and it omits
`decodeJwt`, the `remoteCaches` lookup and the claim assertions. And the target
is a throttled 1-vCPU container with `cpu_idle = true`; if WebCrypto RSA there is
5-10× slower, verification lands at 0.4-0.8 ms, which is **the same order as the
Redis hop, not an order below it**. The Redis figure is itself unverified —
neither Memorystore nor Upstash publishes a per-command latency.

So the defensible claim is the narrow one, and it does not need either estimate:
**a warm process makes zero network calls to verify a token, so a cache cannot
remove a network call that is not there.** Whether Redis would also be slower is
likely but unproven.

There is a cheaper way to delete the remaining fetch, and it is not Redis. Clerk
documents `verifyToken` as "networkless if the `jwtKey` is provided"; passing the
PEM removes the JWKS load entirely (`loadClerkJwkFromPem`,
`dist/index.js:6600-6601`). No dependency and no instance.

**It is not free, and this document will not charge Redis for a cost it waives
here.** A PEM in env is a permanent cache with no expiry. Clerk's own
documentation warns that a cached public key delays revocation — "the cached key
would continue to validate the old tokens until the cache expires". Pinning the
key trades a self-healing 5-minute TTL for a rotation that is coupled to a
redeploy: rotate in Clerk and verification either breaks until the service ships,
or keeps honouring old tokens. That is a real operational obligation. It is
smaller than running Redis, but it is not zero, and it should be taken with a
runbook rather than as a micro-optimisation.

The live numbers agree. An anonymous `GET /v1/gallery` — which runs
`provider.verify` and then refuses, before the body and before the pool — has a
median server time of **27 ms**, against **28 ms** for `GET /livez`, which does
no auth at all. **The auth path is not visible above the noise of an empty
handler.** Verification is not the cost. It was never the cost.

### 3.2 The instrument snapshot — already cached, in the cheapest place there is

`services/api/src/instrument.ts:30-43` memoizes the PROMISE
(`mounted ??= openInstrument(...)`), and `packages/instrument/src/index.ts:201`
holds a second process-wide parse cache. The operational `snapshot.json` is
**201,338 bytes**; the public demo tier's is 43,086 bytes. It is read once per
process and then served from memory at nanoseconds.

Redis would make this **slower**: a serialized round trip in place of an object
reference. The only thing a shared cache would save is one file read per cold
start. This is not a candidate.

### 3.3 `ensureParticipant` — 2 Postgres round trips, on every authenticated request

This one is real, and it is the thing the founder's intuition was reaching for
even though the intuition named the wrong layer.

`packages/backend/src/store.ts:111-127`, on every authenticated request that
goes through `withParticipant`:

```ts
await db.query("INSERT INTO participants (auth_ref, locale) VALUES ($1, $2) ON CONFLICT (auth_ref) DO NOTHING", [authRef, locale]);
const { rows } = await db.query("SELECT id, auth_ref, locale FROM participants WHERE auth_ref = $1", [authRef]);
```

An unconditional write attempt plus a read, before the handler's own query
runs. On the gallery path that makes 5 round trips, not 3.

Note what Redis is competing against here — it is **second best, not first.**

The two statements collapse into one round trip with no new dependency at all:

```sql
INSERT INTO participants (auth_ref, locale) VALUES ($1, $2)
ON CONFLICT (auth_ref) DO UPDATE SET locale = participants.locale
RETURNING id, auth_ref, locale
```

The `DO UPDATE` is a no-op write whose only job is to make the row visible to
`RETURNING`. That halves the identity work on all 41 authenticated routes,
today, for the cost of one migration-free code change. An index cannot do this —
`auth_ref` is already `UNIQUE` — so §6b does not cover it, which is exactly why
it gets its own step in §8.

A Redis cache of `authRef → participantId` would remove the remaining round trip.
The key is **immutable once written**, which makes it the one genuinely safe
cache key in the service: a stale hit is not possible, because the value never
changes. That is a real point in Redis's favour and it is the only cache in this
document with no invalidation rule at all. It is still behind a one-line SQL
change that costs nothing and ships this week.

### 3.4 Gallery and aggregates — the real cost, and it is not milliseconds

`GET /v1/gallery` runs **3 sequential queries** on one leased client (page,
total, facets). `share_links` has a primary key, a unique on `token`, and one
partial index on `attempt_id`. There is **no index on `approved_at`**, and none
on the JSON expression `payload->'playerType'->>'code'`. All three are
sequential scans; the total and the facet query touch every listed row
regardless of which page was asked for.

`GET /v1/aggregates` runs **4 sequential queries** — `Promise.all` over one pg
client does not parallelize, because node-postgres queues on the single
session. The worst of them, `aggregates.ts:40-45`:

```sql
SELECT attempt_id, payload FROM responses
 WHERE payload->>'type' = ANY($1)
 ORDER BY attempt_id, seq
```

`responses` is the append-only session log. It has no index on
`payload->>'type'`, so this is a **full scan of the entire event log** with a
jsonb extraction per row, a sort, and then a per-attempt replay in JavaScript.
It grows with total events, forever.

Measured from a laptop, warm service, n=15, "server time" =
`time_starttransfer − time_appconnect` (one round trip plus everything the
service does):

| endpoint | status | median | p95 | max |
|---|---|---|---|---|
| `GET /livez` | 200 | 28 ms | 35 ms | 37 ms |
| `GET /v1/gallery`, no credentials | 401 | 27 ms | 31 ms | 31 ms |
| `GET /v1/gallery`, identified | 200 | **116 ms** | 240 ms | 301 ms |
| `GET /v1/aggregates`, identified | 200 | **145 ms** | 403 ms | 421 ms |
| `GET /v1/progress`, identified | 200 | **232 ms** | 278 ms | 488 ms |
| `GET /readyz` | 200 | 64 ms | 125 ms | 155 ms |
| `GET /v1/aggregates`, **cold** (after 7 idle min) | 200 | — | — | **1213 ms** |

**Which floor to subtract matters, and the flattering one is wrong.** `/livez`
touches no auth, no pool and no database, so 28 ms is the network-and-framework
floor. `/readyz` at **64 ms** is the honest control for a database read: it goes
through `withApiContext`, so it pays the pool `connect()` too. Against the
honest control the database-and-handler work is about **52 ms for gallery,
81 ms for aggregates, 168 ms for progress** — not the 88/117/204 that
subtracting `/livez` would flatter this document's own argument into. At p95,
aggregates is 403 ms against a `/readyz` p95 of 125 ms, so about **278 ms**.
Every number in the rest of this document uses the `/readyz` control.

`/v1/aggregates` returns **441 bytes** and the response is **identical for
every caller** — nothing in it is per-person. It is the textbook cache
candidate, and this document is not going to pretend otherwise.

**The worst number measured is a cold one.** After 7 idle minutes, `/livez`
still answered in 36 ms — the container start is not visible — but the first
database read, `/v1/aggregates`, took **1213 ms, 8.4× its warm median**. That
is Neon waking from its 5-minute autosuspend, not Cloud Run. It is worth being
precise about who could fix it: an always-warm Redis WOULD mask it, and that is
the one thing a paid instance genuinely buys. So would raising Neon's autosuspend
or its minimum compute, in the console, for less money and with no new
dependency. And with `min_instances = 0` the Cloud Run process is cold too, so
an in-process cache (§6c) would NOT mask it. This is the single honest point in
Redis's favour on latency, and §6 prices it against the cheaper fix.

**But the number that matters is not 81 ms.** It is that those 81 ms are
spent holding **one of three** pool clients on an instance Cloud Run will
happily send 80 concurrent requests to. A cached read is not mainly a faster
read; it is a request that never takes a connection. That is the strongest
argument for Redis found anywhere in this investigation, and §6 is about why it
still does not win.

### 3.5 Session and attempt reads — must NOT be cached, at any speed

`AGENTS.md`: a score of record must be byte-identically recomputable from
stored inputs, and `append()` refuses a score whose evidence is missing,
mutated, unordered or duplicated. The event-log read is index-supported by
`UNIQUE (attempt_id, seq)` and bounded per attempt, so it is not slow anyway.

More importantly: **a stale read of an append-only store is a wrong answer, not
a slow one.** If a cache serves an event log that is missing the last three
events, `replayTrackScore` produces a different score and the audit trail says
the service lied. There is no TTL short enough to make that acceptable, because
the failure is silent. This is a hard exclusion, not a trade-off, and it should
be written into any future Redis adoption as a rule rather than left to a
reviewer's memory.

### 3.6 Rate-limit counters — the one place a cache is about correctness

`services/api/src/rateLimit.ts:1-14` already states the problem, in the
repository's own words:

> IN-PROCESS AND PER-INSTANCE, on purpose. Cloud Run runs many containers, so
> this is a cost ceiling per instance, not a global quota... A shared counter
> needs Redis or a row per request; neither is worth a dependency for a limit
> whose job is to stop a loop, not to meter a customer.

The rules are `SCORE 6/60s`, `MODEL 60/hour`, `MODEL_CONNECT 10/hour`, keyed
`${routePath}:${authRef}`. With `max_instances = 4`, the effective global limit
is **up to 4× the stated number**. §7 takes this up properly, because it is the
only candidate where Redis buys correctness rather than speed.

## 4. Is "less back and forth between the API" the problem?

**"Back and forth" has two readings, and this document can only answer one of
them. Saying which is which is the finding.**

**Reading A — per-request latency.** The table in §3.4 is, as far as this
repository knows, the first time anyone timed the deployed service at all.
`docs/LOAD-TEST.md` says so in its own header: "No request was timed. Every
latency figure in this file is an estimate and says so." The load test it plans
has never been run. On the one measurement now available, the browser-to-service
hop is not where the time goes: an authenticated-and-rejected call costs 27 ms
against a `/readyz` control of 64 ms and a gallery page of 116 ms. The remainder
is not purely Postgres, and this document should not label it so: it is the pool
`connect()`, the two `ensureParticipant` round trips, the handler's own queries,
a per-attempt replay in JavaScript, and serialisation. Which of those dominates
is exactly what no existing span can see.

**Reading B — the number of browser→service calls per screen.** This is the more
natural reading of the founder's words, and **it was not measured, here or
anywhere.** Nothing in this ADR counts API calls per page load, and an N+1 in
`apps/web/lib/data/*` would be invisible to every number above. If the concern is
that a screen makes six calls where it could make one, that is a real question
with a real answer — and the answer would be a batched endpoint or a
`GET /v1/bootstrap`, **not Redis**, because Redis does not reduce the number of
requests a browser makes. This document refutes reading A and leaves reading B
open. It should not be read as having settled both.

**What it would take to answer this properly from traces, not intuition.** The
OTEL work (`docs/ADR-otel.md`) already put a span on every handler at
`apiRoute`, and the browser already mints a `traceparent` on every call, so the
instrumentation exists and the trace is continued end to end. Three things are
missing, and none is large:

1. **Turn the exporter on.** `AILX_TRACE_EXPORTER` is off by default so that
   tests and local runs need no collector. Setting it to Cloud Trace on the
   staging revision is one Terraform variable.
2. **Span the database call, not only the handler.** Today the span is per
   route. The question "is it the hops or the queries" needs a child span
   around each `db.query`, plus one around the pool `connect()` — because the
   quantity this document suspects is **pool acquire wait**, and no existing
   span can see it.
3. **Count the calls per screen.** One afternoon with the network panel, or a
   trace grouped by page, answers reading B. Nobody has done it.
4. **Get traffic worth reading.** Staging receives a handful of requests. A
   trace over one caller cannot show contention. This wants the §3.4 load-test
   plan run against a throw-away service, at concurrency past 3.

Until those three exist, any latency claim about this system — including the
ones in this document — is a laptop timing a warm service from one client.

## 5. What Redis costs

Fetched 2026-09-04; every figure has a URL in §11.

**The instance.** Memorystore for Redis, us-central1, Basic tier M1, the
smallest possible 1 GiB: `$0.049` per GiB-hour = **$35.77/month**. Standard
tier M1: `$0.064` per GiB-hour = **$46.72/month**. There is no free tier.
**Basic tier is not a Covered Service under the SLA** — the smallest option is
also the one Google does not promise to keep running. Memorystore Cluster's
`redis-shared-core-nano` is $23.21/month and its own documentation says it has
no SLA and is unsuitable for production; the first production node,
`redis-standard-small`, is **$104.02/month per shard**.

**The network.** Cloud Run reaching Memorystore no longer requires a Serverless
VPC Access connector — Direct VPC egress is recommended and adds no VM charge.
If a connector is used instead, its minimum instance count "must be at least
2", it does not scale in, and it is billed as Compute Engine VMs: e2-micro in
Iowa is $6.11/month each, so a **$12.23/month floor** and $61.15 at the default
maximum of 10.

**Upstash**, the serverless alternative: free tier is 256 MB, 10 GB bandwidth
and **500K commands per month** — not per day. Pay-as-you-go is $0.20 per 100K
commands. The fixed 250 MB plan is $10/month. An SLA and multi-zone HA require
the Prod Pack at **+$200/month per database**. Upstash publishes no per-command
latency figure, so the "half a millisecond" used in §3.1 is an assumption and
is marked as one.

**The cheapest Redis is not $35.77, and this document will not win an argument
by pricing only the expensive one.** Upstash's free tier is 256 MB and 500K
commands a month — about 11.6 commands a minute sustained, which at two commands
per request covers roughly 250K requests a month. Foray is nowhere near that.
**On today's traffic a Redis for an aggregates key and a rate-limit counter
would cost $0, or $10 a month on the fixed plan.** So the money is not the
objection at small scale, and §5's honest form is: the money becomes an
objection at the point you want an SLA (Upstash Prod Pack, +$200/month per
database) or an instance inside the VPC (Memorystore, $35.77 and up, with the
cheapest tier not covered by the SLA at all).

`docs/BUDGET.md` funds a 45-person cohort's model calls for **$10 once**, and
`docs/LOAD-TEST.md` concludes that serving is inside the free tier at every
traffic level we can foresee — "The bill is idle." Those are different
denominators from a monthly instance and this document is not going to pretend
$35.77/month and $10/cohort are one ratio. The comparison that survives is
simpler: **Foray has no recurring infrastructure bill today, and the reason to
start one should be a measurement, not a preference.**

**The costs that are not money, which are the ones that actually decide it:**

- **A second stateful thing to run.** Postgres is currently the only stateful
  dependency, and Neon operates it. Redis adds a second, with its own
  version, its own maintenance window and its own eviction policy.
- **A second place a secret lives.** Today `DATABASE_URL` and
  `CLERK_SECRET_KEY` are in Terraform-managed secrets. A Redis URL is a third.
- **A cache-invalidation rule per cached thing** — and each rule is a place a
  future contributor can be wrong silently. Redis's own documentation is
  explicit that eviction is approximated LRU and that `noeviction` turns a full
  cache into write errors, so "it will just expire" is not a design.
- **A new failure mode on the request path.** When Redis is down, every handler
  that reads it must decide: fail, or fall through to Postgres. Fail-open is
  the right answer for a cache and the wrong answer for a rate limiter, so the
  two policies cannot be shared. Cloud Run also documents that an instance
  "can be shut down at any time" and that "you cannot assume that service state
  is preserved between requests", so any cache-warming assumption is void.

**Can the team carry it?** The audience for the admin dashboard is four people.
One of them would own a Redis instance at 3am. The operational cost, not the
$0-to-$35.77, is what decides this: no, not for 81 ms on a warm read.

## 6. The alternatives, priced honestly

None of these is a strawman, and each one is charged for what it actually costs.
An earlier draft priced the preferred options at zero and the rejected one to the
cent; §10 records that, and the prices below are the corrected ones.

**(a) Fix the pool, which is the actual bug.** `docs/LOAD-TEST.md` §8.3 works
out pool 8 / concurrency 8 / max_instances 20 / memory 1Gi / a **1 CU Neon
floor**, and `packages/core/test/serviceSizing.test.ts` enforces the arithmetic —
but the deployment still runs pool 3 / concurrency 80. **§3.4's "a cached read is a
connection not taken" argument is an argument about a pool of three.** Raising
the pool to 8 takes the per-instance database ceiling from 3 to 8 and the
cluster ceiling from 12 to 160, so the contention Redis would relieve is mostly
relieved by a Terraform variable.

**Three things this document must say against its own preferred option.** It is
a preference in LOAD-TEST.md, not a decision, and "the human picks" — so §8 step
1 needs approval, not just a commit. It is **not $0**: the pair requires a 1 CU
Neon floor, which is a paid always-on compute, and §8.3 prices the memory half at
"$3.24 a month per warm instance". This document refuses an unpriced number from
Redis and must refuse one here too — **the Neon floor is the single most
important unpriced figure in this ADR.** And dropping concurrency from 80 to 8
cuts total in-flight requests per service from 4x80 = 320 to 20x8 = 160,
including 401s, `/livez` and streaming `/v1/model/*` calls that need no
connection at all. It is a better shape, not a free win.

**Even so, do this first.** Whatever the Neon floor costs, it buys correctness on
a defect the repository has already diagnosed, and it changes the numbers any
Redis decision would be made from.

**(b) Postgres indexes — for gallery, and only partly for aggregates.** The
expensive queries lack an index for a nameable reason: none on
`share_links.approved_at`, none on `payload->'playerType'->>'code'`, none on
`attempts.started_at`, none on `responses.payload->>'type'`. Four migrations,
no new secret, nothing to invalidate, and they help every caller including the
admin app's pool of 2.

**They are not free either.** An expression index on `responses.payload->>'type'`
adds write amplification and a jsonb extraction to every insert on the hottest
write path in the service — the append-only log a sitting writes throughout. It
costs Neon storage, it bloats, and creating it on a live table wants
`CREATE INDEX CONCURRENTLY`, which cannot run inside a transaction and therefore
does not drop into a default migration wrapper.

**And an index does not fix the worst query.** The aggregates scan filters on
`payload->>'type' = ANY(['attempt_started','track_scored'])`, which is low
selectivity on an event log where `track_scored` is a large share of rows, so the
planner may prefer a sequential scan regardless; the `ORDER BY attempt_id, seq`
still sorts; and every matching payload is still shipped to Node and replayed per
attempt. **The work there is the projection in JavaScript, not the filter.**
Indexing is right for gallery and at best partial for aggregates.

The next step after that is a materialized view — and this document should not
sell it as something Postgres does not do. **Postgres invalidates nothing about
a matview.** It is stale from one `REFRESH` to the next, which is the same
staleness Redis is charged for; a plain refresh takes an `ACCESS EXCLUSIVE` lock
and blocks readers, `CONCURRENTLY` needs a `UNIQUE` index on the view and is
slower; and "on a schedule" needs a scheduler this stack does not have — no
`pg_cron` is asserted on the Neon plan, Cloud Run has no cron, and no Cloud
Scheduler job exists in the Terraform. A matview is a reasonable option. It is
not a free one, and nobody has checked those three things.

**(c) In-process memory on Cloud Run.** The instrument snapshot already proves
this pattern works (§3.2). For `/v1/aggregates` specifically — one global key,
identical bytes for every caller, no per-person content — a process-local
memo with a 60-second TTL removes the scan for most of every minute at **zero
dollars and zero dependencies**. It is the cheapest thing on this list.

**It is not fifteen lines, and one of its limits is a correctness limit.**

- **Stampede.** A naive value memo has no single-flight: at TTL expiry every
  concurrent request on the instance misses, and each takes a pool client. With
  concurrency 80 against a pool of 3 that is exactly the queue collapse §3.4
  names as the main risk, now fired once a minute on a timer. The fix is to
  memoise the **promise**, precisely as `mounted ??=` does in §3.2 — which is the
  design, not a detail.
- **Divergence, not just duplication.** At `max_instances = 4` there are four
  copies with independently phased TTLs, so four instances publish four
  different values of one global statistic and a user refreshing can watch the
  published number move backwards. For a public statistic that is a correctness
  property. A shared cache is the only listed option that fixes it, and that is
  a genuine point for Redis.
- **No background refresh.** `cpu_idle = true` means there is no CPU between
  requests, so the refresh cannot be a timer. It runs on a request, and one
  unlucky caller per instance per minute pays the full 81 ms — or 1213 ms cold.
- It is lost on every cold start, and with `min_instances = 0` cold starts are
  normal.

For a 441-byte statistic on a service with four admin users, those are
acceptable. For anything per-user or correctness-bearing, they are not.

**(d) HTTP cache headers.** The measurement makes this weaker than it looks, so
it gets stated plainly rather than recommended. **On the eight endpoints
measured in §3.4, no response carried a `Cache-Control`, `ETag`, `Age` or
`Last-Modified` header** — only `vary: Origin`, which is CORS. That is a sample
of eight, not a property of the service: `/v1/allocation` sets
`public, max-age=300`, T1 site assets set
`public, max-age=31536000, immutable`, and the T1 export, share and credential
responses set `no-store` on purpose. So the mechanism exists and is used
wherever somebody thought about it — and nobody has thought about gallery or
aggregates. The
catch is §2: gallery and aggregates are **authenticated**, so no shared CDN can
cache them, and a `private, max-age=60` would only help a repeat visitor in one
browser. Making them genuinely public is a policy change with its own review,
not a performance tweak. Worth doing for its own reasons; not a substitute for
(a) or (b).

**(e) Neon autosuspend and minimum compute, for the cold case.** The 1213 ms
outlier in §3.4 is Neon waking up, and it is the only measurement in this
document that a user would actually notice. Neon's autosuspend is 5 minutes by
default and lives in the console, so — as `docs/LOAD-TEST.md` §1 already
records — no repository can assert it. Raising it, or setting a minimum
compute, addresses the worst measured latency directly. §8.3 of that document
already requires a 1 CU floor for the sizing it carries, so this may be a
setting the team owes anyway. **Cost: whatever Neon charges for a warmer floor,
which is not $35.77 plus an instance to operate.** Not measured here; it is the
next thing to price.

**(f) Do nothing.** The p95 of the slowest measured read is 403 ms, on a
service with no users complaining, no load test run, and no traces exported.
Doing nothing is defensible: it leaves the option open and spends no money. It
is **not** strictly better than Redis, and this document should not say so — a
warm shared cache would mask the 1213 ms cold read that §6e calls the only
latency a user would actually notice, and do-nothing would not. Do-nothing loses
on that one metric and wins on every other. It is not the recommendation only
because (a) and (b) are cheap and clearly right.

## 7. Where Redis WOULD be right

**Distributed rate limiting.** This is the classic case a single process cannot
do correctly, and §3.6 shows it is genuinely broken today: the limiter is a
`Map` per instance, so at `max_instances = 4` the `MODEL 60/hour` cap is
really up to 240/hour. Redis `INCR` with `EXPIRE` is the documented pattern for
exactly this, and no amount of Postgres indexing or in-process memory fixes it,
because the defect is that the state is not shared.

**The Postgres alternative is worse than it first looks, and the reason is the
strongest argument for Redis in this document.** The obvious substitute is a
`rate_limit` row per identity per window, incremented with
`INSERT ... ON CONFLICT DO UPDATE SET n = n + 1 RETURNING n`. An earlier draft of
this ADR called that "one round trip on a connection the request has already
leased". **That is false.** `runRoute` orders the pipeline
`provider.verify` → `limiter.take(...)` → body read → `withApiContext(...)`: the
limiter runs **before** the pool is leased, on purpose. A Postgres limiter would
force a pool `connect()` on every rate-limited request *including the ones it is
about to reject* — so a runaway loop would consume the 3 (or 8) pool clients
that the limiter exists to protect. **Redis is the only option on the table that
keeps rejection off the pool.** That property is worth naming plainly, because it
is a correctness argument and it does not go away when the traffic is small.

Two more facts the evidence contains and this document nearly failed to connect.
`MODEL_CONNECT 10/hour` × 4 instances = 40/hour on the OAuth key-exchange path
that seals a candidate's provider credential (TEN-62) — that is an abuse control
on a credential endpoint, not only a spending cap. And `SCORE 6/60s` × 4 =
24/minute against a scoring path that costs 5+ sequential round trips on one
leased client, so the loose limiter feeds the exact pool exhaustion §3.4 names
as the main risk.

**Do we need it yet?** Not yet — but this is the closest call in the document,
and it is closer than the earlier draft admitted. The limiter's stated job is
"to stop a loop, not to meter a customer", and a 4× loose cap still stops a
runaway loop. After TEN-62 the model key is sealed per identity, so a candidate
burning 240 calls an hour burns their own credits, not ours. What is missing is
evidence that anyone has tried: no abuse has been observed, and staging has no
real users. The moment Foray funds a shared key pool (`docs/BUDGET.md` path 1:
provisioned keys with a $0.25 hard limit), the 4× becomes real overspend and
this section becomes the reason to adopt — with no cheaper option to try first,
because the Postgres one inverts the property it is meant to defend.

## 8. The recommendation, and the flip condition

**Do not add Redis yet. Do steps 1-4 below, then re-measure against §3.4's
table, which is now a committed baseline.**

The founder's stated reason does not survive contact with the code: a warm
process makes **zero** network calls to verify a Clerk token, because
`@clerk/backend` already caches JWKS in-process, so there is no round trip for a
cache to remove. On latency, the browser-to-service hop measures 27 ms while the
database-and-handler work measures 52-168 ms — the hops are not where the time
goes.

Ordered; each step ships and reverts on its own:

1. **Collapse `ensureParticipant` into one statement** (§3.3). One round trip
   saved on all 41 authenticated routes, no migration, no dependency, no
   approval needed. Do this first because it is the cheapest real win in the
   document.
2. **Price the Neon compute floor**, then apply `docs/LOAD-TEST.md` §8.3 (pool 8,
   concurrency 8, max_instances 20, memory 1Gi, 1 CU floor). LOAD-TEST calls this
   a preference and says "the human picks", so it needs a decision, and the Neon
   floor is a real monthly cost this ADR did not price.
3. **Add the gallery indexes** (§6b), and treat the aggregates scan separately —
   an index will not fix a cost that is a JavaScript projection.
4. **Instrument what is actually in question** (§4): set `AILX_TRACE_EXPORTER`,
   add a child span around each `db.query` and one around the pool `connect()`,
   and count browser→service calls per screen (§4 — the reading of the founder's
   claim this document could not test).
5. Consider Clerk `jwtKey` (§3.1) with a key-rotation runbook, not as a freebie.

**The flip conditions.** Each is written so a person can run it and get a yes or
a no. An earlier draft's first condition was self-sealing — it asked for pool
acquire wait *after* raising concurrency to equal the pool size, which makes the
wait structurally near-zero. So the pool measurement is taken **before** step 2,
not after.

- **F1 — contention, measured before the pool change.** With the exporter on and
  a `connect()` span in place, run `docs/LOAD-TEST.md`'s stage plan against a
  throw-away service at ≥ 20 concurrent requests per instance for 10 minutes,
  and record p95 pool acquire wait per instance over ≥ 1,000 requests. **If p95
  acquire wait exceeds 50 ms and step 2 does not bring it under 50 ms, adopt a
  shared cache for `/v1/aggregates` and `/v1/gallery`.** The 50 ms is chosen as
  roughly the `/readyz` control, i.e. the point at which waiting for a connection
  costs as much as using one; it is a convention, and it is written down so it
  can be argued with.
- **F2 — server-side latency, after indexing.** Measured as the `apiRoute` span
  duration (server-side, excluding the ~30 ms of client TLS in §3.4's table),
  p95 over ≥ 1,000 requests in a rolling hour. **If `/v1/aggregates` or
  `/v1/gallery` exceeds 500 ms, adopt.** Note honestly: aggregates is already at
  403 ms p95 client-side on a quiet service with n=15 and no concurrency, so
  this trip wire is within 20% of today. It may fire on the first real load.
  A matview must be *tried and reported*, not merely available, before this
  condition is spent.
- **F3 — cold reads, which no earlier draft covered.** p99 of the first database
  read after an idle period, sampled hourly for a week. **If p99 exceeds 1,000 ms
  after step 2 and after the Neon floor is set, adopt an always-warm shared
  cache** — it is the only listed option that survives both a cold Cloud Run
  process and an idle Neon compute. §3.4 measured 1213 ms once.
- **F4 — rate limiting becomes a control that matters.** **Adopt when Foray funds
  a shared model-credit pool, or when any abuse is observed on
  `/v1/model/connect`.** No cheaper option needs to be tried first: §7 shows the
  Postgres limiter would force a pool lease on requests it is rejecting, which
  inverts the property the limiter exists to provide.
- **F5 — the cost side.** **If the Neon warm floor from step 2 costs more than a
  managed Redis** (Upstash free/$10, Memorystore from $35.77), the money argument
  in §5 flips and the two should be compared directly rather than assumed.

Any one of F1-F5 flips the answer. **F2 and F3 cannot be evaluated today because
the exporter is off; F1 cannot because the load test has never been run; F5
cannot because nobody has read the Neon console.** That is the honest state of
the question, and it is why the answer is "not yet" rather than "no".

## 9. Honest limits of this document

- **The latency table is one laptop, one client, a warm service, n=15.** It is
  not a load test. It cannot see contention, because it never issued two
  concurrent requests. Every conclusion about the pool is therefore a
  conclusion from reading the code, exactly like `docs/LOAD-TEST.md` §1.1, and
  inherits the same weakness.
- **Staging runs the asserted dev-identity provider, not Clerk.** The 200s in
  §3.4 were obtained with `x-ailx-dev-user`. The Clerk path was measured from
  the SDK source and a local crypto benchmark, not from a Clerk request against
  this deployment. The 77 µs figure is real; a Clerk-mode end-to-end timing is
  not in this document.
- **No row counts.** No database was contacted, and no seed data is committed,
  so "sequential scan" is a fact about the schema and the SQL, while "expensive"
  is an inference about a table whose size nobody quoted. At today's row counts
  these scans are cheap in absolute terms; the argument is about growth.
- **The 0.5-1 ms Redis round trip is an assumption.** Neither Memorystore nor
  Upstash publishes a per-command latency figure that was found. If a real
  Redis measured 5 ms from Cloud Run, §3.1's conclusion gets stronger, not
  weaker — but the number is unverified either way.
- **The crypto benchmark ran on node 26 on Apple silicon**, not `node:22-slim`
  on a throttled 1-vCPU Cloud Run instance.
- **The private repo's line numbers are from HEAD `ed502d4`** and will drift.
- **GCRA and other rate-limiting algorithms were not verified.** §7 cites
  Redis's own `INCR` rate-limiter pattern only.
- **The 1213 ms cold read is not attributed.** Neon wake, cold pooler TLS and a
  cold pg pool are three causes with three fixes, and this document does not
  know which. §6e recommends pricing one of them, not buying it.
- **No `EXPLAIN` was run.** "Sequential scan" is read off the schema and the SQL.
  On small tables Postgres may seq-scan regardless of an index, so step 3 in §8
  may measurably change nothing at today's size — an outcome the ordering should
  survive, since the index is for growth.
- **The admin app is unsourced here.** Its `pg` pool of 2 is taken from the task
  brief; no measurement of `ailx-admin` was made, and it is cited only as a
  second consumer that indexes would also help.
- **This is a public repository.** The document quotes the private service's SQL,
  file paths with line numbers, the Cloud Run URL, the GCP project id, and the
  operational snapshot's byte size. None of that is bank content, judge prompts,
  keys or candidate data, so it is within `AGENTS.md`'s split — but the question
  belongs in an ADR that cites a private repo, and it is recorded rather than
  assumed.

## 10. Review

**codex review skipped: usage limit.** `codex exec` refused with "You've hit your
usage limit ... try again at Sep 8th, 2026 4:00 PM" and produced no findings —
the same failure `docs/ADR-analytics.md` §12 records.

The document was instead given an adversarial read by a separate agent with
access to the four evidence files, instructed to assume the "do not add Redis"
conclusion was motivated reasoning. It returned 30 defects. The draft was wrong
in ways that all leaned one direction, which is worth recording rather than
quietly fixing:

- **The headline latency figures used the flattering control.** Subtracting
  `/livez` (28 ms, no database) instead of `/readyz` (64 ms, through the pool)
  inflated the database work by about 44%. §3.4 now uses `/readyz` and every
  downstream number moved: 88/117/204 ms became 52/81/168 ms.
- **The preferred alternative was priced at $0 while the rejected one was priced
  to the cent.** §8.3's pair requires a 1 CU Neon floor, which is a paid
  always-on compute the draft never mentioned. §6a now says so, and F5 makes it
  a flip condition.
- **The cheapest Redis was never priced.** The draft argued against Memorystore
  at $35.77/month and ignored Upstash's free tier and $10 plan, then compared a
  monthly figure to a per-cohort one. §5 is rewritten.
- **The strongest pro-Redis argument was stated backwards.** The draft called a
  Postgres rate limiter "one round trip on a connection the request has already
  leased". The limiter runs *before* the pool is leased, so a Postgres limiter
  would take a pool client to reject a request. §7 now leads with this.
- **`ensureParticipant` was raised and dropped.** The draft said "hold that too"
  and never returned to it, omitting a one-statement fix that needs no
  dependency. It is now §8 step 1.
- **The first flip condition was self-sealing** — it asked for pool acquire wait
  after setting concurrency equal to pool size, which makes the wait structurally
  near-zero. F1 now takes the measurement before the change.
- Also corrected: "no cache headers on ANY response" (true of the 8 endpoints
  measured, false of the service); an index "turns the aggregates scan into a
  range read" (the cost is a JavaScript projection); a matview described as
  something "Postgres invalidates for us" (it does not); "indexes cost nothing"
  (write amplification on the hottest write path, and `CREATE INDEX
  CONCURRENTLY`); the in-process cache's missing single-flight and its
  divergence across four instances; `jwtKey` billed as "free" when it couples key
  rotation to a redeploy; a p95 subtraction that silently switched floors; and
  "do nothing is strictly better than Redis", which §3.4 had already disproved.

Two of the reviewer's points are **not** accepted and are left as disagreements.
The reviewer argued the document reframes the founder's claim; §4 now answers
both readings and says plainly that reading B was never measured. And it argued
that the conclusion is unearned — after the corrections above the conclusion is
unchanged, because none of the corrected numbers make Redis cheaper than
collapsing `ensureParticipant`, raising the pool, or indexing gallery. What the
corrections did change is the **margin**: §7's rate-limiting case is closer than
the draft admitted, and F4 has no cheaper alternative to try first.

## 11. Sources

Fetched 2026-09-04 unless stated. Code citations are to the private
`rryoung98/ailx-backend` repo at HEAD `ed502d4`.

- Memorystore for Redis pricing (Basic/Standard M1, us-central1) — https://cloud.google.com/memorystore/docs/redis/pricing
- Memorystore for Redis Cluster pricing (`redis-shared-core-nano`, `redis-standard-small`) — https://cloud.google.com/memorystore/docs/cluster/pricing
- Memorystore SLA, Covered Services (Basic Tier absent) — https://cloud.google.com/memorystore/sla
- Google Cloud Free Program (no Memorystore entry) — https://cloud.google.com/free/docs/free-cloud-features
- Cloud Run Direct VPC egress, recommended, no additional VM charges — https://cloud.google.com/run/docs/configuring/vpc-direct-vpc
- Serverless VPC Access connector minimum of 2 instances, no scale-in, billed as VMs — https://cloud.google.com/vpc/docs/serverless-vpc-access
- Compute Engine e2-micro pricing, Iowa — https://cloud.google.com/compute/vm-instance-pricing
- Cloud Run instance lifecycle: not kept idle beyond 15 minutes, may be shut down at any time, no state guarantee — https://cloud.google.com/run/docs/about-instance-autoscaling and https://cloud.google.com/run/docs/tips/general
- Upstash pricing and free-tier limits (256 MB, 500K commands/month, Prod Pack) — https://upstash.com/pricing
- Clerk `verifyToken`, "networkless if the `jwtKey` is provided" — https://clerk.com/docs/references/backend/verify-token
- Clerk rate limits, `GET /v1/jwks` "No rate limit" — https://clerk.com/docs/backend-requests/resources/rate-limits
- Redis eviction: approximated LRU, `noeviction` returns errors on write — https://redis.io/docs/latest/develop/reference/eviction/
- Redis `INCR`, "Pattern: rate limiter", including the INCR/EXPIRE race — https://redis.io/docs/latest/commands/incr/
- Neon connection pooling — https://neon.com/docs/connect/connection-pooling (read 2026-09-02, via `docs/LOAD-TEST.md`)

Not verified, and flagged where used: per-command latency for Memorystore or
Upstash from Cloud Run; GCRA as a distributed rate-limiting algorithm; the row
counts of `share_links`, `responses`, `attempts` and `attempt_decks` in the
staging database.
