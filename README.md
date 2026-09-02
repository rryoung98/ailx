# AILX — The AI Literacy Examination

[![ci](https://github.com/rryoung98/ailx/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/rryoung98/ailx/actions/workflows/ci.yml)
[![pages](https://github.com/rryoung98/ailx/actions/workflows/pages.yml/badge.svg?branch=main)](https://github.com/rryoung98/ailx/actions/workflows/pages.yml)
[![coverage](https://codecov.io/gh/rryoung98/ailx/branch/main/graph/badge.svg)](https://codecov.io/gh/rryoung98/ailx)

A performance-based benchmark that measures what a person can actually do **with, against, and about** artificial intelligence — scored on four tracks:

| Track | Name | Measures |
|-------|------|----------|
| T1 | Creative Build | Building a working artifact with AI assistance |
| T2 | Authenticity Discrimination | Detecting synthetic media and reasoning about provenance |
| T3 | AI-Assisted Reasoning | Directing a model through an instrumented assistant |
| T4 | Generative Direction | Steering generative models toward a specified outcome |

Full specification: [`AILX-Spec-2026.1.md`](./AILX-Spec-2026.1.md). Build plan: [`docs/PLAN.md`](./docs/PLAN.md).

## Repository layout

**This repository is the FRONTEND.** The exam service — the HTTP API, the append-only store, the
auth providers and the operational item bank with its answer keys — lives in the PRIVATE
`ailx-backend` repository. An exam whose bank is public is not an exam, it is a worksheet.

```
apps/web/                 Next.js frontend. Static export for GitHub Pages, plus a
                          hosted build that adds the database-reading PAGES. No API routes.
packages/core/            TrackPlugin interface, scoring purity harness, content addressing
packages/contract/        the browser-facing API contract: wire types, frozen URL spellings
packages/report/          pure derivation the client renders: composite, insights, player type
packages/session/         event-sourced session engine
packages/tracks/          t1-creative-build, t2-discrimination, t3-reasoning, t4-generative
instruments/demo-2026.1/  the PUBLIC released-practice tier — 20 T2 items whose keys are
                          published on purpose, so the static demo can be played with no server
infra/                    GCP infrastructure
docs/                     Plan, ADRs, runbooks
```

Two gates keep the split honest, and neither is optional:
`packages/core/test/frontendOnly.test.ts` fails if this repo grows a server handler, a server
package or a database dependency; the private repo's `pnpm sync:shared:check` fails if a package
both repos need stops matching this one, with **this repo as the source of truth**. See
`docs/ARCHITECTURE.md` §10.3.

## Core invariants (from the spec)

- **Any score, ever issued, is byte-identically recomputable from stored inputs.** A judge's output *is* one of those stored inputs: LLM judges do not repeat themselves, even at temperature 0, so judging collects evidence once and `score()` replays it. Re-scoring is reproducible; re-judging is not, and we say so.
- `score()` is pure — no I/O, no clock, no randomness. Enforced in CI by a sandbox where `fetch`, `Date.now`, and `Math.random` throw.
- Item banks are content-addressed: `item_id = sha256(canonical_json(item))`. Edits create new items, never mutations.
- Judge prompts are content, hashed into `rubric_version`.
- Responses are append-only; re-scores are inserts linked by `superseded_by`.

## Development

```
pnpm install
pnpm test      # the whole monorepo in ONE vitest, one capped worker pool
pnpm -r build
```

Node 22 or newer (CI runs 22, and `package.json` now says so). In that order or
any other: `pnpm test` does not need a build. Every vitest project resolves
`@ailx/*` to package SOURCE through the one alias table in `vitest.shared.ts`,
so a clean clone is green, and the suite measures this tree instead of the last
build.

`pnpm test` caps the pool at 4 forks because the ceiling is memory, not CPU;
`AILX_TEST_FORKS=8 pnpm test` raises it. `pnpm -r test` runs the same tests one
package at a time, and `vitest run` inside a package debugs just that package.

`pnpm test:coverage` is the same run with v8 coverage (about +2s), which is
what CI publishes. There is no coverage threshold and no build fails on one:
an unmeasured target rewards assertion-free tests (`FRONTEND.md` §7.2). Read
the number, do not chase it.

A new workspace package is picked up automatically: `pnpm-workspace.yaml` and
`vitest-workspace.ts` both match by directory glob, and
`packages/core/test/workspaceWiring.test.ts` fails if a package with a
`package.json` escapes either list — the hole that once hid
`services/openrouter-proxy` from the test run.

## Contributing

Branch → PR → green CI → merge → auto-deploy. `main` is protected; push it through a PR.

1. Branch off `main` and commit small, conventional commits.
2. Open a PR. The `ci` workflow gates it with two jobs, and their names are the branch
   protection contract: **`verify`** (install, `pnpm -r build` — which typechecks every
   package — `pnpm test:coverage`, the coverage report on the PR, and the `AILX_BACKEND=1`
   server build) and **`e2e`** (Playwright against a running exam service). Both must be green
   to merge. A further gate is added as a new job with `needs: verify`, alongside `e2e`,
   never chained behind it.
   Two more workflows run outside the merge gate: `codeql` (static analysis, on merge to
   `main` and weekly) and Dependabot (`.github/dependabot.yml`), which opens one grouped
   minor/patch PR per ecosystem per week and keeps every major on its own so it gets read.
3. On merge, `pages` runs only after `ci` succeeds on that commit: it rebuilds the static
   export, stamps `/version.json` with the deployed commit, deploys to GitHub Pages, and tags
   the commit `build-<UTC date>-<short sha>`. That tag plus `version.json` is the whole
   versioning story — no changesets, nothing is published.
