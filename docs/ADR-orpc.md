# ADR: oRPC for the frontend/backend contract

Status: **rejected for the wire contract, with one piece kept** (see §8).
Date: 2026-09-02. Issue: TEN-37. Branch: `w/ten-37`.
Spike: `packages/spike-orpc` (delete it once this is read).

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
Nothing in `apps/web` imports it. `pnpm --filter @ailx/spike-orpc test` runs 6
tests, all green; `build` type-checks `src` and `test`, so the compile-time
claims are checked by `pnpm -r build`, not asserted in prose.

What it shows working:

- the client derives `/v1/gallery?sort=oldest&limit=5&offset=10` from the
  contract. The call site cannot spell a path.
- an implementation returning the wrong shape does not compile
  (`@ts-expect-error` in `test/gallery.spike.test.ts`).
- calling a procedure the contract does not declare does not compile.

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

The shared chunks did not move because one page imported the client. Two pages
importing it and the 21.7 kB moves into the shared chunk every visitor pays
for, on the first page they open. The static Pages export has no exam service
at all, so this is cost with no benefit there; it only earns anything in the
hosted build.

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

The failure mode is what matters: it is silent. Nobody gets an error; the
result type is just `unknown`, and every field access downstream is allowed.

### 5.4 Query normalization becomes a behaviour change

`parseGalleryQuery` **clamps**: `?limit=1e9` yields 48 and a 200. A zod input
schema **rejects**: the same request is a validation error. The spike test
`applies the contract's caps and defaults on the SERVER side` pins that. It is
a defensible change, but it is a change to a live public endpoint, and it
means the schema and the parser both exist until every caller is moved.

### 5.5 The suite and the build

`AILX_TEST_FORKS=2 pnpm test`: **2461 passed, 4 skipped, 0 failed** (188
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
- the `apiRoute` wrapper and the `{status, body}` envelope go away, and with
  them the byte-exact `UNAUTHORIZED_RESULT` / `FORBIDDEN_RESULT` bodies that
  `packages/contract/src/api.ts` freezes and a test asserts on. oRPC has its
  own error envelope. Changing those bytes is a wire-visible change to every
  refusal the service can make.

Estimated cost of a full migration: 38 routes re-declared as contract
procedures, `SharePayload` and the moderation shapes re-spelled as schemas or
left as `type<T>()` with no server-side response validation, the error
envelope re-frozen on oRPC's shape, and the browser's write paths moved off
`fetch`. That is not a weekend, and every step is in a repository whose CI
cannot see the other one.

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
from a route to its types — and oRPC is a large way to buy a small link:

- +21.7 kB gzip in a bundle that includes a static export with no backend;
- a dependency in the purity allowlist, which exists to be short;
- a silent `unknown` from the client type the docs prescribe (§5.3);
- a stable release whose documentation the project has moved off (§2);
- a rewrite of 38 routes and of the frozen refusal bodies in a repo this one
  cannot test (§5.6).

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

That is the §6 guarantee — a route the service does not have becomes a red
build in the private repo on the sync PR — for roughly 60 lines, no
dependency, no bundle cost, no purity-allowlist edit, and no change to the
error envelope. It also fixes the `approvedBy` overstatement, because the
response type is attached to the route.

Not done tonight: TEN-37 asked for a recommendation with a spike behind it,
not a migration. The manifest belongs in its own issue with its own tests.

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
