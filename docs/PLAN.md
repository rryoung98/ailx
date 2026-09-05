# Foray Build Plan

Derived from spec §18 (Roadmap) and §11 (Architecture). Status legend: [ ] todo, [~] in progress, [x] done.

## Phase 0 — Repository & skeleton
- [x] Monorepo scaffold (pnpm workspaces, TypeScript, vitest, CI)
- [x] `packages/core`: TrackPlugin interface (apiVersion 2), content addressing, purity sandbox
- [x] `apps/web`: Next.js static-export shell, live on GitHub Pages

## Phase 1 — Content pipeline (spec §14)
- [x] Instrument package loader (`@ailx/content-tools`)
- [x] Content addressing CLIs: `hash-bank`, `rubric-version`, `build-snapshot`
- [x] Golden-fixture harness per track (CI gate on scoring drift)
- [x] Audit digest from SOURCE: `build-snapshot --scorers <tracks-root>` walks each plugin's `score()` static import closure, hashes the source bytes and emits `scorers[]` into the snapshot; the web app reads it and fails closed. Regenerate with `pnpm --filter @ailx/content-tools run snapshot:2026.1` (CI gate: `packages/content-tools/test/instrument-2026.1.test.ts`).
- [ ] OCI packaging of `instruments/2026.1` (cosign, load-by-digest) — later
- [x] **Cross-package edits are hashed** (`aa16c2a`). `packages/content-tools/src/scorers.ts` followed RELATIVE imports only, so `@ailx/core@workspace:*` pinned nothing and an in-place edit to `packages/core/src/rounding.ts` left every track digest unchanged. A `workspace:` dependency is now followed into its own source: only the symbols actually imported are traced through the barrel to the module that defines them, the barrel is always hashed, and three containment rules (workspace ranges only, every followed file inside the package it resolved from, package-qualified paths) keep it from hashing the world. Registry dependencies stay `name@range` — a published artifact is immutable and its files are not in this tree.
- [ ] **Close the last audit-digest gap**:
  1. *Runtime dependencies are unpinned.* `pnpm-lock.yaml` fixes them for a build, but the digest does not carry a lockfile hash, so "same source, different `three`/`react` patch" is invisible. Fix: hash the lockfile entries reachable from each scorer package into `externals`.
- [ ] **Finish the purity-sandbox move** (FRONTEND.md §9 step 4 leftovers): `apps/web/lib/instrument/instrument.ts` (snapshot → track config derivation, T2 deck sampling, answer keys) and `apps/web/lib/instrument/validateChecks.ts` (the §14 self-audit the `/validate` page renders) are still app-local. Both are blocked on one thing: `instrument.ts` calls `assetUrl()` from `lib/mode.ts`, which reads `NEXT_PUBLIC_BASE_PATH`. Fix: split the pure derivation into `packages/report` (or `@ailx/content-tools`) taking asset resolution as an injected `(path: string) => string`, and leave the Next-specific binding in `apps/web`. `lib/instrument/registry.ts` stays in the app: it dynamic-imports React Runners.

## Phase 2 — Platform core (spec §11, §14 schema)
- [x] Postgres schema (`db/schema.sql`): instruments, track_versions, attempts, responses (append-only), scores, judgments, transcripts
- [x] Auth: `AuthProvider` interface with Clerk + dev adapters (`@ailx/backend`, selected via `AILX_AUTH`; dev needs no keys)
- [x] Hosted persistence phase 1: `@ailx/backend` append-only store + handlers over `db/schema.sql` (PGlite integration tests); Next API route handlers compile only under `AILX_BACKEND=1` (static Pages export unchanged); client persistence seam mirrors the session log server-side
- [x] Session engine (`@ailx/session`): event-sourced machine, budgets, pause/resume, composite §04
- [x] Track plugin runtime wired client-side (registry + plugin score over stored demo judgments)
- [x] Per-attempt T2 item variation: pure seeded sampler in `@ailx/track-t2` (seed = sha256(attemptId + bank hash)); append-only `attempt_decks` exposure log (bank hash + presented item ids) written at attempt creation; server attempt id adopted by the session so presentation/recompute/records share one id
- [x] T1 site deployment pipeline (`@ailx/backend/t1`): strict ZIP validation (zip-bomb/zip-slip/symlink/MIME allowlist, §12 caps), content-addressed snapshot digest over a canonical manifest, SnapshotStore (fs + memory; cloud adapter shape), POST `/api/attempts/:id/site` + sandboxed GET `/api/site/:digest/*` (in-header CSP sandbox, digest-as-capability); client packages the submitted T1 document as a deterministic store-only ZIP at track completion and surfaces the live URL (exam confirmation + report), with typed retry/conflict/rejection handling

## Phase 3 — Tracks
- [x] T2 swipe + replay UI, SDT scoring (d′ + Brier + provenance)
- [x] T3 instrumented assistant: planted errors, xAPI events, revision chains
- [x] T1 sandbox (srcdoc iframe, allow-scripts only, injected CSP); Playwright capture deferred to hosted phase
- [x] T4 generative direction (deterministic demo image model, quota, disclosure)

## Phase 4 — Judging pipeline (spec §11)
- [ ] Cloud Tasks spine: capture → judge → aggregate → scored
- [ ] Vertex AI structured-output judge calls, x3 samples, median + disagreement flag
- [ ] Idempotency via DB uniqueness constraint, not queue de-dup
- [ ] Bias correction + human adjudication queue (top decile)

## Phase 5 — Psychometrics, export, ops
- [x] Composite + bands (probit scale 50/15, quota bands, live on /report)
- [x] Export tiers: individual + research JSON on /report (institution/regulator deferred to hosted phase)
- [ ] BigQuery telemetry, xAPI export endpoint
- [ ] Infra: Cloud Run + LB + Cloud Armor, Cloud SQL, 4 GCS buckets behind CDN, WIF CI/CD

## Long poles (start immediately per spec)
- [ ] Verify judge/image model availability in `asia-northeast1`
- [ ] DeepSpeak v2 non-academic licence conversation
- [ ] Public Suffix List PR

## Dogfood record
- 2026-08-21: full live playthrough on Pages (T1→T4 real runners, report, exports); /validate ALL 7 CHECKS PASS; report raw-key alias bug found via dogfood and fixed.
- Codex (codex-cli) adopted as external code reviewer; findings feed PR-based fixes.
