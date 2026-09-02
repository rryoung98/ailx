# apps/web/lib

`lib/` is the frontend's cross-cutting, non-visual, browser-safe layer.
Nothing in it renders. `mode.ts` stays at the top level and does not move: it
is the only reader of `NEXT_PUBLIC_AILX_API_BASE` and `NEXT_PUBLIC_BASE_PATH`,
and `test/apiBase.test.ts`, `test/basePath.test.tsx` and
`packages/core/test/frontendOnly.test.ts` name that exact path. `data/` holds
the seam to the exam service and the browser's own storage: `serviceFetch`,
`authHeaders`, `persistence`, `checkpoints`, `localPractice`, `siteUpload` and
the `funnel` emitter. `instrument/` holds the released-practice tier and the
derivation over it: `instrument`, `registry`, `demoItems`, `hostedDeck`,
`sampleAttempt`, `svgArt`, `validateChecks` and the two goldens
`validateChecks` pins. `auth/` mounts Clerk and keeps the identity state.
`server/` is server-only and may be imported only from a `page.api.tsx` or
`route.api.ts`. `origin.ts`, `redirect404.ts` and `reducedMotion.ts` are
single-purpose helpers with callers on both sides of the components/features
line.

Three kinds of file do not belong here. Anything that renders goes to
`features/<surface>/` when one surface uses it and to `components/` when two
or more do (FRONTEND.md §3). Anything whose output reaches a score, a report
number or an audit digest goes to `packages/` — `instrument/` and
`validateChecks` are the known exceptions, and docs/PLAN.md says why they are
still here. Anything with exactly one caller goes next to that caller; it is
not shared yet.
