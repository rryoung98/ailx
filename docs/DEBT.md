# Lint debt

What `pnpm lint` still prints, why each rule is still printing it, and what
would clear it. Biome 2.5.11, `biome.jsonc`. Counts are from
`npx biome lint . --reporter=json` on 2026-09-02, after the fixes in this pass.

Before: 216 diagnostics, 7 of them errors, so `pnpm lint` exited 1 and the CI
`lint` job was red. After: 154 diagnostics, 0 errors, `pnpm lint` exits 0.

## Fixed, not deferred

| Rule | Sites | What was wrong |
|---|---|---|
| `a11y/useAriaPropsSupportedByRole` | 1 | `aria-label` on a role-less div in `app/report/page.tsx`. A screen reader dropped the player-type code. Added `role="img"`. |
| `correctness/noUnusedVariables` | 3 | `ssoBusy` state in the T1 runner, left behind when the connect panel moved to `apps/web/lib/ConnectPanel.tsx` and never read since; `ghostBtn` in the T2 runner; `today` in `practiceDrill.test.tsx`. |
| `correctness/noUnusedImports` | 9 | Dead imports. `apps/web/test/a11y.test.tsx` also dropped `act`, `createRoot` and its `IS_REACT_ACT_ENVIRONMENT` line: that suite walks a static element tree and mounts nothing. |
| `suspicious/noExportsInTest` | 3 | `packages/report/test/efficacyClaims.test.ts` exported three helpers nothing imports. The `export` keywords are gone; the helpers stay. |
| `suspicious/useIterableCallbackReturn` | 1 | `keys.forEach((k, i) => seen[i].add(k))` returned the `Set`. Given a block body. |
| `a11y/noSvgWithoutTitle` | 2 | The two decorative hero SVGs relied on an `aria-hidden` parent. They now carry `aria-hidden` themselves. |

Three sites keep a `biome-ignore` with a reason, because the flagged code is
the input under test: the sparse array in `packages/core/test/hash.test.ts`,
the thenable in `packages/core/test/purity.test.ts`, and the `clock += ms`
test-clock expression in `apps/web/test/practiceDrill.test.tsx`.

## Turned off, with the reason

| Rule | Sites it was flagging | Why it is wrong here |
|---|---|---|
| `performance/noImgElement` | 22 | `next.config.mjs` sets `images: { unoptimized: true }` for the static export, so `next/image` optimizes nothing, and it would bypass the `assetUrl()` base-path prefix. |
| `complexity/noImportantStyles` | 13 | All 13 are in `globals.css` and each overrides a declaration it does not own: the `prefers-reduced-motion` resets, the width/height three.js writes inline on its canvas, and the 16px iOS zoom guard. |
| `a11y/useSemanticElements` | 5 | The fix the rule offers is `<fieldset>`, which carries form-control semantics. The five sites are labelled content groups with `role="group"`, not form groups. |

## Still printing, deferred

| Rule | Count | Why it is deferred |
|---|---|---|
| `a11y/useButtonType` | 41 | The HTML default is `submit`, which only matters inside a `<form>`. The one form in the tree (`components/Moderation.tsx`) has no flagged button, so nothing behaves wrongly today. 41 files touched for no defect is not a reviewable diff; clear it when a file is being edited anyway. |
| `style/useTemplate` | 32 | `"a" + b` versus a template literal, across 17 files. No behaviour change. |
| `correctness/useExhaustiveDependencies` | 32 | Read all 32. Every one is deliberate: mount-only checkpoint rehydration, the one-shot OAuth PKCE exchange, and scroll or reset effects whose extra dependency is the trigger. 19 sit at hooks that already carry an `eslint-disable` line saying so. Widening the T2 deck dependency lists would restart the exposure clock mid-item. React Compiler (FRONTEND.md 7.3) changes what the right answer is, so the rewrite waits for it. |
| `suspicious/noArrayIndexKey` | 14 | Every flagged list is append-only or fixed order: chat logs, option buttons, SVG point sets. Index keys break on reorder, and none of these reorder. |
| `style/noDescendingSpecificity` | 7 | All in `globals.css`. No computed-style difference at any of the seven. Reordering hand-tuned CSS to satisfy a linter risks a real change. |
| `suspicious/noExplicitAny` | 6 | All in `packages/report/test/credential.test.ts`, feeding malformed values to `parseCredentialClaim` on purpose. `as unknown as CredentialClaim` would satisfy the rule and say less. |
| `complexity/useOptionalChain` | 4 | `!x \|\| !x.y` versus `!x?.y`. Same result. |
| `complexity/useLiteralKeys` | 3 | `verbCounts["prompted"]` in `insights.ts`. The string form lines up with the event verbs it counts. |
| Twelve singleton rules | 12 | One site each, all false positives on inspection: `<\/script>` must keep its escape (`t1/src/assist.ts`), the function expression is built with `new` (`core/test/purity.test.ts`), the adjacent spaces are the YAML indent the pattern matches, the `<canvas>` with no tabindex is not focusable, `Object.prototype.hasOwnProperty.call` is already the safe form, and so on. Each would need a `biome-ignore` line; they are listed here instead of scattered through the tree. |

## The rule for changing this file

A rule leaves the deferred table one of two ways: its last site is fixed and it
is promoted to `error` in `biome.jsonc` in that same commit, or it is turned
off with the reason written down. Adding a site to a deferred rule is fine.
Adding a new deferred rule needs a line here saying why.
