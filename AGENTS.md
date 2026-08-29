# AGENTS.md — AILX (resilience)

Monorepo for AILX, the AI Literacy Examination. Spec: `AILX-Spec-2026.1.md`. Plan: `docs/PLAN.md`. Positioning: `docs/POSITIONING.md`.

## Layout
- `apps/web/` — Next.js platform (currently static export on GitHub Pages; hosted backend in progress)
- `packages/core/` — TrackPlugin interface, scoring purity harness, content addressing
- `packages/tracks/` — t1-creative-build, t2-discrimination, t3-reasoning, t4-generative
- `packages/session/` — event-sourced session engine
- `instruments/2026.1/` — content-as-data: manifest, rubrics, judge prompts, item banks
- `db/schema.sql` — Postgres schema (append-only responses; scores superseded, never updated)
- `services/` — openrouter-proxy
- `infra/` — GCP infrastructure

## Commands
- `pnpm install` · `pnpm -r test` · `pnpm -r build` (both must pass before any commit)

## Core invariants (never violate)
- Any score ever issued is byte-identically recomputable from stored inputs.
- `score()` is pure — no I/O, clock, or randomness (CI-enforced sandbox).
- Item banks are content-addressed; edits create new items, never mutations.
- `responses` and `transcripts` are append-only; re-scores are inserts linked by `superseded_by`.

## Code quality and engineering philosophy
- **DRY — flag repetition aggressively.** If you see duplicated logic, types, or constants, consolidate them. Do not leave repetition in place and move on.
- **Well-tested code is non-negotiable.** Prefer too many tests over too few. New or changed code must have tests covering general behavior and edge cases. Do not leave coverage gaps.
- **Right-sized engineering.** Avoid both extremes: under-engineered (fragile, hacky, no error handling) and over-engineered (premature abstraction, unnecessary layers, speculative complexity). Write the minimum structure needed to be correct and maintainable.
- **Handle edge cases thoughtfully.** Err on the side of handling more edge cases, not fewer. Thoughtfulness beats speed — take time to consider what can go wrong.
- **Minimal diff.** Achieve the goal with the fewest new abstractions and files touched.
