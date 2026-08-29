# AILX Build Plan

Derived from spec §18 (Roadmap) and §11 (Architecture). Status legend: [ ] todo, [~] in progress, [x] done.

## Phase 0 — Repository & skeleton
- [x] Monorepo scaffold (pnpm workspaces, TypeScript, vitest, CI)
- [x] `packages/core`: TrackPlugin interface (apiVersion 2), content addressing, purity sandbox
- [x] `apps/web`: Next.js static-export shell, live on GitHub Pages

## Phase 1 — Content pipeline (spec §14)
- [x] Instrument package loader (`@ailx/content-tools`)
- [x] Content addressing CLIs: `hash-bank`, `rubric-version`, `build-snapshot`
- [x] Golden-fixture harness per track (CI gate on scoring drift)
- [ ] OCI packaging of `instruments/2026.1` (cosign, load-by-digest) — later

## Phase 2 — Platform core (spec §11, §14 schema)
- [x] Postgres schema (`db/schema.sql`): instruments, track_versions, attempts, responses (append-only), scores, judgments, transcripts
- [x] Auth: `AuthProvider` interface with Clerk + dev adapters (`@ailx/backend`, selected via `AILX_AUTH`; dev needs no keys)
- [x] Hosted persistence phase 1: `@ailx/backend` append-only store + handlers over `db/schema.sql` (PGlite integration tests); Next API route handlers compile only under `AILX_BACKEND=1` (static Pages export unchanged); client persistence seam mirrors the session log server-side
- [x] Session engine (`@ailx/session`): event-sourced machine, budgets, pause/resume, composite §04
- [x] Track plugin runtime wired client-side (registry + plugin score over stored demo judgments)
- [x] Per-attempt T2 item variation: pure seeded sampler in `@ailx/track-t2` (seed = sha256(attemptId + bank hash)); append-only `attempt_decks` exposure log (bank hash + presented item ids) written at attempt creation; server attempt id adopted by the session so presentation/recompute/records share one id
- [x] T1 site deployment pipeline (`@ailx/backend/t1`): strict ZIP validation (zip-bomb/zip-slip/symlink/MIME allowlist, §12 caps), content-addressed snapshot digest over a canonical manifest, SnapshotStore (fs + memory; cloud adapter shape), POST `/api/attempts/:id/site` + sandboxed GET `/api/site/:digest/*` (in-header CSP sandbox, digest-as-capability)

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
