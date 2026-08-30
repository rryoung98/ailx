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

### 4.1 The `ailx_dev_user` cookie

`DevAuthProvider` also accepts the identity as a cookie, `ailx_dev_user`,
which the browser writes itself alongside `localStorage["ailx:dev-user"]`
(one writer: `devUser()` in `apps/web/lib/persistence.ts`). Order of
precedence: `x-ailx-dev-user` header, then `Authorization: Bearer dev:<id>`,
then the cookie — so every scripted caller and the Playwright suite are
unaffected.

It exists because a header can only ride on a `fetch()` the app makes. A
server-rendered page (`page.api.tsx` — `/progress`, `/review`) is reached by
an ordinary document navigation, which carries cookies and nothing else, so
without it `/progress` told every browser "we do not know who you are" while
the same URL fetched with the header rendered the real streak.

What it is **not**: a session. The value is still asserted, never proven; it
is `SameSite=Lax`, `Path=/`, six months, `Secure` over https, and NOT
`HttpOnly` — it cannot be, because the browser mints it. Nothing is protected
by hiding it from script anyway, since anyone may already assert any id under
dev auth. It changes no threat model: `AILX_AUTH=clerk` is still the only
answer for a deployment real participants can reach. localStorage stays the
source of truth — the cookie is only ever written from it, never read back
into it, so a cleared browser cannot be silently re-identified as its
previous occupant. "Forget this browser" on `/progress` clears both.

## 5. Vercel platform limits that bite AILX

- **Request/response body cap (4.5 MB).** `T1_LIMITS.maxTotalBytes` is 25 MB,
  so a large T1 ZIP cannot go through a request body at all, and an asset
  over ~4.5 MB cannot be served back through the site route. Uploads
  above 4 MB take the client-direct path in §5.1 instead; the POST path
  below is what small ones still use, unchanged.

  Measured on staging (6 MB ZIP) before that path existed: the platform
  answers `413` with the plain-text body `Request Entity Too Large /
  FUNCTION_PAYLOAD_TOO_LARGE` — our handler never runs, so there is no
  JSON error envelope and no `responses` row. `uploadSiteZip` still maps
  that case to a `rejected` result carrying `PLATFORM_TOO_LARGE_MESSAGE`,
  which is now the last-resort message for a host with no Blob store
  (`AILX_SNAPSHOT_STORE=fs`), not the normal outcome. Our own 413s — the
  validator's `file_too_large` / `total_too_large` — still arrive as JSON
  and still win, because a parsed server message always replaces the
  platform default.
- **Function duration.** Default 10 s (Hobby) / 15 s (Pro) unless raised.
  Finalizing a direct upload reads the staged ZIP back and re-uploads the
  validated files, so a 25 MB site is the slowest request the app makes.
- **No warm process between requests.** Nothing may rely on in-memory state
  surviving a request: no in-memory counters, caches with correctness meaning,
  or work started after the response is returned.

### 5.1 Client-direct upload to Blob (large T1 sites)

The browser PUTs the ZIP straight into the Blob store and then asks us
to accept it, so the bytes never traverse a function request body:

```
POST /api/attempts/:id/site/upload-ticket   → { uploadId, pathname, token, ... }
PUT  <blob store>/uploads/<attemptId>/<uploadId>.zip   (browser → Blob, scoped token)
POST /api/attempts/:id/site/finalize        { uploadId, seq }
```

Selection is by size and is automatic: `DIRECT_UPLOAD_MIN_BYTES` (4 MB,
`apps/web/lib/siteUpload.ts`). Under it, the single POST is one round
trip and stays exactly as it was. Over it, the client asks for a ticket;
if the deployment has no Blob store the ticket endpoint answers `501`
and the client falls back to the POST, so `AILX_SNAPSHOT_STORE=fs`,
`next dev` and the static export are all unaffected.

**Who authorises.** `/site/upload-ticket` authenticates the caller
through the same `AuthProvider` as every other route and 404s an attempt
that is not theirs (no existence leak). Only then is a ticket minted.
A ticket records nothing and reserves nothing — an unused one expires.

**What the token is scoped to.** The server chooses everything a client
would otherwise choose. The key is
`<prefix>/uploads/<attemptId>/<uploadId>.zip`, where `uploadId` is 128
server-generated random bits, and the client token is issued for exactly
that pathname, `application/zip` only, at most `T1_LIMITS.maxTotalBytes`,
for 15 minutes, with `addRandomSuffix: false` and `allowOverwrite:
false`. So a stolen, replayed or hand-edited grant reaches ONE scratch
key inside the uploader's own attempt — never a content-addressed
`blobs/` object, never a `manifests/` commit marker, never another
attempt. Staged objects are `access: "private"` like every other object
we write.

**How the server validates AFTER the bytes land.** `/site/finalize`
re-checks ownership, reads the staged object back, refuses it from its
metadata if it is over the cap (without buffering it), and then runs the
SAME `snapshotFromZip` a POSTed ZIP runs — zip bombs, zip slip,
symlinks, disallowed types and §12 caps are refused by identical code.
The client never names a digest: the digest is computed from the bytes
we read, so nobody can register a snapshot they did not upload. Once
validated, `recordSiteSubmission` runs the unchanged pipeline — the
`responses` row FIRST, the content-addressed bytes second — so the
one-submission-per-attempt index, the append-only store and the
record-before-store ordering are exactly as before.

**What happens to bytes that fail validation.** Nothing is recorded and
nothing is stored under a content address, so the serve path 404s them
(it serves only a digest a `responses` row still points at, and only
from `manifests/` + `blobs/`). The staged object is deleted whether the
submission was accepted or refused; a staged key is never servable even
before that, since `uploads/` is not a namespace `handleServeSite`
reads. A crash between PUT and finalize leaves one private, unreferenced
scratch object that no URL resolves to.

## 6. The build fix this deployment needs (`outputFileTracingExcludes`)

Without it, `vercel build` succeeds and then dies collecting output:

```
Error: ENOENT: no such file or directory, lstat
  '/vercel/path0/apps/web/.next/server/app/api/attempts/[id]/credential/route_client-reference-manifest.js'
```

Nothing is wrong with that route — it is simply the first API entry in
`app-path-routes-manifest.json`. The cause is our `route.api.ts` convention
meeting a gap in Next:

1. `next-trace-entrypoints-plugin` writes `<entry>_client-reference-manifest.js`
   into the trace of EVERY app entry (`.next/server/<entry>.js.nft.json`).
2. `flight-manifest-plugin` only EMITS that manifest when the client entry name
   ends in `/page`, `/page.<suffix>`, or exactly `/route`.
3. The client entry's bundle path strips only the last extension, so
   `route.api.ts` becomes `.../route.api`. Pages are safe — the page rule
   allows the extra `.api`, which is why `page.api.tsx` builds — but the route
   rule does not, so no manifest is written for any API route.

The trace therefore promises 17 files that do not exist. `next build` and
`next start` do not care (the loader reads that manifest with "missing is ok"),
but Vercel lstats every traced file, so the deploy fails.

`next.config.mjs` prunes the dangling entry in server mode only:

```js
outputFileTracingExcludes: { "/api/**": ["**/*_client-reference-manifest.js"] }
```

A route handler needs that manifest only for `use cache`, which no AILX route
uses. Do not "fix" this by renaming the handlers to `route.ts`: that name is
what would put the whole API into the GitHub Pages export. Delete the exclude
when Next matches `/route(\.[^/]+)?$/` the way it already matches `/page`.

## 7. Deploy

```bash
pnpm test && pnpm -r build             # both must pass
AILX_BACKEND=1 pnpm --filter @ailx/web build   # the server build specifically

vercel link                            # root directory: apps/web
vercel env add ...                     # everything required in §1
psql "$DATABASE_URL" -f db/schema.sql  # first deploy only
vercel deploy --prod
```

Smoke test after deploy: load `/`, sign in, start an attempt, upload a small T1
site, and open the served site URL — the last step is the one that proves blob
storage, the reachability gate and `AILX_PUBLIC_ORIGIN` are all right.
