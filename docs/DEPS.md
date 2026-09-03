# Dependency weight: what is installed, what is duplicated, what reaches a browser

Date: 2026-09-02. Branch: `w/deps`. Every number below was measured on this
branch; re-measurement instructions are with each table.

Yardstick and method: `docs/ADR-orpc.md` and `docs/ADR-zod-tanstack.md`. The
browser numbers here use the SAME method those two ADRs used, so a figure in
this document is comparable with a figure in either of them.

## 1. Installed weight

`du -sk node_modules` from the repo root after a clean `pnpm install`:

| | KB | MB |
|---|---|---|
| before | 671,476 | 655.7 |
| after (§3) | 669,384 | 653.7 |

The saving is **2,092 KB (2.0 MB)**, and it is small on purpose: this audit
found no unused dependency to delete (§4). The one free duplicate was worth
resolving anyway, and §6 records the one large saving that is available and why
it is not taken here.

Top 25 packages by on-disk size, with the workspace package that pulls each in.
"direct" means it is declared in that package's `package.json`; "transitive"
means something it depends on asked for it. Measured with
`du -sk node_modules/.pnpm/*/node_modules/*` and attributed by walking
`pnpm-lock.yaml` from every workspace importer.

| MB | package | how | pulled in by |
|---|---|---|---|
| 152.6 | `next` | direct | `apps/web` |
| 124.1 | `@next/swc-darwin-arm64` | transitive | `apps/web` |
| 57.6 | `@biomejs/cli-darwin-arm64` | transitive | `.` |
| 36.9 | `three` | direct | `apps/web`, `packages/tracks/t2-discrimination` |
| 31.5 | `hls.js` | transitive | `packages/tracks/t2-discrimination` |
| 28.4 | `three-stdlib` | transitive | `packages/tracks/t2-discrimination` |
| 22.8 | `typescript` | direct | `apps/web`, `packages/content-tools`, `packages/contract`, `packages/core`, `packages/report`, `packages/session`, `packages/tracks/t1-creative-build`, `packages/tracks/t2-discrimination`, `packages/tracks/t3-reasoning`, `packages/tracks/t4-generative` |
| 19.5 | `@mediapipe/tasks-vision` | transitive | `packages/tracks/t2-discrimination` |
| 15.4 | `@img/sharp-libvips-darwin-arm64` | transitive | `apps/web` |
| 13.1 | `playwright-core` | transitive | `apps/web` |
| 9.5 | `esbuild` | transitive | `.`, `apps/web`, `packages/content-tools`, `packages/contract`, `packages/core`, `packages/report`, `packages/session`, `packages/tracks/t1-creative-build`, `packages/tracks/t2-discrimination`, `packages/tracks/t3-reasoning`, `packages/tracks/t4-generative`, `services/openrouter-proxy` |
| 9.4 | `@esbuild/darwin-arm64` | transitive | `.`, `apps/web`, `packages/content-tools`, `packages/contract`, `packages/core`, `packages/report`, `packages/session`, `packages/tracks/t1-creative-build`, `packages/tracks/t2-discrimination`, `packages/tracks/t3-reasoning`, `packages/tracks/t4-generative`, `services/openrouter-proxy` |
| 7.3 | `@dimforge/rapier3d-compat` | transitive | `apps/web`, `packages/tracks/t2-discrimination` |
| 7.1 | `react-dom` | direct | `apps/web`, `packages/tracks/t1-creative-build`, `packages/tracks/t2-discrimination`, `packages/tracks/t3-reasoning`, `packages/tracks/t4-generative` |
| 6.7 | `@clerk/shared` | transitive | `apps/web` |
| 5.6 | `zod` | direct | `packages/contract` |
| 5.0 | `playwright` | transitive | `apps/web` |
| 4.7 | `@clerk/backend` | transitive | `apps/web` |
| 4.3 | `@types/three` | direct | `apps/web`, `packages/tracks/t2-discrimination` |
| 4.2 | `caniuse-lite` | transitive | `apps/web` |
| 4.1 | `jsdom` | direct | `.`, `apps/web`, `packages/tracks/t2-discrimination`, `packages/tracks/t3-reasoning`, `packages/tracks/t4-generative` |
| 3.2 | `vite` | transitive | `.`, `apps/web`, `packages/content-tools`, `packages/contract`, `packages/core`, `packages/report`, `packages/session`, `packages/tracks/t1-creative-build`, `packages/tracks/t2-discrimination`, `packages/tracks/t3-reasoning`, `packages/tracks/t4-generative`, `services/openrouter-proxy` |
| 3.1 | `@babel/types` | transitive | `.` |
| 3.0 | `@tanstack/query-core` | transitive | `apps/web` |
| 3.0 | `undici` | transitive | `apps/web`, `services/openrouter-proxy` |

Read the top of that table before reacting to it. The four biggest entries —
`next`, `@next/swc-darwin-arm64`, `@biomejs/cli-darwin-arm64` and the sharp
libvips binary — are a framework, two native toolchain binaries and an image
codec. None of them is a decision this repository can revisit, and none of them
reaches a browser.

## 2. Duplicates

`pnpm dedupe --check` exits 0: nothing in the tree can be collapsed without
changing a declared range. So the duplicates below are all range splits, and
the question for each is whether a real peer constraint forces it.

Distinct versions of the same package in `pnpm-lock.yaml` before this branch:

| package | versions | forced by | resolvable |
|---|---|---|---|
| `@vercel/blob` | 0.27.3, 2.8.0 | nothing — two workspace packages simply declared different ranges | **yes, done** (§3) |
| `undici` | 5.29.0, 6.28.0 | `@vercel/blob@0.27.3` wanted `^5.28.4`, `@2.8.0` wants `^6.23.0` | **yes** — falls out of the `@vercel/blob` alignment |
| `zustand` | 4.5.7, 5.0.15 | `@react-three/fiber@9` pins v5, `three-stdlib`'s tree still wants v4 | no — inside `@react-three/drei` |
| `fflate` | 0.6.11, 0.8.3 | `three-stdlib` vs `@monogrid/gainmap-js` | no — inside `@react-three/drei` |
| `postcss` | 8.4.31, 8.5.26 | `next` pins 8.4.31 exactly; `vite` wants `^8.5` | no — an exact pin in a framework |
| `undici`-adjacent toolchain: `ansi-regex`, `ansi-styles`, `emoji-regex`, `string-width`, `strip-ansi`, `wrap-ansi`, `signal-exit`, `brace-expansion`, `balanced-match`, `minimatch` | CJS 4/5-era vs ESM 6/7-era | `@isaacs/cliui` and `glob` pull the old halves; vitest/rollup pull the new | no — dev-only, and the split is between two eras of the same author's packages |
| `rrweb-cssom` | 0.7.1, 0.8.0 | `jsdom` depends on both, deliberately (one for parsing, one for serialising) | no |
| `fsevents` | 2.3.2, 2.3.3 | `chokidar@2` inside an older toolchain vs `vite` | no — optional, darwin-only |

Only the first two were free. The rest are pinned by a package this repo does
not control, and forcing them with an override would be a silent compatibility
bet in exchange for a few MB of dev-only disk.

## 3. What changed

**`services/openrouter-proxy`: `@vercel/blob` `^0.27.0` -> `^2.8.0`.**
`apps/web` was already on `^2.8.0`, so the tree carried two copies of the SDK
and two majors of `undici` behind them. The proxy uses exactly two calls,
`put(pathname, body, {access, contentType, addRandomSuffix})` and
`list({prefix, limit, cursor})` -> `{blobs, hasMore, cursor}`; both have the
same signature and the same result shape in 2.8.0, checked against the shipped
`dist/index.d.ts`. `addRandomSuffix` changed its DEFAULT between those majors
and the proxy passes it explicitly, so the default does not apply. `@2.8.0`
requires Node >= 20; CI and Pages both run Node 22.

The proxy's own tests mock `@vercel/blob`, so they prove the handlers still
work — they do not prove the SDK's wire behaviour. The compatibility claim
above rests on the type declarations, and it is stated here rather than implied.

## 4. Unused and undeclared: what was checked, and what was rejected

`pnpm dlx knip@5` over the whole workspace. It reported no undeclared import
and exactly three unused dependencies:

| finding | verdict |
|---|---|
| `react-dom` unused in `@ailx/track-t1`, `@ailx/track-t3`, `@ailx/track-t4` | **FALSE POSITIVE, rejected.** All three import the SUBPATHS: `react-dom/client` (`createRoot`) in the `.tsx` suites and `react-dom/server` (`renderToStaticMarkup`) in the checkpoint suites. Removing it breaks 20+ test files across the three packages. |

Everything else knip reported is an unused EXPORT or TYPE, not a dependency,
and that is a different piece of work with a different risk profile.

Hand checks knip cannot do, all of which came back "keep":

- `@vercel/blob` in `apps/web` — imported only as `await import("@vercel/blob/client")`
  inside `lib/data/siteUpload.ts`. A dynamic import of a subpath; every static
  scan misses it. `packages/core/test/frontendOnly.test.ts` explains why the
  browser is allowed to hold it.
- `@ailx/track-t4` in `apps/web` — reached only through
  `await import("@ailx/track-t4")` in `app/report/page.tsx`.
- `@playwright/test` — Playwright lives outside `pnpm test` (AGENTS.md), so a
  vitest-shaped scan sees the `e2e/` imports but not the runner.
- `@types/three`, `@types/react-dom` — type-only, and `@types/three` is also
  what pulls `@dimforge/rapier3d-compat` into the tree.
- `@ailx/session` in `@ailx/track-t2` — `seededUniform`/`sha256Hex` in `deck.ts`.
- `jsdom` at the repo root — the vitest environment, named in `vitest.shared.ts`
  and never imported.

**Nothing in `dependencies` anywhere in this repo is build-time or test-only.**
Every `dependencies` entry was checked against its import sites: all of them run
in a browser or in the proxy's request path. So no dependency moved to
`devDependencies` on this branch, and the absence of that commit is a result,
not an omission.

## 5. What reaches a browser

Method, from `docs/ADR-zod-tanstack.md` §3.1, because Next's "First Load JS"
under-reports async chunks: gzip level 9 over the bytes actually served, and
per page the gzipped sum of EVERY `<script src>` the prerendered HTML requests.
`rm -rf apps/web/.next apps/web/out` between the two builds.

| | static export | hosted (`AILX_BACKEND=1`) |
|---|---|---|
| all JS, raw | 2,313,971 B | 2,627,146 B |
| all JS, gzip | **688,136 B** | **787,275 B** |
| JS files | 45 | 62 |
| shared by all 9 prerendered pages, gzip | **177,631 B** (16 files) | **214,264 B** (16 files) |

Per page, gzip, every script the page requests:

| page | static export | hosted |
|---|---|---|
| `/report` | 297,274 | 338,430 |
| `/exam` | 277,116 | 320,534 |
| `/validate` | 268,847 | 306,838 |
| `/wall` | 238,000 | 274,564 |
| `/daily` | 235,813 | 272,638 |
| `/` | 235,823 | 272,382 |
| `/practice` | 181,693 | 218,334 |
| `/methodology` | 177,793 | 214,428 |

These reproduce `docs/ADR-zod-tanstack.md` §3.1 to within 0.2% on every page
(that ADR measured 297,579 for `/report`, 238,045 for `/wall`, 688,467 B total;
the hosted total was 787,493 B against 787,275 B here). The method is stable.

### 5.1 What is in the static export that a reader might not expect

The static export is a PUBLIC demo with no exam service behind it, so a
dependency that only makes sense with a backend has no business in it. Grepping
the built client chunks for a marker of each candidate:

| dependency | in the static export? | in the hosted client? |
|---|---|---|
| `three` | yes, 2 chunks | yes, 2 chunks |
| `@tanstack/react-query` | yes, 1 chunk | yes, 7 chunks |
| `zod` | **no** | yes, 1 chunk |
| `@clerk/nextjs` | **no** | yes, 1 chunk |
| `hls.js`, `@mediapipe/tasks-vision`, `three-stdlib`, `@dimforge/rapier3d-compat` | **no** | **no** |

Nothing reaches the static export that should not. zod and Clerk are both
absent from it, which is the condition `docs/ADR-zod-tanstack.md` §3.2 imposed
and `apps/web/next.config.mjs` keeps (it resolves `@clerk/nextjs` to a stub in
the export). `@tanstack/react-query` is in the export because the root layout
mounts a `QueryClientProvider`; that ADR named it as the residue and priced it,
so it is a known cost, not a leak.

`three` is 36.9 MB installed and the largest thing this repo actually ships to a
browser. It is the landing page's 3D scenes and T2's swipe deck — a product
decision, not an accident, and out of scope here.

## 6. Left for a human: `@react-three/drei`

`@ailx/track-t2` depends on `@react-three/drei` for ONE import,
`useTexture`, in `src/swipe/CardScene.tsx`.

Measured cost of that one hook:

- **93.7 MB of `node_modules`** across 35 packages that nothing else in the
  tree needs. The three biggest are `hls.js` (31.5 MB, drei's `<VideoTexture>`),
  `three-stdlib` (28.4 MB, loaders) and `@mediapipe/tasks-vision` (19.5 MB,
  drei's face/hand tracking helpers). That is 14% of the whole install for a
  package this repo uses 40 lines of.
- **0 bytes in either browser bundle.** drei ships ESM and webpack tree-shakes
  it: no chunk in `out/` or `.next/static` contains `hls.js`, `three-stdlib`,
  `@mediapipe/tasks-vision` or `@dimforge/rapier3d-compat` in either build.
- drei's two duplicate ranges (`zustand` 4/5, `fflate` 0.6/0.8) go with it.

`useTexture` is `useLoader(THREE.TextureLoader, url)` plus an `initTexture`
call and a key-mapping `useMemo` — about 40 lines in
`@react-three/drei/core/Texture.js`, and `useLoader` comes from
`@react-three/fiber`, which this repo depends on directly and would keep.

**Not done on this branch, on purpose.** AGENTS.md is explicit that a working
library is not swapped for a smaller one as a drive-by, and T2's swipe deck is
the exam surface: a hand-rolled texture hook that gets suspense or GPU upload
subtly wrong fails in a way the tests here would not catch. The saving is
install-time only. Somebody should decide whether 94 MB of developer disk and
CI cache is worth owning 40 lines of loader code, and that decision belongs to
a person, not to this audit.

## 7. The gate

`apps/web/test/bundleBudget.test.ts` fails when total client JS, the shared
bytes, or any of eight named pages exceeds today's measurement + 5%, in either
build mode. It skips the mode it cannot see, so it costs nothing in a run with
no build output, and it re-states the method in its own header rather than
pointing at this document.

5% is roughly 9-17 kB on the big pages: wide enough that a refactor shuffling
chunk boundaries does not cry wolf, narrow enough that no library arrives
inside it. The oRPC spike, at +21.7 kB gzip on one page, would have failed it.
