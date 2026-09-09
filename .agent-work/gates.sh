#!/usr/bin/env bash
# Gate runner. ONE definition of "green" for every RL worker.
# Usage: bash .agent-work/gates.sh <label>   (run from the worktree root)
# Order is fixed by .github/workflows/ci.yml and apps/web/AGENTS.md:
#   both builds FIRST (bundleSecrecy/bundleBudget read built output), then tests, then lint.
set -uo pipefail
LABEL="${1:-run}"
OUT=".agent-work/gate-${LABEL}.log"
mkdir -p .agent-work
: > "$OUT"
export AILX_TEST_FORKS="${AILX_TEST_FORKS:-2}"   # capped: many worktrees share one laptop
fail=0
step () {
  echo "=== $1" | tee -a "$OUT"
  shift
  if ! "$@" >>"$OUT" 2>&1; then echo "FAIL: $1" | tee -a "$OUT"; fail=1; fi
}
echo "=== static export build" | tee -a "$OUT"
rm -rf apps/web/.next apps/web/out
pnpm -r build >>"$OUT" 2>&1 || { echo "FAIL: static build" | tee -a "$OUT"; fail=1; }
echo "=== hosted build (AILX_BACKEND=1)" | tee -a "$OUT"
rm -rf apps/web/.next
AILX_BACKEND=1 pnpm --filter @ailx/web build >>"$OUT" 2>&1 || { echo "FAIL: hosted build" | tee -a "$OUT"; fail=1; }
echo "=== test" | tee -a "$OUT"
pnpm test >>"$OUT" 2>&1 || { echo "FAIL: test" | tee -a "$OUT"; fail=1; }
echo "=== lint" | tee -a "$OUT"
pnpm lint >>"$OUT" 2>&1 || { echo "FAIL: lint" | tee -a "$OUT"; fail=1; }
# e2e is NOT a gate here: pnpm --filter @ailx/web e2e needs AILX_E2E_API_BASE,
# a throw-away exam service from the PRIVATE repo. Declared out of scope, not skipped silently.
if [ "$fail" = 0 ]; then echo "GATES: GREEN ($LABEL)" | tee -a "$OUT"; else echo "GATES: RED ($LABEL)" | tee -a "$OUT"; fi
exit $fail
