# DEPLOY.md — hosted AILX (Vercel serverless)

The default build has not changed. Run `pnpm -r build` without `AILX_BACKEND`
to produce the GitHub Pages **static export** (`output: "export"`, no API
surface, no database). This document covers the *other* mode. It sets
`AILX_BACKEND=1` and uses real route handlers, Postgres, and stored T1 sites.
It deploys that mode to Vercel as a staging site instead of running `next start`
behind ngrok.

- Project root directory: `apps/web`. Its `vercel.json` installs and builds
  from the repo root, so it builds workspace packages first.
- Runtime: Node. The handlers use `pg`, `node:zlib` and `node:crypto`. Do not
  move them to the Edge runtime.
- The `services/openrouter-proxy` Vercel project is separate. This deployment
  does not affect it. It is still deployed from THIS repo, and it stays: the
  exam service's `/v1/model/*` gateway refuses an unauthenticated caller by
  design, so the GitHub Pages export has no way to reach it (TEN-62, AGENTS.md
  "The shared demo has no anonymous path").
- `OPENROUTER_KEY`, `AILX_PROVIDER_KEY_SECRET` and `AILX_MODEL_CALLBACK_URL`
  belong to the EXAM SERVICE, not to this project. `AILX_MODEL_CALLBACK_URL`
  must name a page of THIS frontend (`https://<origin>/exam`): the provider
  returns the browser there with `?code=&state=`, and the page hands both to
  the service, which does the exchange. The browser never receives a key.

## 1. Environment variables

Set these variables on the Vercel project for both Production and Preview. The
app has no silent defaults for variables marked **required**. It refuses to
start instead of guessing.

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
| `NEXT_PUBLIC_AILX_API_BASE` | no | The exam service's absolute origin, e.g. `https://ailx-backend-932932410694.us-central1.run.app`. Set it and the BROWSER calls that service instead of this app's own `/api` routes; leave it unset and nothing changes. Read in exactly one place, `apps/web/lib/mode.ts`. A value that is not a bare absolute http(s) origin is ignored. See §1.1 and docs/ARCHITECTURE.md §10.1. |

### 1.1 Pointing the frontend at the exam service

`NEXT_PUBLIC_AILX_API_BASE` is a public build-time variable. Next inlines it
into the client bundle. Changing it requires a REDEPLOY, not just an env edit.
When it is set:

- API calls go to `<origin>/v1/...`. The service versions its routes, but this
  app never did.
- A published T1 site uses the link
  `<origin>/api/site/<digest>/index.html`. Both hosts use the same site path
  because issued share payloads and credential claims freeze it.
- The `ailx_dev_user` cookie no longer matters. `SameSite=Lax` prevents a
  browser from sending it to another origin. Identity travels in the
  `x-ailx-dev-user` header or, once Clerk is mounted, `Authorization: Bearer`.
  `apps/web/lib/data/authHeaders.ts` sends that identity on every call.
  Server-rendered pages on THIS app still read the cookie. They also still
  read this app's own database.
- The service must allow the frontend's origin. `AILX_ALLOWED_ORIGINS` on
  Cloud Run is an explicit allowlist. It drops `*` and `null` and never
  reflects an arbitrary `Origin`. A Vercel PREVIEW deployment gets a different
  hostname, so the service refuses it by design. Verify on the production
  alias or add the preview host deliberately.

`AILX_BACKEND=1` still compiles this app's own API routes. During the cutover,
they are a duplicate host, not a fallback. Nothing fails over to them. They
are deleted after the Playwright suite is repointed (ARCHITECTURE.md §10.1).

## 2. T1 site snapshots must not use the filesystem

A Vercel function has a writable `/tmp` for each invocation. A candidate site
uploaded by one request is invisible to the request that serves it. The site
disappears when the instance is recycled. `AILX_SNAPSHOT_STORE=blob` selects
`BlobSnapshotStore` (`packages/backend/src/t1/storage.ts`). It keeps the
filesystem layout in a bucket:

```
<prefix>/blobs/<file-sha256>          file bytes, deduplicated across snapshots
<prefix>/manifests/<digest-hex>.json  canonical manifest — written LAST
```

The filesystem and Blob stores have identical semantics. The same test suite
runs against both:

- **Dedup** — Content hashes serve as keys, so the store saves identical bytes
  once.
- **Manifest last** — An object store has no rename and does not need one.
  Each object upload publishes completely or not at all. The manifest is the
  commit marker. An interrupted upload leaves unreferenced blobs and NO
  servable snapshot. The next identical upload dedups onto those blobs and
  commits.
- **Reachability is unchanged** — The app serves bytes only while a
  `responses` row records the digest. `handleServeSite` enforces that gate.
  Blob storage does not weaken it. Objects therefore use `access: "private"`.
  A public object URL would let anyone who learns a digest bypass the gate.

Only `apps/web/lib/server/site.ts` selects the store. Do not read a storage env
var anywhere else. A `BLOB_READ_WRITE_TOKEN` alone does not switch stores. You
must set `AILX_SNAPSHOT_STORE=blob`. A token in a local shell therefore cannot
redirect a dev server's uploads into the shared bucket.

## 3. Postgres: use the pooled Neon endpoint

Each warm instance has its own `pg` Pool. The number of connections therefore
grows with the number of instances. Neon provides two hostnames. The
deployment must use the **pooler**:

```
# right — pooled (note "-pooler")
postgresql://user:pw@ep-xxx-pooler.<region>.aws.neon.tech/ailx?sslmode=require
# wrong on serverless — direct endpoint, exhausted after a few cold starts
postgresql://user:pw@ep-xxx.<region>.aws.neon.tech/ailx?sslmode=require
```

`poolConfig` in `apps/web/lib/server/api.ts` sets `max: 3`, a 10 s idle
timeout and `allowExitOnIdle`. A frozen instance stops holding a session it
cannot use. Transactions still check out ONE client per request. Using
`withTransaction` on a pool proxy would be meaningless. The pooler supports
this behavior in transaction mode.

Apply `db/schema.sql` to the staging database once, before the first deploy.

## 4. Auth on a hosted staging site — read this

`AILX_AUTH=dev` accepts an **asserted** identity. The header
`x-ailx-dev-user: alice` is enough to *be* alice. That is convenient on
localhost. On a public URL, anyone can impersonate any participant, read their
attempts, and submit as them. For that reason, `AILX_AUTH=dev` refuses to start
under `NODE_ENV=production` unless `AILX_ALLOW_INSECURE_DEV_AUTH=1` is also
set. A Vercel deployment always uses `NODE_ENV=production`.

**Recommendation: staging uses `AILX_AUTH=clerk` with `CLERK_SECRET_KEY`.**

Override this only for a throw-away deployment that contains no real
participant data, will be deleted, and has a URL you accept as public. Set
both `AILX_AUTH=dev` and `AILX_ALLOW_INSECURE_DEV_AUTH=1`. The site then has no
authentication at all. Never set that flag on a deployment that contains real
data.

### 4.1 The `ailx_dev_user` cookie

`DevAuthProvider` also accepts identity from the `ailx_dev_user` cookie. The
browser writes it alongside `localStorage["ailx:dev-user"]`. `devUser()` in
`apps/web/lib/data/authHeaders.ts` is the only writer. The order of precedence is
the `x-ailx-dev-user` header, then `Authorization: Bearer dev:<id>`, then the
cookie. Scripted callers and the Playwright suite are therefore unaffected.

The cookie exists because a header can travel only on a `fetch()` made by the
app. An ordinary document navigation reaches a server-rendered page
(`page.api.tsx` — `/progress`, `/review`). That navigation carries cookies but
nothing else. Without the cookie, `/progress` told every browser "we do not
know who you are". Fetching the same URL with the header rendered the real
streak.

The cookie is **not** a session. Its value is asserted, not proven. It uses
`SameSite=Lax`, `Path=/`, six months, `Secure` over https, and NOT `HttpOnly`.
It cannot use `HttpOnly` because the browser mints it. Hiding it from scripts
would protect nothing because dev auth already lets anyone assert any id. The
cookie does not change the threat model. `AILX_AUTH=clerk` remains the only
answer for a deployment that real participants can reach. localStorage
remains the source of truth. The app writes the cookie only from localStorage
and never reads it back into localStorage. A cleared browser therefore cannot
be silently re-identified as its previous occupant. "Forget this browser" on
`/progress` clears both.

## 5. Vercel platform limits that bite AILX

- **Request/response body cap (4.5 MB).** `T1_LIMITS.maxTotalBytes` is 25 MB.
  A large T1 ZIP cannot pass through a request body. An asset over ~4.5 MB
  cannot return through the site route. Uploads above 4 MB use the
  client-direct path in §5.1. Smaller uploads still use the unchanged POST
  path below.

  Before that path existed, staging measured this behavior with a 6 MB ZIP.
  The platform returns `413` with the plain-text body
  `Request Entity Too Large / FUNCTION_PAYLOAD_TOO_LARGE`. Our handler never
  runs, so the response has no JSON error envelope and no `responses` row.
  `uploadSiteZip` still maps that case to a `rejected` result carrying
  `PLATFORM_TOO_LARGE_MESSAGE`. This is now a last-resort message for a host
  with no Blob store (`AILX_SNAPSHOT_STORE=fs`), not the normal result. Our own
  413s, the validator's `file_too_large` / `total_too_large`, still arrive as
  JSON and still take priority. A parsed server message always replaces the
  platform default.
- **Function duration.** The default is 10 s (Hobby) / 15 s (Pro) unless
  raised. Finalizing a direct upload reads the staged ZIP and uploads the
  validated files again. A 25 MB site therefore makes the slowest request in
  the app.
- **No warm process between requests.** Do not rely on in-memory state that
  survives a request. This includes in-memory counters, caches with correctness
  meaning, and work started after returning the response.

### 5.1 Client-direct upload to Blob (large T1 sites)

The browser PUTs the ZIP directly into the Blob store. It then asks the app to
accept the upload. The bytes never pass through a function request body:

```
POST /api/attempts/:id/site/upload-ticket   → { uploadId, pathname, token, ... }
PUT  <blob store>/uploads/<attemptId>/<uploadId>.zip   (browser → Blob, scoped token)
POST /api/attempts/:id/site/finalize        { uploadId, seq }
```

The app selects the path automatically by size using `DIRECT_UPLOAD_MIN_BYTES`
(4 MB, `apps/web/lib/data/siteUpload.ts`). Below that threshold, the single POST
uses one round trip and remains unchanged. Above it, the client requests a
ticket. If the deployment has no Blob store, the ticket endpoint returns
`501`, and the client falls back to the POST. This leaves
`AILX_SNAPSHOT_STORE=fs`, `next dev` and the static export unchanged.

**Who authorises.** `/site/upload-ticket` authenticates callers through the
same `AuthProvider` as every other route. It returns a 404 for an attempt that
does not belong to the caller, which avoids an existence leak. Only then does
it mint a ticket. A ticket records and reserves nothing. An unused ticket
expires.

**What the token is scoped to.** The server chooses every value that a client
could otherwise choose. The key is
`<prefix>/uploads/<attemptId>/<uploadId>.zip`. The `uploadId` contains 128
server-generated random bits. The server issues the client token for exactly
that pathname, for `application/zip` only, at most `T1_LIMITS.maxTotalBytes`,
for 15 minutes, with `addRandomSuffix: false` and `allowOverwrite: false`. A
stolen, replayed or hand-edited grant can reach ONE scratch key within the
uploader's own attempt. It can never reach a content-addressed `blobs/` object,
a `manifests/` commit marker, or another attempt. Staged objects use
`access: "private"`, like every other object the app writes.

**How the server validates AFTER the bytes land.** `/site/finalize` checks
ownership again. It reads the staged object and rejects it from its metadata
if the object exceeds the cap, without buffering it. It then runs the SAME
`snapshotFromZip` used for a POSTed ZIP. The same code rejects zip bombs, zip
slip, symlinks, disallowed types and §12 caps. The client never supplies a
digest. The server computes the digest from the bytes it reads, so nobody can
register a snapshot they did not upload. After validation,
`recordSiteSubmission` runs the unchanged pipeline. It writes the `responses`
row FIRST, then the content-addressed bytes. The one-submission-per-attempt
index, append-only store, and record-before-store ordering remain unchanged.

**What happens to bytes that fail validation.** The app records nothing and
stores nothing under a content address. The serve path therefore returns a
404. It serves only a digest that a `responses` row still references, and only
from `manifests/` + `blobs/`. The app deletes the staged object whether it
accepts or rejects the submission. A staged key is never servable, even before
deletion, because `handleServeSite` does not read the `uploads/` namespace. A
crash between PUT and finalize leaves one private, unreferenced scratch object
that no URL resolves to.

## 6. The build fix this deployment needs (`outputFileTracingExcludes`)

Without this fix, `vercel build` succeeds but fails while collecting output:

```
Error: ENOENT: no such file or directory, lstat
  '/vercel/path0/apps/web/.next/server/app/api/attempts/[id]/credential/route_client-reference-manifest.js'
```

That route is not broken. It is simply the first API entry in
`app-path-routes-manifest.json`. The problem comes from the `route.api.ts`
convention and a gap in Next:

1. `next-trace-entrypoints-plugin` writes `<entry>_client-reference-manifest.js`
   into the trace of EVERY app entry (`.next/server/<entry>.js.nft.json`).
2. `flight-manifest-plugin` only EMITS that manifest when the client entry name
   ends in `/page`, `/page.<suffix>`, or exactly `/route`.
3. The client entry's bundle path removes only the final extension.
   `route.api.ts` therefore becomes `.../route.api`. Pages are safe because the
   page rule allows the extra `.api`, so `page.api.tsx` builds. The route rule
   does not allow it, so no API route gets a manifest.

The trace promises 17 files that do not exist. `next build` and `next start`
do not care because the loader treats a missing manifest as acceptable.
Vercel calls lstat on every traced file, so the deployment fails.

`next.config.mjs` removes the dangling entry in server mode only:

```js
outputFileTracingExcludes: { "/api/**": ["**/*_client-reference-manifest.js"] }
```

A route handler needs that manifest only for `use cache`. No AILX route uses
it. Do not "fix" this by renaming the handlers to `route.ts`. That name would
include the whole API in the GitHub Pages export. Delete the exclude when Next
matches `/route(\.[^/]+)?$/` as it already matches `/page`.

## 7. Deploy

```bash
pnpm test && pnpm -r build             # both must pass
AILX_BACKEND=1 pnpm --filter @ailx/web build   # the server build specifically

vercel link                            # root directory: apps/web
vercel env add ...                     # everything required in §1
psql "$DATABASE_URL" -f db/schema.sql  # first deploy only
vercel deploy --prod
```

After deployment, smoke-test the site. Load `/`, sign in, start an attempt,
upload a small T1 site, and open the served site URL. The last step verifies
Blob storage, the reachability gate, and `AILX_PUBLIC_ORIGIN`.
