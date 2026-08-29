# AILX — The AI Literacy Examination

A performance-based benchmark that measures what a person can actually do **with, against, and about** artificial intelligence — scored on four tracks:

| Track | Name | Measures |
|-------|------|----------|
| T1 | Creative Build | Building a working artifact with AI assistance |
| T2 | Authenticity Discrimination | Detecting synthetic media and reasoning about provenance |
| T3 | AI-Assisted Reasoning | Directing a model through an instrumented assistant |
| T4 | Generative Direction | Steering generative models toward a specified outcome |

Full specification: [`AILX-Spec-2026.1.md`](./AILX-Spec-2026.1.md). Build plan: [`docs/PLAN.md`](./docs/PLAN.md).

## Repository layout

```
apps/web/              Next.js platform (Cloud Run, standalone output)
packages/core/         TrackPlugin interface, scoring purity harness, content addressing
packages/tracks/       t1-creative-build, t2-discrimination, t3-reasoning, t4-generative
instruments/2026.1/    Content-as-data: manifest, rubrics, judge prompts, item banks
infra/                 GCP infrastructure (Cloud Run, Cloud SQL, Cloud Tasks, buckets)
docs/                  Plan, ADRs, runbooks
```

## Core invariants (from the spec)

- **Any score, ever issued, is byte-identically recomputable from stored inputs.**
- `score()` is pure — no I/O, no clock, no randomness. Enforced in CI by a sandbox where `fetch`, `Date.now`, and `Math.random` throw.
- Item banks are content-addressed: `item_id = sha256(canonical_json(item))`. Edits create new items, never mutations.
- Judge prompts are content, hashed into `rubric_version`.
- Responses are append-only; re-scores are inserts linked by `superseded_by`.

## Development

```
pnpm install
pnpm -r test
pnpm -r build
```

## Contributing

Branch → PR → green CI → merge → auto-deploy. `main` is protected; push it through a PR.

1. Branch off `main` and commit small, conventional commits.
2. Open a PR. The `ci` workflow gates it: install, `pnpm -r build` (which typechecks every
   package), `pnpm -r test`, and the `AILX_BACKEND=1` server build, then the Playwright `e2e`
   job against a Postgres service. Both checks must be green to merge.
3. On merge, `pages` runs only after `ci` succeeds on that commit: it rebuilds the static
   export, stamps `/version.json` with the deployed commit, deploys to GitHub Pages, and tags
   the commit `build-<UTC date>-<short sha>`. That tag plus `version.json` is the whole
   versioning story — no changesets, nothing is published.
