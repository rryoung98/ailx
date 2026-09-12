#!/usr/bin/env bash
# The gate runner: ONE definition of "green" for this repository.
#
# WHY THIS IS TRACKED. It lived untracked in an agent worktree until 2026-09-09,
# and that was wrong three ways: nobody could review it, nobody else could
# reproduce a run, and each worktree could quietly hold a different version of
# what "green" means. It was then DELETED by the very change it was verifying —
# a verifier inside its own subject can be modified by the subject. It is the
# same shape as `npx tsc` resolving to a decoy (TEN-270): whatever tells you the
# work is good is itself work, and nothing checks it unless you make it visible.
#
# Usage: bash scripts/gates.sh <label>     (from the repository root)
#
# ORDER IS NOT ARBITRARY. It is taken from .github/workflows/ci.yml and
# apps/web/AGENTS.md, and getting it wrong produces a green that means nothing:
#   1. static export build  -> apps/web/out
#   2. hosted build         -> apps/web/.next   (AILX_BACKEND=1)
#   3. pnpm test            AFTER both builds, because bundleSecrecy and
#      bundleBudget read BUILT output and SILENTLY SKIP a mode whose output is
#      missing. Tests first would pass while checking half of what they claim.
#   4. pnpm lint
#
# Playwright e2e is deliberately NOT a gate here: `pnpm --filter @ailx/web e2e`
# needs AILX_E2E_API_BASE, a throw-away exam service from the private repo.
# Declared out of scope rather than skipped in silence.
set -uo pipefail
LABEL="${1:-run}"
OUT="gate-${LABEL}.log"
: > "$OUT"

# Capped on purpose: several worktrees share one machine, and memory rather than
# CPU sets the ceiling (AGENTS.md). CI overrides this to 8.
export AILX_TEST_FORKS="${AILX_TEST_FORKS:-2}"

fail=0
run () { # run <name> <command...>
  local name="$1"; shift
  echo "=== $name" | tee -a "$OUT"
  if ! "$@" >>"$OUT" 2>&1; then echo "FAIL: $name" | tee -a "$OUT"; fail=1; fi
}

rm -rf apps/web/.next apps/web/out
run "static export build" pnpm -r build
rm -rf apps/web/.next
run "hosted build (AILX_BACKEND=1)" env AILX_BACKEND=1 pnpm --filter @ailx/web build
run "test" pnpm test
run "lint" pnpm lint

if [ "$fail" = 0 ]; then
  echo "GATES: GREEN ($LABEL)" | tee -a "$OUT"
else
  echo "GATES: RED ($LABEL) — see $OUT" | tee -a "$OUT"
fi
exit $fail
