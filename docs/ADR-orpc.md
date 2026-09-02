# ADR: oRPC for the frontend/backend contract

Status: **rejected for the wire contract; a cheaper follow-up proposed** (§8).
Date: 2026-09-02. Issue: TEN-37. Branch: `w/ten-37`.
Spike: `packages/spike-orpc`, which exists to support this document and should
be deleted when the follow-up issue is opened.

## 1. The question

`packages/contract` is hand-written wire types plus hand-written `fetch` calls
in `apps/web`. The two repositories have already drifted once: the private
service did not have `POST /attempts/:id/score`, and a browser called it
anyway (`packages/core/test/frontendOnly.test.ts`, file header). oRPC sells an
end-to-end typed contract aimed at exactly that. Does it beat what is here,
under the constraints this repo actually has?

## 2. Which version

| | |
|---|---|
| stable, `latest` on npm | `1.15.0` |
| what orpc.dev and `llms-full.txt` document | `2.0.0-beta.32` |
| where v1 docs live | `v1.orpc.dev` |

The spike is built on **1.15.0**. A wire contract is the last thing that
should sit on a beta: the private service and the browser deploy separately,
so a breaking change between beta 32 and 33 would land on one side first. But
1.15.0 means writing against docs the project has moved off. That is a real
cost of adopting now and it is not the reason for the answer below.

## 3. What is being replaced

`packages/contract` (11 source files, 648 lines) provides:

- wire types: `ApiResult`, `GalleryEntry`/`GalleryListing`/`GalleryQuery`,
  `ShareRecord`, `CredentialRecord`, the moderation shapes;
- frozen URL spellings: `shareUrlPath`, `shareCardPath`, `siteUrlPath`,
  `canonicalSitePath`, `SITE_INDEX`;
- pure query normalization: `parseGalleryQuery`, `parseCaseQuery`, `clampInt`;
- the dev-identity predicate and its header/cookie names;
- the two frozen refusal bodies, `UNAUTHORIZED_RESULT` and `FORBIDDEN_RESULT`.

`apps/web` reaches the service through one seam. `lib/mode.ts` `apiBase()`
returns `/api` or `<origin>/v1`; `lib/serviceFetch.ts` is the only GET path
(`serviceFetch`, `useService`, four states); writes call `fetch` directly in
`PracticeDrill.tsx`, `ReviewActions.tsx`, `Moderation.tsx`, `localPractice.ts`
and `persistence.ts`. The private service mounts **38 `/v1` routes** on Hono
(`services/api/src/app.ts`), each through one `apiRoute` wrapper that supplies
auth and the `{status, body}` envelope.

**What the contract does NOT do today: it does not tie a type to a route.**
`GalleryListing` is a type; `GET /gallery` is a string in `GalleryView.tsx`.
Nothing connects them, and that is the gap.

## 4. The spike

`packages/spike-orpc` expresses `GET /gallery` — a small public read — as an
oRPC contract, a client built from it, and a fake handler implementing it.
Nothing in `apps/web` imports it. `pnpm --filter @ailx/spike-orpc test` runs 9
tests, all green; `build` type-checks `src` and `test`, so the compile-time
claims are checked by `pnpm -r build`, not asserted in prose.

What it shows working:

- the client derives `/v1/gallery?sort=oldest&limit=5&offset=10` from the
  contract. The call site cannot spell a path.
- an implementation returning the wrong shape does not compile
  (`@ts-expect-error` in `test/gallery.spike.test.ts`).
- calling a procedure the contract does not declare does not compile.
- the frozen `UNAUTHORIZED_RESULT` body survives byte for byte through
  `OpenAPIHandler`'s `customErrorResponseBodyEncoder`
  (`test/refusal.spike.test.ts`).

What it shows NOT working, and this is the sharpest integration snag:
`OpenAPILink` resolves its `url` with `new URL()`, so a relative base throws
`TypeError`. `apiBase()` is relative in two of the three builds this repo
ships — `/ailx/api` for the Pages export, `/api` for a hosted build with no
`NEXT_PUBLIC_AILX_API_BASE`. Adopting oRPC means making the base absolute at
the seam. `test/gallery.spike.test.ts` pins both the failure and the fix.

## 5. The measurements

### 5.1 Purity: it survives, but it costs the allowlist

Added `@orpc/contract@1.15.0` and `zod@^3.24.0` to `packages/contract`, added a
contract file using `oc`, ran `packages/contract/test/purity.test.ts`:

```
Tests  1 failed | 14 passed (15)
AssertionError: expected [ '@ailx/report', …(2) ] to deeply equal [ '@ailx/report' ]
+   "@orpc/contract",
+   "zod",
```

Every source-text rule passed. No `node:` import, no `process.env`, no clock,
no `fetch`, no `pg`. `grep -rn "node:"` over the shipped `dist/` of
`@orpc/contract`, `@orpc/shared` and `@orpc/client` returns nothing. **oRPC's
contract half is browser-safe.** The one failure is the deliberate allowlist
line `expect(deps).toEqual(["@ailx/report"])`, which is a policy, not a leak.
Adopting means editing that line, and the reason for editing it should be
better than "it is tidier". Reverted; `packages/contract` is 36/36 green.

### 5.2 Bundle: +21.7 kB gzip, on the Pages export

Static export (`pnpm --filter @ailx/web build`), `rm -rf apps/web/.next
apps/web/out` between runs. "After" wires `spikeGalleryClient` into
`app/wall/page.tsx`, the one static page that reads a service.

| | before | after | delta |
|---|---|---|---|
| all JS in `out/_next/static`, raw | 2,266,247 B | 2,349,057 B | **+82,810 B** |
| the same, gzipped | 675,237 B | 696,932 B | **+21,695 B** |
| `/wall` first load (Next's number) | 108 kB | 130 kB | +22 kB |
| shared-by-all chunks | 103 kB | 103 kB | 0 |

Read this carefully. The measured fact is the `/wall` first load: +22 kB, paid
by anyone who opens that page. The shared chunks did not move, because one
page imported the client. Whether a second importer would push the client into
the shared chunk is **not measured** — Next decides that by its own splitting
thresholds. The gzip total is the size of the exported artifacts, not bytes
any one visitor downloads.

The static Pages export has no exam service at all, so on that build this is
cost with no benefit; it only earns anything in the hosted build.

For scale: the whole hand-written `@ailx/contract` is 648 lines of source.

### 5.3 Types: the documented client wrapper erases our payload

`packages/spike-orpc/test/types.spike.ts` pins this, checked by `tsc`:

```ts
type JsonifiedResult = Awaited<ReturnType<
  JsonifiedClient<ContractRouterClient<typeof galleryContract>>["listGallery"]
>>;
// => { gallery: unknown }
```

`JsonifiedClient` is what the oRPC docs tell you to wrap an OpenAPILink client
in. Over our types it returns `unknown` for the whole listing. The cause is
ordinary TypeScript: `PublicGalleryListing` is an `interface`, interfaces have
no implicit index signature, and the `Jsonify` mapped type falls through to
`unknown`. `SharePayload.playerType.poles`, `.profile` and `.process` are lost
the same way.

Two ways out, both with a price:

- drop the wrapper and use `ContractRouterClient` directly. Types stay exact.
  Honest here only because our payloads are already plain JSON — no `Date`, no
  `BigInt`, no `File`. This is what the spike does.
- follow the documented fix: write a real zod **output** schema and add
  `ResponseValidationPlugin`. That means re-spelling `SharePayload` — a deep
  `@ailx/report` type with four nested interfaces — as a schema, and shipping
  that schema in the browser bundle.

The failure mode is quiet, not silent, and the difference is worth being
precise about. Nothing warns at the contract; the result type is just
`unknown`. TypeScript then refuses every property access on it, so the damage
shows up as a pile of compile errors at the call sites, which a reader is
likely to fix with a cast. It is lost type safety, not unchecked access.

### 5.4 Query normalization becomes a behaviour change

`parseGalleryQuery` **normalizes**; a zod input schema **rejects**. Measured,
and pinned by the spike test `REJECTS an over-cap limit that the parser would
clamp`:

| request | today | with the zod schema |
|---|---|---|
| `?limit=1000000000` | 48, HTTP 200 | validation error |
| `?sort=sideways` | `recent`, HTTP 200 | validation error |
| `?site=true` | `withSite: false`, HTTP 200 | validation error |
| `?limit=1e9` | **1** (`Number.parseInt`), HTTP 200 | validation error |

The last row is a bug in the parser, not in oRPC, and it is unrelated to this
decision. The point stands either way: this is a behaviour change to a live
public endpoint, and the schema and the parser would both exist until every
caller is moved.

### 5.5 The suite and the build

`AILX_TEST_FORKS=2 pnpm test`: **2464 passed, 4 skipped, 0 failed** (189
files), with the spike package in the workspace. `pnpm -r build`: green,
including both `frontendOnly.test.ts` conditions — the spike adds no
`app/api/**` route, no server adapter, no `pg`/`@clerk/backend`/`@ailx/backend`
dependency. `@orpc/server` and `@orpc/openapi` are `devDependencies` of the
spike package only, used by its fake handler; neither is on the banned list,
and neither reaches `apps/web`.

### 5.6 What the private repo would have to do

`tools/src/syncShared.ts` vendors `packages/contract/src`,
`packages/contract/test` **and `packages/contract/package.json`**, byte for
byte, checked on every PR.

- `sync:shared:check` does **not** break. It compares bytes, and the bytes
  would match after a sync. But the vendored `package.json` would then name
  `@orpc/contract` and `zod`, so the private repo must install both or its
  install is broken. The check is not the obstacle; the coupling is.
- to implement, it needs `@orpc/server` and `@orpc/openapi`, and it must route
  through `OpenAPIHandler` instead of 38 `app.get`/`app.post` lines.
- the `apiRoute` wrapper is rewritten. The frozen bodies do NOT have to
  change: `test/refusal.spike.test.ts` emits `UNAUTHORIZED_RESULT.body` byte
  for byte through `OpenAPIHandler`'s `customErrorResponseBodyEncoder`. What
  changes is how a handler refuses — it throws an `ORPCError` instead of
  returning `{status, body}` — so every handler and the wrapper move, and the
  encoder has to be kept in step with `packages/contract/src/api.ts` by hand.

Estimated cost of a full migration: 38 routes re-declared as contract
procedures, `SharePayload` and the moderation shapes re-spelled as schemas or
left as `type<T>()` with no server-side response validation, every handler
moved from a returned envelope to a thrown `ORPCError`, the relative
`apiBase()` made absolute, and the browser's write paths moved off `fetch`.
Most of that work is in a repository whose CI cannot see this one.

## 6. Does this make a mismatch impossible at build time?

Partly, and the "partly" is the answer to TEN-37.

**Yes, for the class of failure that happened.** If the contract object lives
in `packages/contract` and the private repo implements it with `implement()`
and `os.router()`, then: the browser cannot name a route, because the path
comes from the contract; and the service cannot omit one, because
`os.router()` will not compile with a procedure missing. `sync:shared:check`
guarantees the private repo is compiling against the *same bytes*. So drift
becomes a **compile error in the private repo, on the PR that syncs**.

**No, not at the moment the frontend changes.** The two repos build
separately. Adding a procedure here is green here — every client call site
type-checks against the new contract, and nothing in this repo knows whether
anything implements it. The error appears later, in the other repo, when
somebody runs sync. The window between "frontend merged" and "backend
compiled" is unchanged; what changes is that the window now ends in a red
build instead of a 404 in production.

And it holds only where the discipline holds: only for endpoints in the
contract, only if handlers are written through `implement()`, and only at
type-check time. The spike shows the runtime does not help — the client is a
`Proxy`, so `client.scoreAttempt()` exists at runtime and throws
`expect a contract procedure at scoreAttempt` with no request behind it. A
build that skips type-checking gets the whole bug class back.

## 7. The decision, and why

**Reject oRPC for the wire contract.**

The mechanism that would catch drift is *the private repo compiling handler
code against a byte-identical vendored contract*. `sync:shared:check` already
delivers the byte-identical part. What is missing is a machine-checked link
from a route to its types. oRPC supplies that link, and charges for a great
deal more:

- +22 kB on the first load of any page that imports the client, in a repo
  whose default build is a static export with no exam service (§5.2);
- a second and third entry in the purity allowlist, which exists to be short
  (§5.1);
- the client type the docs prescribe returns `unknown` over our wire types
  (§5.3);
- a stable release whose documentation the project has moved off (§2);
- 38 routes, every handler's refusal path, and the browser's write paths
  rewritten, most of it in a repo this one's CI cannot see (§5.6);
- `apiBase()` must become absolute, because `OpenAPILink` will not take a
  relative base (§4).

Against that, the thing bought is real but narrow: routes and their types
declared once. A hand-written contract with frozen URL spellings is already a
reasonable design, and the honest gap is not "it is hand-written", it is "no
route table exists".

Evidence that the gap is real and cheap to close: today `GalleryView.tsx`
declares `useService<{ gallery: GalleryListing }>`, whose `entries` carry
`approvedBy`. The service applies `publicEntry()` and never sends it
(`packages/backend/src/gallery.ts:225`). Nothing reads the field, so nothing
broke — but the browser's declared type is wrong right now, and it is wrong
because the request path and the response type are written down in two places
by two people.

## 8. What to do instead — the smallest first step

Add a **route manifest** to `packages/contract`: one exported table naming
every `/v1` route, its method, its path template and its response type. Then

- `apps/web/lib/serviceFetch.ts` takes a manifest key instead of a string, so
  no call site can spell a path, and the response type comes with the route;
- the private repo asserts its Hono app mounts exactly the manifest's routes,
  no more and no fewer. It vendors the manifest byte for byte already, so that
  test is a loop over an array.

Be exact about what those two steps buy, because they are not equal.

- **A route the service does not have becomes a red build** in the private
  repo on the sync PR. That is the 2026 failure, closed. The check is a
  comparison of mounted method/path pairs against a vendored array.
- **A response that does not match its declared type is NOT caught by that
  check.** Enumerating routes at runtime cannot prove what a handler returns.
  Closing that half needs the private repo's `apiRoute` wrapper to become
  generic in the manifest key, so each handler's return type is constrained by
  the vendored table. That is where the `approvedBy` overstatement is fixed,
  and it is the more valuable half.

Cost: roughly 60 lines here for the manifest and the `serviceFetch` change,
plus a typed wrapper and one enumeration test in the private repo. No
dependency, no bundle cost, no purity-allowlist edit, no change to the error
envelope, and no change to any URL.

This ADR stops at the recommendation. The manifest belongs in its own issue
with its own tests, and it touches both repos.

## 9. What would make this the wrong call

Revisit if any of these becomes true.

- **The service grows a public API.** A third party integrating needs an
  OpenAPI document. oRPC generates one from the contract; a route manifest
  does not, and hand-written OpenAPI drifts exactly like hand-written types.
- **Response validation starts to matter.** A route manifest checks that the
  route exists and names the type. It does not check that the body matches at
  runtime. If a wrong-shape response ever reaches a candidate mid-sitting,
  server-side output validation is worth re-spelling `SharePayload` for.
- **The endpoint count keeps climbing.** 38 routes are hand-manageable. At
  triple that, per-route boilerplate stops being cheaper than a generator.
- **The two repos merge, or the frontend starts importing the service's
  types.** Then one compilation sees both sides, and the argument in §6 about
  separate builds no longer applies.
- **oRPC v2 ships stable and fixes §5.3.** `test/types.spike.ts` pins the
  `unknown` result on purpose. If a later release makes that assertion fail,
  the file goes red and this ADR should be read again.
