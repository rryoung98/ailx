# apps/web/lib

`lib/` is the frontend's cross-cutting, non-visual, browser-safe layer, with
three named exceptions that do render: `auth/` mounts the Clerk provider and
its nav, `QueryProvider.tsx` mounts the one TanStack query client in the root
layout, and `instrument/registry.ts` falls back to
`components/PlaceholderRunner.tsx` when a track has no runner. Nothing else
here imports `components/` or `features/`, and
`test/moduleBoundaries.test.ts` fails when a fourth exception appears.

`mode.ts` stays at the top level and does not move: it is the only module that
reads `NEXT_PUBLIC_AILX_API_BASE` or `NEXT_PUBLIC_BASE_PATH`
(`next.config.mjs` reads the base path too, to bake it in), and
`test/apiBase.test.ts`, `test/basePath.test.tsx` and
`packages/core/test/frontendOnly.test.ts` name that exact path.

`data/` holds the seam to the exam service and the browser's own storage:
`serviceFetch`, `authHeaders`, `traceparent`, `modelGateway`, `persistence`,
`checkpoints`, `localPractice`, `siteUpload` and the `funnel` emitter. A
request's headers are composed by `serviceHeaders()`; `test/traceparent.test.ts`
fails a call site that reaches past it to `authHeaders()`.

`instrument/` holds the released-practice tier and the derivation over it:
`instrument`, `registry`, `demoItems`, `hostedDeck`, `sampleAttempt`, `svgArt`,
`validateChecks` and the two goldens `validateChecks` pins.

`auth/` mounts Clerk and keeps the identity state. `server/` is the one
directory here that is not browser-safe: it is server-only and may be imported
only from a `page.api.tsx` or a `route.api.ts`.

`origin.ts` is the one origin predicate, shared by `mode.ts` and
`server/origin.ts`. `reducedMotion.ts` is the one spelling of the
reduced-motion query, read from both `components/` and `features/`.
`redirect404.ts` computes the static export's 404 redirect. It has one
caller, `app/not-found.tsx`, and `app/` holds routes only, so rule 6 has
nowhere else to put it.

Three kinds of file do not belong here. Anything that renders goes to
`features/<surface>/` when one surface uses it and to `components/` when two
or more do (FRONTEND.md §3). Anything whose output reaches a score, a report
number or an audit digest goes to `packages/` — `instrument/` and
`validateChecks` are the known exceptions, and docs/PLAN.md says why they are
still here. Anything with exactly one caller goes next to that caller; it is
not shared yet.
