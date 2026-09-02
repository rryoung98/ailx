# ADR: zod and TanStack Query in the frontend

Status: **both adopted, with one condition that the measurement produced** (§3.2).
Date: 2026-09-02. Issues: TEN-65, TEN-64. Branch: `w/ten-65`.
Yardstick: `docs/ADR-orpc.md`, which rejected oRPC partly for +21.7 kB gzip on
one page. The same measurement is applied here, on the same builds, with
`rm -rf apps/web/.next apps/web/out` between every run.

The spike is not a separate package this time. Both libraries are wired into the
shipped code — one read and one write — so every number below can be re-run from
this branch.

## 1. The question

Two separate things, and they must not blur:

- **zod** — validate what crosses the wire. `packages/contract` was
  compile-time only: a service response flowed into the UI trusted.
- **TanStack Query** — own async state. `useService` hand-rolled a four-state
  machine, and `ConnectPanel`'s PKCE callback hand-rolled a cancellation flag, a
  promise chain and cleanup (TEN-64).

The user decided to adopt both. The work was to find the honest shape, measure
the cost, and say plainly what would make either a bad idea here.

## 2. What was built

**zod at the seam.** `packages/contract/src/gallery.ts` declares
`galleryEntrySchema`, `publicGalleryEntrySchema`, `galleryFacetSchema`,
`galleryQuerySchema` and `galleryListingSchema`, and every TypeScript type is
`z.infer` of its schema. There is no second copy of the shape to drift from.
`API_RESPONSE_SCHEMAS` (`src/tables.ts`) keys the response schema by the same
route key `apiPath()` builds the path from, so `apps/web/lib/GalleryView.tsx`
asks for a path and a schema that cannot disagree about which route they mean.

The deep half is delegated, not re-spelled: `sharePayloadSchema` is
`z.custom<SharePayload>((v) => parseSharePayload(v) !== null)`, and
`parseSharePayload` in `@ailx/report` is already the one runtime definition of
that shape. Re-spelling four nested interfaces as schemas would have been the
second copy this ADR exists to avoid.

**One source of truth, and where it stops.** The manifest's `response` line is
still a STRING (`"{ gallery: GalleryListing }"`). What is machine-checked is
that a schema is keyed by a real route, and that the schema the browser
validates with is the definition of the type the page reads. What is NOT
machine-checked is that the string and the schema describe the same thing. One
route of 38 has a schema. Claiming a validated wire while 37 are unchecked
would be the drift the package exists to stop, so `useService` validates only
when it is handed a schema.

**TanStack Query for async state.** `useService` is a `useQuery` now, behind the
same seam and the same four states — `missing` still carries its HTTP status,
which the library has no place for. `ConnectPanel`'s one-shot exchange is a
`useMutation`. One `QueryClient` for the app, created in `useState` inside
`lib/QueryProvider.tsx` and mounted in the root layout.

## 3. The bundle

### 3.1 The static Pages export

`pnpm --filter @ailx/web build`, `rm -rf apps/web/.next apps/web/out` between
runs. "tables in `routes.ts`" is the first working version; "tables split" is
what this branch ships, and §3.2 explains why they differ.

| | baseline | tables in `routes.ts` | tables split (shipped) |
|---|---|---|---|
| all JS in `out/_next/static`, raw | 2,282,968 B | 2,372,193 B | 2,314,286 B |
| the same, gzipped | 678,493 B | 705,084 B | **688,436 B** |
| gzip delta | — | +26,591 B | **+9,943 B** |
| `/` first load (Next's number) | 184 kB | 200 kB | 184 kB |
| `/exam` first load | 205 kB | 225 kB | 209 kB |
| `/report` first load | 236 kB | 252 kB | 236 kB |
| `/wall` first load | 108 kB | 108 kB | 108 kB |
| shared by all | 103 kB | 103 kB | 103 kB |
| zod in the export at all? | — | yes, on all 9 pages | **no** |

**Next's per-page number under-reports, and this is the most important caveat
in the document.** In the middle column Next said `/wall` was unchanged at
108 kB, while `wall.html` loaded `chunks/832-*.js` — the chunk containing zod —
as an async script. Summing the gzipped bytes of every `<script src>` a page
actually requests tells the other story:

| page | baseline | tables in `routes.ts` | tables split (shipped) |
|---|---|---|---|
| `/` | 228,072 B | 252,532 B (+24,460) | 235,802 B (**+7,730**) |
| `/wall` | 230,253 B | 254,713 B (+24,460) | 237,983 B (**+7,730**) |
| `/exam` | 267,413 B | 292,750 B (+25,337) | 277,377 B (**+9,964**) |
| `/methodology` | 169,287 B | 195,144 B (+25,857) | 177,735 B (**+8,448**) |
| `/report` | 288,399 B | 312,767 B (+24,368) | 297,473 B (**+9,074**) |

That sum counts every script on the page, so it is much larger than Next's
"First Load JS" in absolute terms. The DELTA is the comparable figure, and the
two builds disagree by 17 kB gzip on a page Next called unchanged. The oRPC ADR
quoted Next's number; on this branch it would have been wrong.

### 3.2 The condition: keep the schema table out of `routes.ts`

The first working version put `API_RESPONSE_SCHEMAS` beside `apiPath()` in
`routes.ts`, which reads well and costs 14.5 kB gzip on every page of a build
that has no gallery. `apiPath()` is imported by every page in the app; while the
tables sat in the same module, zod was reachable from it, and webpack shipped
zod to the static export — which has no exam service to call and nothing to
validate.

Moving both tables to `src/tables.ts` removes zod from the static export
entirely (`grep -rl unrecognized_keys out/_next/static/chunks` returns nothing)
and cuts the per-page cost from +24.5 kB gzip to +7.7 kB. **The residue is
TanStack Query**, which the root layout mounts and every page therefore pays
for.

In the hosted build the split costs a little instead of saving: total artifact
bytes went from 782,575 B gzip (unsplit) to 787,374 B gzip (split), because an
extra chunk boundary is not free where both libraries ship anyway. 4.8 kB of
build output against 14.5 kB on every static page is not a close call.

### 3.3 The hosted build

`AILX_BACKEND=1 pnpm --filter @ailx/web build`.

| | baseline | shipped |
|---|---|---|
| all JS in `.next/static`, gzipped | 761,241 B | 787,374 B (+26,133) |
| `/` first load | 185 kB | 184 kB |
| `/exam` first load | 205 kB | 210 kB |
| `/report` first load | 239 kB | 239 kB |
| shared by all | 103 kB | 103 kB |

`/gallery` is a dynamic route, so Next reports 0 B for it and no before/after
page number exists. Its client entry is 146,277 B gzip in the shipped build, of
which the chunk carrying zod is 15,443 B gzip. That is what the validated page
pays, and it is the page that gets the benefit.

The total artifact number moved more than any page number because the hosted
build now emits both libraries plus the split chunks. Artifact bytes are not
bytes a visitor downloads.

### 3.4 zod 4 against `zod/mini`

Same build, same code, only the import and the API style changed. Measured on
the unsplit variant, so both columns include zod on every page and the
difference is only the library:

| | zod 4 classic | `zod/mini` | saving |
|---|---|---|---|
| all JS in `out/_next/static`, gzipped | 705,084 B | 697,042 B | **8,042 B** |
| `/` first load | 200 kB | 192 kB | 8 kB |
| `/exam` first load | 225 kB | 217 kB | 8 kB |
| `/report` first load | 252 kB | 244 kB | 8 kB |

`zod/mini` is 8 kB gzip cheaper and costs readability: `z.string().min(1)`
becomes `z.string().check(z.minLength(1))`, `.nullable()` becomes
`z.nullable(...)`, `.omit()` becomes `z.omit(schema, ...)`, `.transform()`
becomes `z.pipe(schema, z.transform(fn))`, and `z.ZodType` becomes
`z.ZodMiniType`. All 97 contract tests pass unchanged on the mini variant, so
the two are behaviourally identical for what this package does.

**Not adopted, on this measurement.** After the §3.2 split, the static export
ships no zod at all, so mini would save those 8 kB only on `/gallery` in the
hosted build. The saving is real and small; the cost is that every future schema
is written in the less obvious dialect. Revisit if the schema table grows past a
handful of routes. Reproducing it is a mechanical edit of two files — the diff
is described above and the tests do not change.

zod 3 was not measured, on the issue's instruction: it is materially larger and
is not a candidate.

## 4. Normalise or reject

`parseGalleryQuery` normalised. It now refuses, and returns a result the caller
must open (`{ ok: true, query }` or `{ ok: false, message }`) rather than a
query it may trust. Nothing is in production, there is no score of record, and a
silent answer to a question nobody asked is worse than a 400.

| request | before | now |
|---|---|---|
| `?limit=1000000000` | 48, HTTP 200 | refused |
| `?limit=1e9` | **1**, HTTP 200 | refused |
| `?limit=many` | 24, HTTP 200 | refused |
| `?limit=0` | 1, HTTP 200 | refused |
| `?sort=sideways` | `recent`, HTTP 200 | refused |
| `?offset=-5` | 0, HTTP 200 | refused |
| `?type=nope` | `null`, HTTP 200 | refused |
| `?site=true` | `withSite: false`, HTTP 200 | refused |
| `?utm_source=twitter` | ignored, HTTP 200 | ignored, HTTP 200 |
| `?limit=48&sort=oldest` | accepted | accepted |

The `?limit=1e9` row was a bug: `Number.parseInt("1e9")` is 1, so a hostile page
size returned ONE card under HTTP 200. `z.coerce.number()` reads 1000000000 and
refuses it for being over the cap. The fix came free with the schema.

**Unknown query keys are still ignored, deliberately.** A gallery link shared
with `?utm_source=` on the end must still open the gallery. Strictness is for
response bodies, where both ends are ours.

What changes for callers: the browser sends only queries it built from its own
links, so the page is unaffected in normal use, and a hand-typed hostile query
now renders the "we could not read this" notice instead of a silently different
wall. The exam service must turn `ok: false` into a 400; because the parser
returns a result instead of a query, that is a COMPILE error in the private repo
on the sync PR, not a 500 in production. `parseCaseQuery` still clamps —
one seam was converted, and `packages/contract/test/routes.test.ts` says so out
loud rather than letting the inconsistency pass unnoticed.

## 5. What the schema caught immediately

`docs/ADR-orpc.md` §7 found by reading code that `GalleryListing.entries`
declared `approvedBy` and `GET /gallery` has never sent it. With the schema as
the type, the listing entry is a `PublicGalleryEntry` and a response carrying
the approver is the one that fails. `apps/web/test/galleryPage.test.tsx` pins
it: the page renders no card and logs the failing field.

That is the answer to "what does validation buy that the route manifest does
not". The manifest checks that a route exists and names a type. It cannot check
that a body matches. This one did not.

## 6. Purity, and the private repo

`packages/contract/test/purity.test.ts` still passes. Every source-text rule —
no `node:` import, no `process.env`, no clock, no randomness, no `fetch`, no
`pg` — is green over the new files, and `grep -rl "node:"` over zod's shipped
`dist` returns nothing.

Exactly one line changes, and it is a deliberate policy edit:

```
-    expect(deps).toEqual(["@ailx/report"]);
+    expect(deps).toEqual(["@ailx/report", "zod"]);
```

The private repo vendors `packages/contract/src`, `test` and `package.json` byte
for byte. `sync:shared:check` does not break — it compares bytes — but the
vendored `package.json` now names `zod`, so the private repo must install it on
that PR, and its `handleListGallery` must handle the parser's result type. Both
are compile-time failures there, which is where they belong.

## 7. The suite, the builds and lint

- `AILX_TEST_FORKS=2 pnpm test`: **203 files, 2797 passed, 4 skipped, 0 failed.**
- `pnpm -r build`: green, including `packages/core/test/frontendOnly.test.ts`
  (no `app/api/**` route added, no server adapter, no banned dependency) and
  `packages/content-tools/test/public-tree.test.ts`.
- `AILX_BACKEND=1 pnpm --filter @ailx/web build`: green.
- `pnpm lint`: 0 errors, 123 warnings, 42 infos — one warning FEWER than the
  baseline's 124, because the `exhaustive-deps` disable in `ConnectPanel` is
  gone.

One test-harness change was forced and is worth knowing about: TanStack Query
notifies through its own scheduler, so a query resolves a MACROTASK after the
fetch. One empty `act()` used to be enough; `flushAsync()` in
`apps/web/test/helpers/clientPage.tsx` now turns the timer three times. Without
it the second render in a suite stays on "Loading…" — a failure that looks like
a broken page and is not.

## 8. The decision

**Adopt both, with the schema table split out of `routes.ts` (§3.2).**

zod earns its bytes where a body is read: it is one definition instead of two,
it caught a live type overstatement on the first route it was pointed at, and
it made a query parser's silent clamp into an explicit refusal. It costs
15.4 kB gzip on the one page that uses it, and — after the split — nothing at
all on the build that cannot use it.

TanStack Query costs +7.7 kB gzip on EVERY page of the static export, because
the provider is in the root layout, and it buys that build nothing today: the
Pages export reads no service. It buys the hosted build a cache, request
dedup, and the deletion of a hand-rolled cancellation protocol that had four
real defects in the one place it was written twice. That is the honest trade,
and 7.7 kB is a third of what oRPC was rejected for.

Two conversions, not a migration. 37 routes have no schema and every other read
still goes through the same seam, unchanged.

## 9. What would make this the wrong call

- **The static export's budget matters more than the hosted build's cache.**
  +7.7 kB gzip on nine pages that never call a service is a real cost. If the
  Pages export becomes the product, mount the provider only in the hosted tree
  and this number goes to zero.
- **`zod/mini` stops being a readability tax.** If the schema table grows past a
  handful of routes, 8 kB gzip on the hosted pages is worth the dialect. The
  measurement in §3.4 is cheap to re-run.
- **The 37 unvalidated routes stay unvalidated.** One validated route is a
  decision; one validated route two years from now is a claim the codebase does
  not honour. Either fill the table in or delete it.
- **The `response` string and the schema drift.** Nothing compares them. If that
  happens once, the fix is to make the manifest hold the schema and derive the
  string from it, which is a bigger change than this branch.
- **TEN-62 moves the OpenRouter token exchange into the exam service.** Then the
  `useMutation` in `ConnectPanel` disappears with the code it wraps, and the
  library's only write-path caller goes with it.
- **A response schema rejects a body the service legitimately changed.** Strict
  objects refuse unknown keys, so an additive field on the service side breaks
  the page until this repo ships. That is the intended failure, and it is only
  safe while both ends deploy under one team.
