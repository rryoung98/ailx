# Dogfooding & validation protocol

The showcase is validated continuously, not once.

## Live surfaces
- **Site:** https://rryoung98.github.io/ailx/ — redeployed on every push to `main`.
- **/validate** — in-browser checks: content-addressing integrity, scoring purity, golden-fixture reproduction, composite reproducibility. All must show PASS.
- **/exam → /report** — a full four-track attempt runs client-side; the diagnostic report and export tiers are generated from the recorded attempt.

## Manual dogfood pass (run before calling the build done)
1. Open `/` — landing loads, four track cards render.
2. Run `/exam` end to end: complete T1→T4 (fast path is fine).
3. Open `/report` — per-track subscores, composite, band, exports download.
4. Open `/validate` — every check PASS.
5. Reload mid-exam — session resumes from localStorage.

## CI gates
- `pnpm -r build && pnpm -r test` (all packages, golden fixtures, purity harness).
- Static export build of `@ailx/web`.
- Pages deploy must succeed for `main` to be considered healthy.
