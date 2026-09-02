# LOAD-TEST.md — sizing the exam service, and what min-instances would buy

TEN-13. Cloud Run runs `min_instances = 0` in every environment, on purpose. Three things must
exist before that changes: numbers from a real load test, a concurrency figure derived from
per-request memory instead of a default, and a price for each option. This document holds two
of the three. The measurement is not here because it cannot be faked. This document provides
the plan, its thresholds, and the arithmetic that shows which result would justify spending
money.

The findings below were derived on 2026-09-02 by reading `infra/terraform` and
`packages/backend` in the private `ailx-backend` repo, and the browser's own call sites in
this repo. No request was timed. Every latency figure in this file is an estimate and says so.

## 1. What is deployed today

The public repo's `infra/` contains a README. The private repo holds the real configuration in
`infra/terraform`.

| Setting | Value | Decision, or default? |
| --- | --- | --- |
| CPU | 1 vCPU | `variables.tf` default, never overridden |
| Memory | 512 MiB | `variables.tf` default, never overridden |
| `max_instance_request_concurrency` | 80 | `variables.tf` default, and also Cloud Run's own default. This is the guess the issue is about |
| `min_instance_count` (service and revision) | 0 | Decision. Written out in `staging.tfvars`, `resilient-staging.tfvars`, `prod.tfvars.example` |
| `max_instance_count` | 4 | Set in both staging tfvars, so it is a decision, but no measurement stands behind the number |
| Request timeout | 300 s | `variables.tf` default |
| `cpu_idle` | true | Decision. CPU is throttled between requests |
| `startup_cpu_boost` | true | Decision, taken to blunt the cold start |
| Startup probe | `GET /livez`, 2 s delay, 5 s period, 10 failures | Decision. Not `/healthz`, which the Google Front End intercepts |
| `AILX_PG_POOL_MAX` | 3 | Default (`DEFAULT_POOL_MAX`, `services/api/src/context.ts`). Not set in any tfvars |
| Neon endpoint | pooled (`-pooler`) | Decision, `infra/terraform/README.md` section 10 |
| Neon autosuspend | 5 minutes | Neon's default. It lives in the Neon console, so Terraform cannot assert it |

That table sets two ceilings. Both come from defaults.

**Postgres connections: 12.** Multiply `AILX_PG_POOL_MAX` (3) by `max_instances` (4). Neon's pooled
endpoint accepts 10,000 client connections globally, and the number that may hold a transaction
at once is `0.9 x max_connections`, which moves with the compute size: 104 direct connections at
0.25 CU (93 slots), 209 at 0.5 CU (188), 419 at 1 CU (377), 839 at 2 CU (755)
(neon.com/docs/connect/connection-pooling, read 2026-09-02). Twelve fits at every size. Neon
pooling is not what breaks first. The load test should confirm that rather than discover it.

The compute size is a floor, not a constant. **No repository records it.** Terraform holds
only `DATABASE_URL` as a secret; the plan, the autoscale range and the autosuspend setting live
in the Neon console. Free and Launch autoscale up from 0.25 CU, so 93 is what a cold database
offers a spike. Read the console before trusting any figure derived from 377. Section 8 does the
arithmetic at the conservative floor instead.

**In-flight requests: 320.** Multiply concurrency (80) by `max_instances` (4). Above that Cloud Run
queues, and Google publishes exactly one number about the queue: a request pends for up to 3.5
times the average instance startup time, or 10 seconds, whichever is greater
(cloud.google.com/run/docs/tips/general, read 2026-09-02). Then the caller gets a 429.

### 1.1 The concurrency number is wrong, and the code already proves it

`withApiContext` (`services/api/src/context.ts`) checks out **one pool client per request and
holds it for the whole handler**. The pool's `max` is 3. So an instance can serve 3
database-touching requests at once. The 4th waits on `connectionTimeoutMillis` and fails after
10 seconds with a generic 500.

Cloud Run may put 80 requests on that instance. The gap between 80 and 3 creates a queue with a
10-second fuse.

Nor does the autoscaler rescue the instance early. Metrics-based scaling "sets a 60% threshold
for CPU utilization and request concurrency targets", and "at lower instance counts, the
autoscaler might wait longer to scale" (cloud.google.com/run/docs/about-instance-autoscaling,
read 2026-09-02). At concurrency 80 that is roughly 48 average concurrent requests over a
minute before a second instance is asked for. The pool wall is at 3. Requests 4 to about 48
fail on one instance while the autoscaler sees a revision that is not busy yet. Staging has not
failed because it receives only a handful of requests at a time.

The reading found the main defect: **concurrency and `AILX_PG_POOL_MAX` are one setting written
in two places, and they currently disagree by a factor of 26.** Any load test that does not push past 3 concurrent requests per
instance will measure nothing.

## 2. The paths that matter

Ordered by what a failure costs a candidate. Round-trip counts are read off the handlers.
Timings are estimates; that is what the load test is for.

### 2.1 The sitting path (first)

During a run, the browser makes these calls from `apps/web/lib/persistence.ts` and
`apps/web/lib/hostedDeck.ts`:

| Request | Blocking for the candidate? | DB round trips | Peak memory |
| --- | --- | --- | --- |
| `POST /v1/attempts` | yes, at run start | ~10 (participant upsert, then a transaction with one insert per deck) | small |
| `GET /v1/attempts/:id/items` | yes, before T2 starts | 4-5 | one redacted deck, tens of KB |
| `GET /v1/attempts/:id/track/:trackId` | yes, before T1/T3/T4 starts | 4-5 | one form, tens of KB |
| `POST /v1/attempts/:id/responses` | **no** | 6-7, including `SELECT ... FOR UPDATE` on the attempt row | one log entry, capped at 1 MiB by the body limit |
| `POST /v1/attempts/:id/transcripts` | no | 6-7 | small |
| `POST /v1/attempts/:id/t3/assist` | yes, inside a timed turn | 8-9 | small |
| `POST /v1/attempts/:id/finalize` | yes, at the end | ~5 | small |
| `POST /v1/attempts/:id/score` | yes, at the end | 5-6, one of them a sequential scan of `judgments` (no index on `attempt_id`) | small |

Three facts determine how to load-test this path.

**No route calls a model.** The judging jury uses `pnpm judge`, an offline CLI
(`services/api/src/judge.ts`), and `judging/index.ts` says it is the only place in the service
that calls a model. The T3 assistant is instrument-driven and deterministic. So no request on
the sitting path waits on an LLM, and the load test needs no model stub. Wall-clock per request
includes only database round trips and JSON.

**The response mirror is not blocking.** localStorage is the synchronous source of truth for
the running tab. `ServerMirror` posts entries in the background, one at a time, and retries on
the next save. A slow or cold server delays when an answer is *stored*, never what the answer
*says*. Every timing that reaches a score is measured on the client (`clientTs`, `latencyMs`),
and `score()` is pure, so server latency cannot inflate or deflate a score. That is asserted in
`infra/terraform/README.md` section 10 and it holds.

**One request per log entry.** The mirror posts exactly one `POST /responses` for each session-log
entry, plus one `POST /attempts` at the start and one `POST /finalize` at the end. That ratio is
pinned by a test in `apps/web/test/persistence.test.ts` because the cost model in section 4
depends on it. A full sitting has 120 timed T2 items and a 12-item provenance block
(AILX-Spec-2026.1.md section on T2), plus T1, T3 and T4 activity, so **250 requests per sitting
is the working estimate**. A practice drill is roughly 25.

**Needs measurement:** wall-clock p50/p95/p99 for `POST /responses` under concurrency, the same
for `POST /attempts` (the heaviest transaction on the path), and resident memory per instance
while a sitting runs.

### 2.2 Finalize, score and credential (second)

`POST /finalize` takes five round trips and is cheap. `POST /score` runs the pure `score()` in
process. `POST /credential` and `POST /share` each read **the whole mirrored event log for the
attempt** (`SELECT payload FROM responses WHERE attempt_id = $1 ORDER BY seq`), `JSON.parse`
every row and project it in memory. Peak memory scales with the log, so it scales with the
number of items the candidate answered. Estimate: a few hundred KB live per request for a full
sitting. It is small, but it is the only read whose memory grows with a candidate's own behaviour.

**Needs measurement:** `POST /credential` latency and memory against a real full-length log, not
a fixture with ten entries.

### 2.3 Read paths behind the report and the gallery (third)

These paths slow as data accumulates.

- `GET /v1/aggregates` has no index it can use for `payload->>'type'`, so it is a full
  sequential scan of `responses` and a sort, plus a full scan of `attempt_decks`, plus a full
  scan of `attempts`, plus three counts. No cache. Cost grows with total platform history, not
  with the request. Treat it as the worst case in any mix.
- `GET /v1/progress`, `POST /v1/practice/:id` and `POST /v1/practice/claim` run the same
  unindexed payload-type predicate scoped to one participant, and `attempts` has no index on
  `participant_id`.
- `GET /v1/gallery` pages with `LIMIT/OFFSET` over `share_links` with no supporting index, so
  it is a scan plus a sort that gets worse deep in the list.
- `GET /api/site/:digest/*` costs one indexed SQL lookup plus **two object-store GETs per
  asset**, and re-parses the manifest every time. A 30-asset site is 30 requests and 60 GETs.

**Needs measurement:** `/v1/aggregates` p95 at a realistic table size. This is the number most
likely to be embarrassing, and it is the cheapest to fix (one expression index).

### 2.4 T1 upload (fourth, and it sets the memory limit)

`POST /v1/attempts/:id/site` takes a ZIP body capped at 25 MiB. The handler buffers the body,
copies it into one contiguous array, inflates and holds every entry at once, then writes each
file to the object store in a sequential PUT. Estimate for a maximum-size upload:
**about 75 MiB of live buffers for one request**, plus up to 501 external PUTs inside the
request.

That number, not the sitting path, is what should set memory and concurrency. Four concurrent
maximum-size uploads is about 300 MiB of live buffers, 59% of a 512 MiB instance before the
Node baseline is counted. The baseline has never been measured. A Cloud Run OOM kills the
instance and every request on it, so the headroom is the whole point. The direct-to-blob upload path that would avoid this returns
501 in this deployment (`makeUploadStaging` returns null), so today every large T1 site goes
through the function body.

**Needs measurement:** peak RSS for one 25 MiB upload, then for two and four concurrently. This
measurement decides the concurrency setting.

## 3. The load test somebody can run

### 3.1 Where it runs, and the seeding problem

Every sitting appends rows. `responses` and `transcripts` are append-only by invariant, so a
load test does not clean up after itself by design. It runs against a **throw-away
`services/api` from the private repo, on a disposable Neon branch**, and never against staging.

`AILX_E2E_API_BASE` already exists for exactly this reason and has no default
(`apps/web/e2e/service.ts`): guessing localhost makes a suite that seeds nothing look green,
and guessing staging writes rows into a database people demo from. The load harness must take
the same variable with the same rule. **It must never point at a staging or production origin.**

Cleanup is a dropped Neon branch, not a `DELETE`. Create a branch from the schema, point
`DATABASE_URL` at it, run the test, read the numbers, drop the branch. Nothing else is safe
against an append-only store, and the branch also gives the test a compute of its own so the
run cannot contend with anything else.

The harness belongs in the private repo next to `services/api`, because cleanup needs the
database and the seeding needs an auth mode. It is deliberately not in this repo: a second
reader of the target-origin rule here would be a second place for it to rot.

### 3.2 Tool

k6. It reports p50/p95/p99 natively, it holds a scenario mix in one file, and its thresholds
are declared up front and fail the run, which is the point of section 3.5. Any tool that can do
those three things is fine. Do not use the Playwright suite: it measures a browser, and a
browser is the wrong instrument for a server's tail latency.

Run k6 from a machine outside GCP, or from a VM in `us-central1`. Say which, because the choice
moves p50 by the round-trip time and the two numbers are not comparable.

### 3.3 Scenarios and mix

Six scenarios. The mix is weighted by what real traffic looks like during a campaign, where
most people take a practice drill and few sit the full exam.

Weight the scenarios by REQUESTS, not by iterations. One `sitting_write` iteration is 252
requests and one `report_read` iteration is three, so equal iteration rates give a mix nothing
like the table below.

| Scenario | Share of requests | What it does |
| --- | --- | --- |
| `sitting_write` | 60% | Create an attempt, then post 250 log entries at a realistic pace, then finalize |
| `sitting_read` | 15% | `GET /items`, `GET /track/:id`, `GET /attempts/:id` |
| `practice` | 15% | `POST /v1/practice`, then `POST /v1/practice/:id`, which also pays the progress read |
| `report_read` | 5% | `GET /v1/progress`, `GET /v1/share/:token`, `GET /v1/credentials/:code` |
| `aggregates` | 3% | `GET /v1/aggregates`, at 1 request per second, never more |
| `t1_upload` | 2% | `POST /site` with a 1 MiB, a 10 MiB and a 25 MiB ZIP |

Run `aggregates` and `t1_upload` as separate isolated runs as well as in the mix. Both are
capable of hiding every other number in the report, and you want to know their cost alone
before you see it blended.

### 3.4 Ramp and duration

Four stages, one run, about 40 minutes.

1. **Warm-up, 2 min.** `GET /livez` at 1 rps. No database, no auth. It proves the harness and
   the target agree before anything is measured.
2. **Cold start probe, a run of its own, about 2.5 hours.** Scale the service to zero, wait
   past the Neon 5-minute autosuspend, then send one `POST /v1/attempts` and record the full
   wall clock. Repeat 20 times. Each sample costs its own idle wait, so 20 samples is over 100
   minutes plus scale-down and startup; it does not fit inside a 40-minute mixed run and should
   not be attempted there. This is the number the whole min-instances decision turns on, and it
   needs a distribution, not one sample.
3. **Steady state, 20 min.** Ramp virtual users 0 to 50 over 5 minutes, hold 50 for 15. Fifty
   VUs against `concurrency x max_instances` is deliberately modest: with the pool at 3 the
   service can serve 12 database requests at once, so 50 concurrent VUs already tests the queue.
4. **Spike, 10 min.** Jump to 300 VUs for 2 minutes, then back to 50. Three hundred is just
   under the 320 in-flight ceiling, so this is the test of the queue and the 429 behaviour, not
   of throughput.

### 3.5 What to record

Per scenario: p50, p95, p99, maximum, error rate by status code, and requests per second.

From Cloud Run metrics over the same window: `container/instance_count` (split by active and
idle), `container/memory/utilizations` (record the **high-water mark per instance**, not the
mean), `container/cpu/utilizations`, `request_count` by response code, and
`container/startup_latency` for the cold start probe.

From Neon over the same window: open connections, pooler `cl_active` and `cl_waiting`, and
compute time in CU-hours for the run.

From the application: count of 500s whose cause is a pool `connectionTimeout`. That number
should be zero, and if it is not, the concurrency setting is the reason.

### 3.6 Pass and fail, decided now

Declare these as k6 thresholds so the run fails on its own. Deciding them after seeing the
numbers is how a load test becomes a rubber stamp.

| Metric | Pass | Why this number |
| --- | --- | --- |
| `POST /responses` p95, steady state | < 400 ms | The mirror is asynchronous, so this is about keeping the queue drained, not about the candidate waiting |
| `POST /responses` p99, steady state | < 1,000 ms | |
| `POST /attempts` p95 (warm) | < 800 ms | The candidate waits for this one before the run starts |
| `GET /items` p95 (warm) | < 500 ms | The candidate waits for this before T2 starts |
| `POST /t3/assist` p95 | < 700 ms | Inside a timed turn. See section 5 for why this one is not just an annoyance |
| Cold start, `POST /attempts`, p95 | **record it** | No pass mark. This is the input to the min-instances decision, and Google publishes no baseline to compare against |
| `GET /v1/aggregates` p95 | < 3,000 ms | It is an operator page. If it fails, add the expression index rather than buying instances |
| Error rate, steady state | < 0.1%, and **zero** pool timeouts | A pool timeout is a configuration bug surfacing as a 500 |
| Error rate, spike | 429s allowed, 500s not | Shedding load is correct. Failing under it is not |
| Peak instance memory | < 80% of the limit | Cloud Run kills the whole instance on OOM, taking every in-flight request with it |
| Neon pooler `cl_waiting` | 0 | Anything else means the connection ceiling arrived earlier than the arithmetic in section 1 says |

## 4. What each configuration costs

Rates fetched 2026-09-02 from cloud.google.com/run/pricing and neon.com/pricing.
Cloud Run, us-central1, request-based billing (`cpu_idle = true`), which is what is deployed:
CPU $0.000024 per vCPU-second active and $0.0000025 idle, memory $0.0000025 per GiB-second,
requests $0.40 per million. Free tier per billing account per month: 180,000 vCPU-seconds,
360,000 GiB-seconds, 2,000,000 requests. Whether that free tier covers min-instance **idle**
seconds is not published; the arithmetic below assumes it does not.

### 4.1 Serving is free at every traffic level we can foresee

Assumptions: 250 requests per sitting (section 2.1), 25 per practice drill, and a 60 ms mean request
duration. Request-based billing charges CPU and memory for the time a request is being
served, so duration is the billed unit, not CPU work. **The 60 ms is an estimate and it is
the weakest number in this document.** The load test replaces it.

| Level | Requests/month | vCPU-seconds | Cost before free tier |
| --- | --- | --- | --- |
| Pilot cohort, 45 sittings (worked example; docs/BUDGET.md) | 11,250 | 675 | $0.02 |
| Steady, 1,000 sittings + 2,000 drills | 300,000 | 18,000 | $0.57 |
| Campaign, 10,000 users (TEN-20): 4,000 drills + 500 sittings | 225,000 | 13,500 | $0.43 |

All three sit inside the free tier with room to spare. The steady level is the tightest, at 10x
headroom on CPU-seconds and 7x on requests. Put the other way: the mean request would have to
take longer than 600 ms before 1,000 sittings a month leaves the free tier.

The campaign level assumes the funnel in TEN-20 and it assumes the landing page stays on the
static export. That matters more than it looks: the landing page is served by GitHub Pages or
Vercel, so a post that sends 5,000 people to the site in an hour does not touch Cloud Run at
all. Only people who start a drill or a sitting reach the service.

**So the exam service's bill is not made of traffic. It is made of idle.**

### 4.2 What min-instances costs

One warm instance at 1 vCPU and 512 MiB, billed at the idle rate:
`2,592,000 s x 1 vCPU x $0.0000025` plus `2,592,000 s x 0.5 GiB x $0.0000025`.

| Configuration | Cost per month |
| --- | --- |
| `min_instances = 0` (today) | **$0** |
| 1 warm instance, always | **$9.72** ($6.48 CPU + $3.24 memory) |
| 1 warm instance, 14-day campaign window only | **$4.54** |
| 1 warm instance, 12 hours a day for 14 days | **$2.27** |
| 2 warm instances, always | **$19.44** |
| 2 warm instances, 14-day campaign | **$9.07** |

For contrast, the same instance under instance-based billing (`cpu_idle = false`) would be
$46.66 a month for CPU alone. Keeping `cpu_idle = true` is worth roughly 7x on the idle bill,
and it is already set.

### 4.3 "min-instances on the sitting path only" is not a thing you can buy

The issue guesses that warm capacity is justified only on the sitting path. The reading says
that guess is right about the priority and wrong about the mechanism: **min-instances is a
property of a Cloud Run service, not of a route.** All 42 routes live in one service
(`services/api/src/app.ts`). Warming the sitting path alone means splitting the service in two
and putting a load balancer in front to route by path.

That is a second deployment unit, a second image to keep in step, a second set of secrets and
IAM, and a load balancer, in order to avoid at most $9.72 a month of idle. It is not worth it.
If warm capacity is bought, it is bought for the whole service.

### 4.4 The database has to be warm too, and it costs more than the service

A warm Cloud Run instance does not keep Neon awake. The pool sets `idleTimeoutMillis` to 10
seconds and `allowExitOnIdle`, so connections close in the quiet, and Neon autosuspends after 5
minutes of no connections. The first query then pays a compute wake, a few hundred milliseconds
by Neon's own description.

| Configuration | Cost per month |
| --- | --- |
| Neon Free, autosuspend 5 min, cannot be disabled | $0, and 100 CU-hours per project |
| Neon Launch, 0.25 CU, autosuspend off, always on | **$19.34** (182.5 CU-hours x $0.106) |
| Neon Launch, 0.25 CU, always on for a 14-day window | **$8.90** |
| Neon Scale, 0.25 CU, always on | $40.52 |

So the honest price of "no cold start anywhere on the sitting path" is about **$29 a month**
($9.72 Cloud Run plus $19.34 Neon), not $9.72. Buying only the Cloud Run half removes the
container start and leaves the database wake, which is the smaller half of the delay but not
nothing. Buy them together or do not buy them.

## 5. What a cold start actually costs a candidate

Google publishes no cold start latency figures. None. The only published number is the queueing
rule quoted in section 1. So the estimate below is an estimate, and the load test's stage 2
exists to replace it.

Estimated first-request cost after full idle, from the code: node boot and module graph, then
on the first request a JWKS fetch for Clerk (about 100 to 300 ms), a Neon compute wake (a few
hundred ms), a first pool connect, and a 420 KB read plus parse of the instrument snapshot
(10 to 40 ms). **Estimate: 1 to 3 seconds.** Nothing at module load is heavy, which is why the
estimate is not worse.

Where that lands:

- **The gallery, the report, a shared card.** Annoying. A share link that takes 2 seconds to
  open loses some clicks. It is a conversion cost, not a measurement cost, and TEN-20's funnel
  will show it if it matters.
- **The start of a sitting.** `POST /v1/attempts` is blocking and it is the first request, so
  it eats the cold start every time. A 3-second wait before an exam starts is bad but honest.
- **Inside a timed turn.** This is the one that is not just annoyance. T2 items are shown under
  a fixed exposure and T3 runs against a clock, and the evidence base is explicit that a clock
  changes behaviour: reliance on AI advice rose from M = 0.48 to M = 0.54 under time pressure
  (t(27) = 2.55, p = 0.017) and accuracy fell, in Rosbach et al. 2026, MELBA
  doi:10.59275/j.melba.2026-87b1 (`ailx-backend/docs/EVIDENCE-RELIABILITY-AND-TIME-PRESSURE.md`
  section B2). Swaroop et al. 2023 (arXiv:2306.07458) found a visible timer keeps people fast
  and costs accuracy later in a session. A server stall inside a timed turn adds pressure the
  instrument did not design in, to some candidates and not others.

Two things keep that from being a score-validity emergency today. `POST /responses` is
asynchronous, so a stall there is invisible to the candidate. And every timing that reaches a
score is measured on the client, so a slow server cannot move a number. The exposure is
`POST /t3/assist`, which is blocking, inside a timed turn, and the only sitting request where
the candidate watches a spinner and the clock at the same time.

## 6. The recommendation, and what would change it

Nothing in `infra/` changes on the strength of this document. These are conditional, and each
condition is a number the load test produces.

**1. Set concurrency from the pool, first, and before anything else.** Concurrency 80 against
`AILX_PG_POOL_MAX` 3 is not a tuning choice, it is a 10-second queue. Two coherent options:

- Raise the pool and lower concurrency to meet it. `AILX_PG_POOL_MAX = 6` with
  `concurrency = 8` gives an instance 6 concurrent database requests and room for the cheap
  non-database ones (`/livez`, CORS preflight). At `max_instances = 20` that is 160 in-flight
  requests and 120 Postgres connections, which is 32% of a 1 CU Neon compute's 377 transaction
  slots. Comfortable.
- Or leave the pool at 3 and set `concurrency = 4`, which needs `max_instances` around 40 to
  serve the same traffic and costs more cold starts.

Prefer the first. Decide it on the measurement in section 3.5: if the run records **any** pool
`connectionTimeout` 500 at 50 VUs, the current pair is already broken in staging.

**2. Set memory from the T1 upload, not from the sitting path.** If peak RSS for a single
25 MiB upload measures above 150 MiB, either raise memory to 1 GiB or cap concurrency at
`floor((limit - baseline) / peak)`, whichever the cost model prefers. Memory is the cheap
half of the bill: while `min_instances` is 0 a bigger limit costs nothing at all, and it
costs $3.24 a month per warm 512 MiB if warm capacity is ever bought. Raising memory is
usually the better trade than shrinking concurrency to 2.

**3. Keep `min_instances = 0` outside a campaign.** At tens of sittings a month, warm capacity buys
a candidate one or two seconds a few times a day for $9.72 plus $19.34 of always-on Neon. That
is a bad trade and it should stay a bad trade until someone measures otherwise.

**4. Buy warm capacity for a campaign window only, and only if the measurement says so.**
If the stage-2 probe records a **p95 cold start above 3 seconds on `POST /v1/attempts`**, then
for the TEN-20 campaign set `min_instances = 1` and disable Neon autosuspend for the campaign
window only, at **$4.54 (Cloud Run) + $8.90 (Neon Launch, 14 days) = $13.44**. Revert both when
the window closes. If p95 comes in under 3 seconds, do not buy it: at that point the cold start
is smaller than the variance in a candidate's own device and network.

Two seconds is the threshold I would use if the campaign carried scored sittings rather than
practice drills, because of the time-pressure evidence in section 5. Say which kind of traffic
the campaign is before applying the threshold.

**5. Do not buy instances to fix `/v1/aggregates`.** If its p95 exceeds 3 seconds, add an
expression index on `payload->>'type'` and an index on `attempts.participant_id`. An index is
free and permanent. An instance is rented.

## 7. What this document could not measure

Said plainly, so nobody cites an estimate as a measurement.

- Every latency in this file is an estimate derived from round-trip counts. No request was
  timed against a deployed service.
- Peak RSS for the T1 upload path (about 75 MiB) is arithmetic over the buffer sizes in the
  code, not a reading from a running instance.
- The 60 ms mean request duration in the section 4 cost model is a guess. It is the number the load test
  most needs to replace, and every dollar figure for serving moves with it.
- Cold start p50/p95 is unknown, and Google publishes nothing to compare it against.
- Whether Cloud Run's free tier covers min-instance idle seconds is not published. Section 4.2
  assumes it does not, which is the conservative direction.
- The Neon autosuspend setting is not in any repository. Read it in the Neon console, or with
  `GET /projects/<id>` and `suspend_timeout_seconds`, before trusting section 4.4.

## 8. The concurrency setting, decided

TEN-44. Section 1.1 found the defect by reading. This section prices the two ways out, records
which pair the repository carries, and adds the check that stops the pair drifting apart again.
Nothing here is applied: the values are Terraform variables in the private repo and this
repository cannot deploy. What it can do is hold the arithmetic and go red when the arithmetic
stops working.

### 8.1 The rule, and why both options in the issue break it

**`concurrency` may not exceed `AILX_PG_POOL_MAX`.** That is Google's own rule, not an invention
here: set a code-level concurrency limit, then "set the Cloud Run concurrency to a value equal
to or less than" it (cloud.google.com/run/docs/tips/general, read 2026-09-02). Every route goes
through `withApiContext`, so the pool IS the code-level limit.

The issue proposed pool 6 with concurrency 8, and pool 3 with concurrency 4. Both leave a gap on
the argument that the spare slots go to requests that never touch the pool — `GET /livez`, the
startup probe, a CORS preflight. Nothing enforces that. Cloud Run does not know which request is
which, so eight database requests can land on a six-client pool and two of them wait ten seconds
and 500. It is the same bug, two orders of magnitude smaller, and it would be found by the same
reading. So the numbers below close the gap instead of shrinking it.

### 8.2 What the two options cost

| | Option 1: raise the pool | Option 2: lower concurrency |
| --- | --- | --- |
| `AILX_PG_POOL_MAX` | 8 (issue said 6) | 3 (unchanged) |
| `concurrency` | 8 | 3 (issue said 4) |
| `max_instances` | 20 | 40 |
| `memory` | 1Gi, forced | 512Mi (unchanged) |
| Requests in flight at the ceiling | 160 | 120 |
| Postgres connections at the ceiling | 160 | 120 |
| Instances for 120 requests | 15 | 40 |
| Neon compute floor required | 1 CU | 0.5 CU |

Serving cost separates them by nothing. At the steady level in section 4.1 (300,000 requests a
month, 60 ms mean) option 1's 1 GiB doubles the memory half to 18,000 GiB-seconds against a
360,000 free tier: $0.045 a month if it were billed at all. Neither option touches
`min_instances`, which stays 0, so neither buys idle. The differences are these three.

**Option 1 forces the memory limit up, and the issue does not say so.** The heaviest request is
a maximum-size T1 upload at an estimated 75 MiB of live buffers (section 2.4). Eight of those is
600 MiB and a 512 MiB instance cannot hold them. Cloud Run's guidance with the same setting is
"match memory to concurrency". One vCPU is allowed 512 MiB to 4 GiB
(cloud.google.com/run/docs/configuring/services/memory-limits, read 2026-09-02), so 1 GiB is
available. It costs nothing while `min_instances` is 0 and $3.24 a month per warm instance
afterwards (section 4.2 rates), which is the price a campaign would pay under section 6 point 4.

**Option 2 pays roughly twice the cold starts.** An instance covers 3 requests instead of 8, so
the same burst starts about 2.7 times as many containers, each an estimated 1 to 3 seconds
(section 5) and each opening its own Neon connections. Cloud Run keeps an idle instance up to 15
minutes (cloud.google.com/run/docs/about-instance-autoscaling, read 2026-09-02), so the cost is
paid per instance per quiet period rather than per request — but it is paid on a path that
includes `POST /t3/assist` inside a timed turn, where section 5 says a stall is not just an
annoyance.

**The Neon compute floor is a requirement, not a preference, and no repository records it.**
Neon's pooler allows `0.9 x max_connections` clients to hold a transaction at once, and
`max_connections` moves with the compute: 104 at 0.25 CU (93 slots), 209 at 0.5 CU (188), 419 at
1 CU (377). Option 1's 160 connections need 1 CU. Option 2's 120 need 0.5 CU. Past the limit a
client waits and then fails with `query_wait_timeout` after two minutes, which is a worse
failure than the ten-second one this issue is about. Terraform holds only `DATABASE_URL`; the
plan and the autoscale floor live in the Neon console. **Read it before applying either option.**
Free and Launch autoscale up from 0.25 CU, and at that floor there are 93 slots: cap
`max_instances` at 11 under option 1 or 31 under option 2.

Section 3.4 sizes its spike stage against the in-flight ceiling of 320 that concurrency 80 and
`max_instances` 4 give today. Under option 1 that ceiling is 160 and under option 2 it is 120.
Re-read stages 3 and 4 against the pair actually deployed before running them.

### 8.3 The sizing this branch carries

The numbers the check reads. Change them here and the check re-runs on the new pair.

| Setting | Value | Where it is applied |
| --- | --- | --- |
| `AILX_PG_POOL_MAX` | 8 | `run.tf` runtime env, from a new `pg_pool_max` variable |
| `concurrency` | 8 | `max_instance_request_concurrency` |
| `max_instances` | 20 | `max_instance_count` |
| `memory` | 1Gi | the service and the migration job |
| `neon_min_compute_cu` | 1 | the Neon console. Not in any repository |

This is **option 1**. The commit before it carries option 2 (pool 3, concurrency 3,
`max_instances` 40, memory 512Mi, Neon floor 0.5 CU); revert this one commit to take that
instead. Option 1 is the branch's final state because section 6 already preferred it and the
costing did not overturn that: it pays fewer cold starts, and its price is $3.24 a month per
warm instance that nobody is buying today. That is a preference, not a decision. The human
picks. What is not open is leaving `concurrency` at 80 against a pool of 3.

### 8.4 The check, in both repositories

The two numbers live in different repositories, which is why neither repository could see the
gap. Neither half of the check is optional, and neither half is sufficient.

**Here.** `packages/core/test/serviceSizing.test.ts` reads the table in section 8.3 and asserts
that `concurrency` does not exceed `AILX_PG_POOL_MAX`, that `AILX_PG_POOL_MAX x max_instances`
fits Neon's pooler at `neon_min_compute_cu`, that `concurrency x 75 MiB` fits inside 80% of the
memory limit, and that the memory limit is one 1 vCPU may have. It checks a decision this
repository wrote down. It cannot see Terraform and does not claim to.

**There.** Terraform does not set `AILX_PG_POOL_MAX` at all today, so it cannot compare anything.
Give it the number, then make it check:

```hcl
variable "pg_pool_max" {
  description = <<-EOT
    AILX_PG_POOL_MAX. withApiContext checks out one pool client per request and
    holds it for the whole handler, so this is the instance's real request
    concurrency and var.concurrency may not exceed it.
  EOT
  type        = number
  default     = 8
}

variable "concurrency" {
  type    = number
  default = 8

  validation {
    condition     = var.concurrency <= var.pg_pool_max
    error_message = "concurrency exceeds AILX_PG_POOL_MAX: the surplus requests 500 after the 10s pool acquire timeout, and Cloud Run's autoscaler does not react until average concurrency reaches 60% of the limit."
  }
}
```

`run.tf` then adds `{ name = "AILX_PG_POOL_MAX", value = tostring(var.pg_pool_max) }` to
`local.runtime_env`, and `tests/config.tftest.hcl` gets a case that expects the validation to
reject the old pair. Until that lands the deployed service still runs concurrency 80 against a
pool of 3.

### 8.5 What neither option fixes

A bigger pool moves the wall. It does not change the shape of the thing that hits it: **a
handler holds its pool client across an await on something that is not the database.** Two
routes in the private repo do that today.

- `handleGithubExport` (`packages/backend/src/t1/export.ts`). It runs inside `withApiContext`,
  so it holds a client while it calls github.com to redeem the device code and then pushes every
  file of the candidate's site. The request timeout is 300 seconds. One slow GitHub call holds
  one of an instance's few clients for as long as GitHub takes.
- `recordSiteSubmission` behind `POST /v1/attempts/:id/site`
  (`packages/backend/src/t1/handlers.ts`). It holds a client across `ctx.snapshots.put`, which
  is up to 501 sequential object-store PUTs (section 2.4).

Three such requests starve an instance under option 2 and eight under option 1. Both numbers are
reachable at the end of a T1 session, and under either option the instance's other requests fail
while the pool waits on a third party.

No route calls a model, so the worst version of this shape does not exist yet: judging runs from
the offline `pnpm judge` CLI (section 2.1). Phase 4 is where it would arrive, and it should not
arrive holding a pool client.

The fix is to release the client before the external call and take a new one after, or to move
the external work off the request. That is a change to handlers in the private repo. It is not
this issue, and it is the one that stops the next version of this bug.
