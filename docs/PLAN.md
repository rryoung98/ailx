# AILX Build Plan

Derived from spec §18 (Roadmap) and §11 (Architecture). Status legend: [ ] todo, [~] in progress, [x] done.

## Phase 0 — Repository & skeleton
- [x] Monorepo scaffold (pnpm workspaces, TypeScript, vitest, CI)
- [x] `packages/core`: TrackPlugin interface (apiVersion 2), content addressing, purity sandbox
- [x] `apps/web`: Next.js static-export shell, live on GitHub Pages

## Phase 1 — Content pipeline (spec §14)
- [ ] Instrument package loader (manifest.yaml → validated in-memory instrument)
- [ ] Content addressing CLI: hash items, verify `bank.sha256`, compute `rubric_version`
- [ ] Golden-fixture harness per track (CI gate on scoring drift)
- [ ] OCI packaging of `instruments/2026.1` (cosign, load-by-digest) — later

## Phase 2 — Platform core (spec §11, §14 schema)
- [x] Postgres schema (`db/schema.sql`): instruments, track_versions, attempts, responses (append-only), scores, judgments, transcripts
- [ ] Auth: Clerk behind an `AuthProvider` interface (keys borrowable from ../exchequer for dev)
- [ ] Session engine: 4-track session structure, timing, resume
- [ ] Track plugin runtime: startSession / ingest / pipeline stages / pure score()

## Phase 3 — Tracks
- [ ] T2 first (closest to a classic item bank): swipe + replay UI, item delivery, response capture
- [ ] T3 instrumented assistant: xAPI-shaped events (prompted/revised/regenerated/submitted), transcript table with `revision_of`
- [ ] T1 sandbox: CSP opaque-origin spike, artifact hosting, Playwright capture job
- [ ] T4 generative direction: model calls, gallery governance

## Phase 4 — Judging pipeline (spec §11)
- [ ] Cloud Tasks spine: capture → judge → aggregate → scored
- [ ] Vertex AI structured-output judge calls, x3 samples, median + disagreement flag
- [ ] Idempotency via DB uniqueness constraint, not queue de-dup
- [ ] Bias correction + human adjudication queue (top decile)

## Phase 5 — Psychometrics, export, ops
- [ ] Scoring composite + performance bands
- [ ] Export tiers (participant / institution / research / regulator)
- [ ] BigQuery telemetry, xAPI export endpoint
- [ ] Infra: Cloud Run + LB + Cloud Armor, Cloud SQL, 4 GCS buckets behind CDN, WIF CI/CD

## Long poles (start immediately per spec)
- [ ] Verify judge/image model availability in `asia-northeast1`
- [ ] DeepSpeak v2 non-academic licence conversation
- [ ] Public Suffix List PR
