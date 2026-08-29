# DEPLOY.md — hosted AILX (Vercel serverless)

The default build is unchanged: `pnpm -r build` with no `AILX_BACKEND` produces
the GitHub Pages **static export** (`output: "export"`, no API surface, no
database). Everything here is the *other* mode — `AILX_BACKEND=1`, real route
handlers, Postgres, and stored T1 sites — deployed to Vercel as a staging site
instead of `next start` behind ngrok.

- Project root directory: `apps/web` (its `vercel.json` installs and builds
  from the repo root, so workspace packages are built first).
- Runtime: Node (the handlers use `pg`, `node:zlib` and `node:crypto`; nothing
  may be moved to the Edge runtime).
- The `services/openrouter-proxy` Vercel project is separate and unaffected.

## 1. Environment variables

Set these on the Vercel project (Production and Preview alike). There are no
silent defaults for the ones marked **required**: the app refuses to start
rather than guess.

| Variable | Required | What it does |
| --- | --- | --- |
| `AILX_BACKEND` | **yes** (`1`) | Compiles `route.api.ts` / `page.api.tsx` into real routes and drops `output: "export"`. Without it you deploy the static export and every API path 404s. Set at build time (`vercel.json` does this) and in the dashboard. |
| `AILX_AUTH` | **yes** | `clerk` or `dev`. No default — see §4 before you pick. |
| `CLERK_SECRET_KEY` | with `AILX_AUTH=clerk` | Clerk instance secret; JWTs are verified locally against the JWKS. |
| `DATABASE_URL` | **yes** | Postgres. **Use the Neon POOLED endpoint** — see §3. |
| `AILX_PG_POOL_MAX` | no (default 3) | Clients per warm instance. Cluster-wide connections are `instances x max`; keep it small. |
| `AILX_PUBLIC_ORIGIN` | **effectively yes** | The origin browsers reach, e.g. `https://ailx-staging.vercel.app`. Baked into the served-site CSP allowlist and the bare-digest 308. Vercel terminates TLS in front of the function, so without this the CSP and redirects can point at the internal origin. Absolute http(s) origin, no path. |
| `AILX_TRUST_PROXY` | no | Fall back to `x-forwarded-*` when `AILX_PUBLIC_ORIGIN` is unset. Prefer setting the origin explicitly. |
| `AILX_SNAPSHOT_STORE` | **yes on Vercel** (`blob`) | `fs` (default) stores T1 sites on the local disk — correct locally, WRONG on serverless (see §2). `blob` uses Vercel Blob. |
| `BLOB_READ_WRITE_TOKEN` | with `AILX_SNAPSHOT_STORE=blob` | Injected automatically when a Blob store is linked to the project. |
| `AILX_SNAPSHOT_BLOB_PREFIX` | no (default `t1`) | Key namespace inside the bucket, e.g. `staging`. Two deployments sharing one store must not share a prefix. |
| `AILX_SNAPSHOT_DIR` | only with `fs` | Filesystem root for local/dev snapshots (default `<cwd>/.ailx-snapshots`). |
| `AILX_REVIEWERS` | for gallery review | Comma/whitespace list of `clerk:<sub>` / `dev:<id>` refs allowed to approve or refuse a site-carrying gallery submission. Fails closed: unset means nobody. |
| `AILX_ALLOWED_ORIGINS` | on the PROXY project | Extra CORS origins for `services/openrouter-proxy` (add the staging origin there, not here). |
| `AILX_ALLOW_INSECURE_DEV_AUTH` | never, unless §4 | The only way to run `AILX_AUTH=dev` under `NODE_ENV=production`. |

## 2. T1 site snapshots must not use the filesystem

A Vercel function has a writable `/tmp` that is **per invocation**: a candidate
site uploaded by one request is invisible to the request that serves it, and
gone when the instance is recycled. `AILX_SNAPSHOT_STORE=blob` selects
`BlobSnapshotStore` (`packages/backend/src/t1/storage.ts`), which keeps the
filesystem layout in a bucket:

```
<prefix>/blobs/<file-sha256>          file bytes, deduplicated across snapshots
<prefix>/manifests/<digest-hex>.json  canonical manifest — written LAST
```

Semantics are identical to the filesystem store, and the same test suite runs
against both:

- **Dedup** — keys are content hashes, so identical bytes are stored once.
- **Manifest last** — an object store has no rename, and needs none: each
  object upload publishes completely or not at all, and the manifest is the
  commit marker. An interrupted upload leaves unreferenced blobs and NO
  servable snapshot; the next identical upload dedups onto them and commits.
- **Reachability is unchanged** — bytes are served only while a `responses`
  row records the digest. That gate is in `handleServeSite` and blob storage
  does not weaken it, which is why objects are written with
  `access: "private"`: a public object URL would be a way around the gate for
  anyone who learns a digest.

Selection lives only in `apps/web/lib/server/site.ts`. Do not read a storage
env var anywhere else. A `BLOB_READ_WRITE_TOKEN` alone does not switch stores —
you must ask for `AILX_SNAPSHOT_STORE=blob` — so a token in a local shell can
never redirect a dev server's uploads into the shared bucket.

## 3. Postgres: use the pooled Neon endpoint

Each warm instance keeps its own `pg` Pool, so connections scale with
instances. Neon gives two hostnames; the deployment must use the **pooler**:

```
# right — pooled (note "-pooler")
postgresql://user:pw@ep-xxx-pooler.<region>.aws.neon.tech/ailx?sslmode=require
# wrong on serverless — direct endpoint, exhausted after a few cold starts
postgresql://user:pw@ep-xxx.<region>.aws.neon.tech/ailx?sslmode=require
```

`poolConfig` in `apps/web/lib/server/api.ts` sets `max: 3`, a 10 s idle
timeout and `allowExitOnIdle`, so a frozen instance stops holding a session it
cannot use. Transactions still check out ONE client per request
(`withTransaction` on a pool proxy would be meaningless), which the pooler
supports in transaction mode.

Apply `db/schema.sql` to the staging database once, before the first deploy.

## 4. Auth on a hosted staging site — read this

`AILX_AUTH=dev` accepts an **asserted** identity: `x-ailx-dev-user: alice` is
enough to *be* alice. On localhost that is convenient. On a URL anyone can
reach it means anyone can impersonate any participant, read their attempts,
and submit as them. That is why `AILX_AUTH=dev` refuses to start under
`NODE_ENV=production` unless `AILX_ALLOW_INSECURE_DEV_AUTH=1` is also set —
and a Vercel deployment is always `NODE_ENV=production`.

**Recommendation: staging uses `AILX_AUTH=clerk` with `CLERK_SECRET_KEY`.**

Only override this for a throw-away deployment that holds no real participant
data, that you will delete, and whose URL you accept as public. Then set both
`AILX_AUTH=dev` and `AILX_ALLOW_INSECURE_DEV_AUTH=1`, knowing the site has no
authentication at all. Never set that flag on a deployment holding real data.

## 5. Vercel platform limits that bite AILX

- **Request/response body cap (4.5 MB).** `T1_LIMITS.maxTotalBytes` is 25 MB,
  so a large T1 ZIP is rejected by the platform before our handler sees it, and
  an asset over ~4.5 MB cannot be served back through the site route. Staging
  is fine for realistic hand-written sites; do not read a platform 413 as an
  AILX bug. A fix means client-direct upload to Blob, which is not built.
- **Function duration.** Default 10 s (Hobby) / 15 s (Pro) unless raised.
- **No warm process between requests.** Nothing may rely on in-memory state
  surviving a request: no in-memory counters, caches with correctness meaning,
  or work started after the response is returned.

## 6. Deploy

```bash
pnpm -r test && pnpm -r build          # both must pass
AILX_BACKEND=1 pnpm --filter @ailx/web build   # the server build specifically

vercel link                            # root directory: apps/web
vercel env add ...                     # everything required in §1
psql "$DATABASE_URL" -f db/schema.sql  # first deploy only
vercel deploy --prod
```

Smoke test after deploy: load `/`, sign in, start an attempt, upload a small T1
site, and open the served site URL — the last step is the one that proves blob
storage, the reachability gate and `AILX_PUBLIC_ORIGIN` are all right.
