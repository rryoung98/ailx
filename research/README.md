# research/

Analysis, not shipped code. Nothing in this directory is imported by any
package, built by `pnpm -r build`, or run by `pnpm test`. It sits outside the
pnpm workspace (`pnpm-workspace.yaml` lists `apps/*`, `packages/*`,
`packages/tracks/*`, `services/*`) on purpose, so the numbers behind a design
document can be re-run and argued with without becoming a dependency of the
product.

## `transfer_study_power.py`

Sample size and power for the T3 study in `docs/TRANSFER-STUDY.md` §3: the
test-retest ICC on `reliance.over`, `reliance.under` and `reliance.index`, the
planted-error count a rate needs, the correlation against RAIR and RSR, and the
timed/untimed arms. It is a simulation because the index is a difference of two
proportions measured on the same candidate, and a closed-form power formula
gets that shape wrong.

Re-run:

    uv run research/transfer_study_power.py            # ~2 min, reps = 2000
    uv run research/transfer_study_power.py --reps 4000 --seed 7

`uv` installs numpy and scipy from the inline script metadata; no repo
dependency changes. The script prints the markdown tables that were pasted into
`docs/TRANSFER-STUDY.md` §3.8, plus three self-checks that fail loudly if the
ICC estimator or its confidence interval stops behaving.
