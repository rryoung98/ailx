# Batch G — verification of TEN-128, 129, 130, 132, 154 (read-only, branch main)

Repo: /Users/rickyyoung/GitHub/resilience, HEAD = main. No code changed.
Targeted test run (from `apps/web`, per AGENTS.md): `pnpm exec vitest run test/reportUnlock.test.tsx test/scoreOrdering.test.ts test/progressLocalStreak.test.tsx` -> 3 files, 36 tests, all pass.

---

## TEN-128 — Report stays locked after a finished run; "Scores of record" always empty
**Verdict: FIXED-ON-MAIN (frontend half). The second defect is service-side and cannot be closed from this repo.**

Fix commit `2f356bc` "fix(report): unlock the report from the scores the service issued" — body cites TEN-128. `git branch --contains 2f356bc` lists `main`.

Evidence the defect is gone on main:
- `apps/web/features/report/reportGate.ts:105-111` — `scoredTracks()` unions the LOCAL scored tracks with the service's: `const server = (input.scores?.tracks ?? []).filter((t) => t.state === "scored").map((t) => t.trackId); return [...new Set([...input.localScored, ...server])];`. The old gate counted the local event log only.
- `apps/web/features/report/reportGate.ts:120-127` — a finalized sitting returns headline `"Your sitting is finished"` with `cta: null`, so the "Finish the run to unlock it. [Continue ->]" closed loop is gone.
- `apps/web/app/report/page.tsx:216,268` — ONE read (`useScoresOfRecord`) feeds both the gate and the panel, so the two can no longer disagree.
- Test: `apps/web/test/reportUnlock.test.tsx` ("stops telling a finished candidate to finish their run") passes.

Not fixed here, by construction: defect 2, `GET /v1/attempts/:id` returning no `scores` field. The contract still declares it (`packages/contract/src/routes.ts:73-82`, `response: "{ attempt: AttemptRecord, decks?: DeckRecord[], scores?: AttemptScores }"`), but the handler lives in the PRIVATE `ailx-backend` repo (AGENTS.md "The repository split"). The browser now consumes the field correctly; whether the deployed service emits it must be verified there or against staging.

---

## TEN-129 — Run hub says "All four tracks are scored" when two were not
**Verdict: FIXED-ON-MAIN**

Fix commit `ea359cc` "fix(exam): stop asking the service to score an open sitting" (contains TEN-129 work; `git branch --contains ea359cc` -> `main`), which added `apps/web/lib/instrument/scoreSources.ts`.

Evidence:
- `apps/web/lib/instrument/scoreSources.ts:1-15` — module header names TEN-129 and states the rule: a completed hosted track legitimately carries no local score.
- `apps/web/lib/instrument/scoreSources.ts:48-79` — `completionSummary()` DERIVES the sentence. With unscored tracks it returns `"Your work is recorded for every track you sat. T2 and T3 are marked by the exam service, which issues those scores when your sitting is finalized."`. Only when nothing is awaiting does it say `All ${scored.length} tracks are scored in this browser` (line 70) — a scoped claim, not the old falsehood.
- `apps/web/app/exam/page.tsx:754-758` — the run-complete screen renders `{completionSummary(state)}` with the comment "Derived, never asserted (TEN-129)".
- Tests: `apps/web/test/scoreOrdering.test.ts:184` asserts the copy does NOT contain "All four tracks are scored"; line 191 asserts the browser-scoped wording. Passing.
- The 409 error that sat under the old copy is also gone: `postTrackScore`/`scoreTrackOnServer` were deleted (`apps/web/lib/data/persistence.ts:538`) and `apps/web/test/examNoMidRunScore.test.tsx:187` fails the build if any caller returns.

---

## TEN-130 — Hosted mode has no path from a completed run to a share or a credential
**Verdict: NEEDS-PRODUCT-DECISION (still broken; the gate is not in this repo)**

- No commit on any branch references TEN-130: `git log --all --oneline --grep "TEN-130"` -> empty. `grep -rn "nothing to share yet"` over the whole tree -> no hits.
- The refusal string comes from the exam service's `POST /attempts/:id/share` handler, which lives in the PRIVATE backend repo. This repo only holds the caller: `apps/web/features/report/ShareLink.tsx:253` (`request("createShare", …)`) and `:280` (`publishShare`), with the routes frozen in `packages/contract/src/routes.ts:93-96`.
- `apps/web/features/report/ShareLink.tsx:3-18` documents that the SERVER rebuilds the payload and applies the gate, so the frontend cannot loosen it.
- The issue's own fix direction is a decision ("decide what the share gate means for locally scored judged tracks"), not a patch here. Nothing on main or on any branch makes T1/T4 locally-scored tracks satisfy the service gate.

---

## TEN-132 — Finished practice never reaches /progress; the two pages contradict each other
**Verdict: FIXED-ON-MAIN**

Two commits, both on main (`git branch --contains` -> `main`):
- `ab25c5f` "fix(report): stop claiming practice is graded on the server" — TEN-132.
- `294dfdf` "fix(web): show /progress the practice days this browser is holding" — TEN-132.

Evidence:
- `packages/report/src/progress.ts:279-286` — `PROGRESS_BASIS` no longer says practice is "graded on the server" full stop. It now names both homes: "Practice you finish while signed in is recorded and graded by the exam service. Practice you do signed out is kept by your browser and never reaches the service, so only that browser can show it."
- `apps/web/features/progress/ProgressView.tsx:200-215` — a `LocalStreak` section headed "In this browser" renders `local.current` / `local.best` / `local.totalDays` from the same `ailx:practice:v1` ledger `/practice` reads, via `useLocalStreak` (`ProgressView.tsx:60`). "No practice days behind you yet" can no longer appear while /practice shows a streak.
- `apps/web/app/practice/page.tsx:114` and `ProgressView.tsx:45` share ONE wording constant, `LOCAL_PRACTICE_BASIS` (`packages/report/src/localPractice.ts:269`), so a local day is never presented as server-stamped.
- Tests: `apps/web/test/progressLocalStreak.test.tsx` (13 tests) passes, including `:183` `expect(PROGRESS_BASIS).not.toMatch(/graded on the server/)`.
- Note: nothing is POSTed for a signed-out round — deliberate, and stated in `294dfdf` ("this repo has no API to change that"). The contradiction is fixed; the anonymous round still never reaches the service, by design.

---

## TEN-154 — A Vercel preview cannot verify any hosted-mode change
**Verdict: NEEDS-PRODUCT-DECISION (still broken; two of three halves are outside this repo)**

- No commit on any branch references TEN-154: `git log --all --oneline --grep "TEN-154"` -> empty.
- Half 1 (Preview env vars) is Vercel dashboard state, not repo state. `apps/web/vercel.json` sets only the build-time `AILX_BACKEND: "1"`; it cannot scope dashboard variables per environment. `docs/DEPLOY.md:27` instructs "Set these variables on the Vercel project for both Production and Preview", but that line predates the issue (`docs/DEPLOY.md` last touched by `942ea0c`, a rename commit) and is documentation, not a check. Verify with `vercel env ls`.
- Half 2 (Deployment Protection bypass) is Vercel project settings. No bypass token or `x-vercel-protection-bypass` handling appears anywhere in the repo.
- Half 3 (CORS) is Cloud Run config on the private service. This repo still records the boundary as intentional: `docs/DEPLOY.md:66-70` — "A Vercel PREVIEW deployment gets a different hostname, so the service refuses it by design. Verify on the production alias or add the preview host deliberately." `docs/ARCHITECTURE.md:430` says the same. `AILX_ALLOWED_ORIGINS` in this repo belongs to `services/openrouter-proxy` only (`docs/DEPLOY.md:45`).
- The issue itself records a decision of 2026-09-05 that this is deliberately not fixed and that widening the origin allowlist "needs a decision, not a patch". Nothing has changed since.

---

## Branch survey
`git log --all --oneline --grep TEN-128 --grep TEN-129 --grep TEN-130 --grep TEN-132 --grep TEN-154` returns exactly four commits: `294dfdf`, `ab25c5f`, `2f356bc`, `ea359cc`. All four are contained in `main` (plus many `w/*` worktree branches that branched off after them). No unmerged branch carries a fix for any of the five issues.
