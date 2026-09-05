# FRONTEND.md — Foray frontend standard

Foray frontend code must follow this standard. `AGENTS.md` is the root contract (invariants,
commands, engineering philosophy). This file does not repeat it. Where they overlap, `AGENTS.md`
wins.

Section order: 1 Philosophy · 2 Module structure · 3 File tree · 4 Security · 5 Clean code ·
6 Testing strategy · 7 Flexible, not over-engineered · 8 Review checklist · 9 Migration plan.

Status: this repo **does not comply yet**. §9 is the honest gap.

---

## 1. Philosophy

This is a **measuring instrument with a browser front end**. It runs against a clock and produces
a score someone will act on.

- **A UI bug is a scoring defect.** Focus lost on answer commit inflates `decisionLatency`, which
  is a scored input. Jank during a T2 drag contaminates a measurement. Treat interaction defects
  in the exam path as validity defects, not polish.
- **Correctness and recomputability over velocity.** Any score must be byte-identically
  recomputable (`AGENTS.md`). That constrains where logic may live (§2), not just how it is written.
- **The candidate cannot retry.** Items are timed and non-revisitable. Every failure mode needs a
  designed answer: crash → error boundary with resume; offline → visible state; reload → resume
  from the event log.
- **Accessibility is measurement fairness.** An AT user who loses seconds to a focus bug is scored
  differently by the same instrument. That is bias, not inconvenience.
- **The product hosts hostile input.** Candidate HTML is untrusted code we serve. Security is a
  product requirement (§4), not a hardening pass.
- **Static export and server mode are one codebase.** Every rule here must hold in both builds.

Non-goals: design-system generality, framework abstraction, speculative multi-tenant structure.

---

## 2. Module structure

### 2.1 The one boundary rule

> **If it decides a score, it lives in `packages/`. If it draws a pixel, it lives in `apps/web`.**

This rule sets every other boundary.

| Kind of code | Home | Why |
|---|---|---|
| `score()`, rubric math, calibration, composite, tiering, judging | `packages/core` or a `packages/report` | Only `packages/*` is inside the CI purity sandbox (`packages/core/src/purity.ts` stubs `fetch`/`Date.now`/`Math.random`). Logic outside it can silently take a dependency on the clock. |
| Event-log projection, session state | `packages/session` | Shared by web and backend; must not fork. |
| Track UI + track scoring | `packages/tracks/*` | A track is a plugin; its `score()` and its `Runner` ship together. |
| Persistence, auth, snapshot serving, sandbox headers | `packages/backend` | Framework-agnostic; the Next route is a 20-line adapter. |
| Routes, layout, presentation, browser-only state | `apps/web` | Next-specific and disposable. |

**`apps/web` may not contain a function whose output reaches a score, a report figure, or an
audit digest.** If you are about to write one, you are in the wrong package. The derivation
layer now lives in `@ailx/report` (§9 step 4); `lib/instrument/instrument.ts` and `lib/instrument/validateChecks.ts`
are the remaining holdouts, both coupled to the app's asset/base-path seam.

Corollary: **the audit digest must not be computed in the browser.** `scoringDigest()` now reads
a build-time content address of the `score()` source closure from the committed snapshot
(`packages/content-tools/src/scorers.ts`); the browser hashes nothing. Regenerate the snapshot
with `pnpm --filter @ailx/content-tools run snapshot:2026.1` — CI fails if it is stale.

### 2.2 Pure vs impure modules

- A module is **pure** if it has no `fetch`, `Date.now`, `Math.random`, `localStorage`,
  `window`, `process.env`, or module-level mutable state. Pure modules are the default.
- Impure capability is **named and injected**, never reached for: pass `now: number`, pass a
  `StorageLike`, pass a seeded RNG. `packages/session` already does this — copy it.
- Any pure module that feeds scoring gets a `runPure()` test. No exceptions.
- Seeded determinism is not randomness: SHA-256-seeded simulators are pure by construction and
  belong in `packages/`.

### 2.3 Server-only vs client-safe — codify what exists

The repo already uses this convention. It is now required.

1. **`app/api/**/route.api.ts` and `app/**/page.api.tsx`** are the only file patterns that may
   import server capability. `next.config.mjs` keeps `api.ts`/`api.tsx` out of `pageExtensions`
   in the static build, so the export contains no API surface *and* no server-only page. Never
   rename these to `route.ts` / `page.tsx`. A server-only PAGE needs the same escape hatch a
   route does — without it, `app/s/[token]/page.tsx` would be compiled into the GitHub Pages
   export, where it can only fail. `apps/web/test/serverOnlyPages.test.ts` enforces the naming.
2. **`apps/web/lib/server/**`** is server-only. Nothing under `app/**` outside `route.api.ts`,
   and nothing marked `"use client"`, may import from it. It may import `pg`, read
   `process.env`, and touch the filesystem.
3. **Client modules may import `type`-only from server modules.** `verbatimModuleSyntax` makes
   that emit no runtime import
   ([Pocock](https://gist.github.com/mattpocock/e8c00d8dc5440d9366fe2c0eec92677b)); types cross
   the boundary for free, values never do.
4. **Build-mode branching goes through `lib/mode.ts`.** One spelling of
   `NEXT_PUBLIC_AILX_BACKEND`, one truth. Never re-test the raw env var at a call site
   ([Next.js dual-mode drift is invisible unless both builds run in CI](https://nextjs.org/docs/app/guides/static-exports)).
5. **Every exam-service URL comes from the route manifest.** `apiPath()` in
   `@ailx/contract` owns the path; `lib/mode.ts` `apiBase()` owns the host prefix. A path
   spelled at a call site is how a browser once called a route the deployed service did not
   have, so `test/routeManifest.test.ts` parses every source in `apps/web` and fails the build
   when a request call — `fetch`, a `fetchFn`, `serviceFetch`/`useService`, an HTTP verb method
   or `new URL` — is given a literal path that starts with a manifest segment.
6. **`"use client"` is a module-graph boundary, not a runtime one**
   ([Next.js](https://nextjs.org/docs/app/guides/server-and-client-boundary)). Anything a client
   component imports enters the browser bundle. Push `"use client"` to leaves; pass `children`
   to keep server subtrees out of the client graph. `components/ui/NavLink.tsx` is the pattern.
7. **Never `'use server'` in this repo.** It marks every export of a module as a public POST
   endpoint, and static export does not support Server Actions anyway. Use `route.api.ts`.

Three mechanisms overlap because they fail at different times: directory convention (2),
TypeScript (3), and the build (`pageExtensions`). Adopt `import 'server-only'` only if a real
leak happens — see §7.

### 2.4 Barrel files — a decision, not a menu

The field disagrees. [Feature-Sliced Design mandates an `index.ts` per
slice](https://feature-sliced.design/docs/reference/public-api); [TkDodo measured a Next.js app
drop from 11k to ~3.5k modules (−68%) by deleting internal
barrels](https://tkdodo.eu/blog/please-stop-using-barrel-files); [Marvin
Hagemeister](https://marvinh.dev/blog/speeding-up-javascript-ecosystem-part-7/) calls barrels a
top cause of slow JS tooling; [Bulletproof React reversed its own
advice](https://github.com/alan2207/bulletproof-react/issues/154); [Vercel's
`optimizePackageImports` fixes third-party barrels
only](https://vercel.com/blog/how-we-optimized-package-imports-in-next-js), not your `src/`.

**Our rule:**

- **One barrel per workspace package** — `packages/*/src/index.ts` — because that is a real
  published boundary and `@ailx/core` deep imports would couple consumers to file layout.
- **Zero barrels inside `apps/web`.** Import the file. Editors auto-import; the ergonomic
  argument died with that feature, the module-graph cost did not.
- **Never import your own package's barrel from inside that package.** That is the cycle
  TkDodo describes and `import/no-cycle` exists to catch.
- Subpath exports (`@ailx/backend/t1`) are fine and preferred over one giant barrel.

We choose TkDodo/Bulletproof over FSD. FSD provides *enforceable* encapsulation at a tooling cost.
Its own docs acknowledge the cost and admit that barrels do not prevent deep imports. For a repo
this size, workspace packages already enforce those boundaries.

### 2.5 Structure philosophy — Bulletproof, not FSD

We adopt [Bulletproof React](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)'s
shape: feature folders, unidirectional imports `shared → feature → route`, and no cross-feature
imports. We reject [FSD](https://feature-sliced.design/docs/get-started/overview)'s six-layer
taxonomy. FSD's placement decisions are its weakest part — [its own examples were
re-sliced repeatedly](https://philrich.dev/fsd-vs-clean-architecture/) — and `apps/web` is a
7-route app. A taxonomy with more layers than the app has routes is ceremony (§7).

Colocation ([Kent C. Dodds](https://kentcdodds.com/blog/colocation)) applies *within* a feature.
Keep a component, its CSS module, its test, and its local helpers together. Layer-first applies only at
the workspace boundary. When shared logic "loses its home", it moves up one level — to
`components/` or to a package — never sideways into another feature.

---

## 3. File tree

```
apps/web/
  app/                          # routes only: page.tsx, layout.tsx, error.tsx, route.api.ts
    layout.tsx
    global-error.tsx            # REQUIRED: error.tsx does not wrap its own segment's layout
    error.tsx                   # REQUIRED: root recovery ("your run is saved")
    not-found.tsx  globals.css
    page.tsx  methodology/  practice/  validate/  report/  daily/  wall/  exam/
    gallery/  progress/  review/  world/  verify/[code]/  sign-in/  sign-up/
                                # ^ page.api.tsx: built only with AILX_BACKEND=1
    s/[token]/page.api.tsx
    s/[token]/card.png/route.api.ts   # the ONE route handler (AGENTS.md)
  features/                     # one folder per product surface; no cross-feature imports
    daily/  exam/  gallery/  landing/  practice/  progress/
    report/  review/  share/  verify/  world/
                                # exam/RunnerErrorBoundary.tsx is the REQUIRED
                                # exam-scoped boundary (§5); it wraps <mod.Runner>
                                # inside app/exam/page.tsx, not a route error.tsx
  components/                   # used by two or more surfaces
    ui/                         # zero domain knowledge: Annotation, NavLink, PillCTA, Reveal, SiteLink
    CharacterPortrait.tsx  FunnelStep.tsx  GalleryCard.tsx  Loader.tsx
    Moderation.tsx  PageNotice.tsx  PlaceholderRunner.tsx  PracticeDrill.module.css
    ShareTargets.tsx  TrackRadar.tsx
  lib/                          # cross-cutting, non-visual, browser-safe
    mode.ts                     # THE build-mode seam
    data/                       # service seam + browser storage
    instrument/                 # released-practice tier and the derivation over it
    auth/                       # Clerk mount, identity state
    server/                     # server-only; importable ONLY from page.api.tsx / route.api.ts
    origin.ts  redirect404.ts  reducedMotion.ts  QueryProvider.tsx
    README.md                   # what each of the above is, and what may not go here
  test/                         # vitest: unit + component
  e2e/                          # playwright specs + fixtures
  public/  scripts/
packages/
  core/          # TrackPlugin, content addressing, purity harness, hash
  contract/      # browser-facing wire types, URL spellings, request headers
  session/       # event log, projection, StorageLike
  report/        # pure scoring-adjacent + report logic
  tracks/*/      # per-track Runner + score(), shipped together
  content-tools/
```

There is no `styles/` directory yet: the app has one stylesheet,
`app/globals.css`, plus two CSS modules colocated with their callers. A
`styles/tokens.css` that separates tokens from rules is still open work — it
is item 12 of the migration plan (§9).

`app/` holds only routing, so a route file stays readable in one screen. `features/` makes a
surface easy to delete with `rm -rf` plus one route. `components/ui/` contains only presentation
code, so it cannot pull domain code into a landing page. `lib/` is the narrow shared layer. If it
grows past ~10 files again, it has become a grab-bag, and something belongs in a feature or a
package. Keep `e2e/` separate from `test/` because the runners, speed, and flake budgets
differ (§6).

### "Where does X go?" — run this in order

1. **Does its output reach a score, a report number, or an audit digest?** → `packages/`
   (`core`, `report`, or the owning track). Stop.
2. **Does it need `pg`, the filesystem, a secret, or non-`NEXT_PUBLIC_` env?** → `lib/server/`,
   imported only by `route.api.ts`. Stop.
3. **Is it a React component used by exactly one surface?** → that `features/<surface>/`. Stop.
4. **Is it a React component with zero domain knowledge used by 3+ surfaces?** →
   `components/ui/`. Two surfaces is not enough (§7: abstract on the third).
5. **Is it non-visual and used by 2+ features?** → `lib/`.
6. **Otherwise** → colocate next to its only caller. It is not shared yet.

### What moved, and what has not (TEN-63, 2026-09-02)

`apps/web/lib` held 37 components and 24 modules in one directory. It now
holds `mode.ts`, four small helpers and four directories, and the tree above
is what the app actually looks like.

- Everything that renders left `lib/`. One surface → `features/<surface>/`.
  Two or more → `components/`, and `components/ui/` when it also has zero
  domain knowledge.
- The rest of `lib/` split in two: `data/` for the service seam and browser
  storage, `instrument/` for the released-practice tier and the derivation
  over it.
- The `apps/web` guards that scan "the frontend" share
  `test/helpers/browserSources.ts`. Adding a directory of browser code means
  adding it to `BROWSER_ROOTS`, or those guards stop seeing it.
  `packages/core/test/publicClaims.test.ts` cannot import that helper, so it
  carries the same list by hand and says so.

Two rows of the old plan are still open. `lib/instrument/instrument.ts` and
`lib/instrument/validateChecks.ts` belong in `packages/` by rule 1, blocked
on `instrument.ts` calling `assetUrl()` — docs/PLAN.md tracks that one.
`scoringDigest()` in `lib/instrument/registry.ts` belongs in `packages/core`
as a build-time source hash; PLAN.md says the rest of `registry.ts` stays in
the app, because it dynamic-imports React Runners. `svgArt.ts` did not go to `features/landing/` as drafted: its
one caller is `demoItems.ts`, so it sits beside it in `lib/instrument/`
(rule 6). `useSwipeCard.ts` went to `features/landing/` with its one caller
`Teaser.tsx`, and both were deleted afterwards: walking the import graph from
`app/**` showed the teaser was reachable from no route, and the T2 track
package already has the swipe engine the exam actually uses.

`components/` and `features/` now have guards of their own
(`apps/web/test/moduleBoundaries.test.ts`): `components/` may not import a
feature, a feature may not import another feature, `app/` is a leaf nothing
imports out of, and `lib/` renders only in its three named exceptions.

Move by `git mv`, one coherent group per commit, tests updated in the same
commit. No barrels are created on the way.

---

## 4. Security practices

Threat model in one line: **we execute attacker-authored HTML and JavaScript on request, and we
hold a model API key.** OWASP now ranks
[Supply Chain Failures A03 and Misconfiguration A02 in the 2025 Top 10](https://owasp.org/Top10/2025/0x00_2025-Introduction/) —
both are ours. Cite [ASVS 5.0](https://owasp.org/www-project-application-security-verification-standard/)
requirement IDs (`v5.0.0-<ch>.<sec>.<req>`) in security tests so claims are auditable.

### 4.1 Hosting untrusted candidate sites

The current design (`packages/backend/src/t1/handlers.ts` `sandboxHeaders`) is mandatory and
testable.

- **`Content-Security-Policy: sandbox allow-scripts` as a RESPONSE HEADER, never only an iframe
  attribute.** The header applies sandbox flags to a *top-level* document, so protection survives
  "open in a new tab" — [MDN: sandboxing is useless if the attacker can display the content
  outside the frame](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe).
  A `<meta>` CSP **cannot** express `sandbox` or `frame-ancestors`
  ([OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html));
  injecting a meta tag into candidate HTML is not a control.
- **Never `allow-same-origin` together with `allow-scripts`.** The document can then remove its
  own sandbox — [MDN calls this no more secure than no sandbox at
  all](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe).
- **`'self'` is not enough, twice over.** (a) Under `sandbox` without `allow-same-origin` the
  document has an **opaque origin**, so `'self'` matches *nothing* and the explicit origin term
  is load-bearing — this is why `AILX_PUBLIC_ORIGIN` must be correct or assets break visibly.
  (b) More fundamentally, `'self'` trusts the whole origin, and our origin also serves candidate
  JS; [host-allowlist CSPs are bypassable by
  design](https://web.dev/articles/strict-csp).
- **`connect-src 'none'` + `webrtc 'block'` is the exfiltration kill switch**; `form-action
  'none'` kills hosted phishing; `base-uri`/`object-src`/`frame-src`/`worker-src 'none'` close
  base-tag redirection, plugins, nesting, and worker CPU burn. Do not widen any of these to make
  a candidate site "work". Storage and cookies being unavailable to hosted sites is a documented
  **platform constraint**, not a bug.
- **`X-Content-Type-Options: nosniff` plus an explicit allowlisted `Content-Type` on every
  served byte.** Named MDN use case: stopping user-uploaded content from executing as HTML.
- **`Referrer-Policy: no-referrer`** so our app URLs never leak into a candidate page; SVG is
  scriptable in a document context and is treated accordingly.
- **App shell sets `frame-ancestors 'none'`** so a hosted candidate page cannot frame the exam.
- **`postMessage` between shell and preview iframe: explicit target origin, never `*`; receiver
  validates `event.origin` AND the payload shape**
  ([OWASP HTML5](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html)).
- **Separate origin — adopt when we serve authenticated candidate sites or set any cookie on the
  serving origin.** The industry standard is a distinct origin:
  [Google moved high-risk content to `*.googleusercontent.com`](https://security.googleblog.com/2012/08/content-hosting-for-modern-web.html);
  [GitHub moved Pages to `github.io` because a subdomain of the app domain still allows cookie
  tossing](https://github.blog/news-insights/yummy-cookies-across-domains/). We are currently
  same-origin, which the CSP `sandbox` header makes *defensible* but not *standard*. Trigger for
  the move: the first cookie or auth token on the serving origin. Record it as a known deviation
  until then.

### 4.2 Origin and proxy handling

- **`AILX_PUBLIC_ORIGIN` is the source of truth. `Host`/`X-Forwarded-Host` are attacker input.**
  PortSwigger's advice is literally our design: [avoid the Host header in server-side code;
  require the domain to be specified in
  configuration](https://portswigger.net/web-security/host-header). `AILX_TRUST_PROXY` must stay
  opt-in and off by default.
- The redirect `Location` and the CSP allowlist **must be derived from the same resolved
  origin** (`lib/server/origin.ts`), so a misconfiguration fails visibly instead of silently
  widening CSP.
- `normalizeOrigin()` rejecting credentials, paths, query, fragment and non-http(s) schemes is a
  security control. Any change to it needs a test per rejected class.
- Ship `Strict-Transport-Security: max-age=31536000; includeSubDomains` and a deny-all
  `Permissions-Policy` (camera, microphone, geolocation, payment, usb) on hosted candidate
  responses ([Scott Helme](https://scotthelme.co.uk/goodbye-feature-policy-and-hello-permissions-policy/)).
  Decide `includeSubDomains` deliberately if candidate content ever moves to a subdomain.

### 4.3 Secrets

- **No secret may ever appear in `NEXT_PUBLIC_*`.** Next inlines those into the client bundle at
  build time ([Next.js](https://nextjs.org/docs/app/guides/environment-variables)) — so rotating
  the env var does not fix a leak, you must rebuild and invalidate. Model API keys live behind
  `services/openrouter-proxy` or a `route.api.ts`, never in the bundle.
- `NEXT_PUBLIC_AILX_BACKEND` and `NEXT_PUBLIC_BASE_PATH` are the only permitted public vars;
  both are non-secret build facts read through `lib/mode.ts`.
- **A candidate-supplied model key never reaches the browser at all** (TEN-62). The exam
  service does the OAuth exchange and stores the key sealed against the caller's identity;
  this app starts the connection, hands back the `?code=&state=` it was redirected with, and
  displays a 12-hex fingerprint. There is no key slot in `localStorage`, and no request
  builder in `packages/tracks/*` takes a key parameter, so no call site can send one. What a
  model call carries from here is IDENTITY, through `TrackUIProps.modelFetch`.

### 4.4 XSS and URL handling in our own UI

- **`dangerouslySetInnerHTML` is banned in `apps/web` and `packages/tracks`.** If a case is
  genuinely unavoidable, it requires an explicit review sign-off comment naming the sanitizer and
  a test with a hostile fixture. Candidate HTML is *served sandboxed*, never injected into our DOM.
- **Validate every user-controlled `href`/`src` against an `http(s)` allowlist before render.**
  [React does not protect you from `javascript:` or `data:` URLs](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html).
  One shared `safeHref()` in `lib/`; no ad-hoc checks (DRY).
- Prefer `textContent`-shaped sinks; `innerHTML`/`document.write` are review-blocking
  ([OWASP DOM XSS](https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html)).
- External links: `rel="noreferrer"` (implies `noopener`) plus an SR-only "(opens in a new tab)".
- **Trusted Types — adopt when the app shell gains any third-party script.** Roll out
  report-only first ([web.dev](https://web.dev/articles/trusted-types)). Today the shell has no
  third-party script, so this is deferred, not rejected.

### 4.5 Upload validation (T1)

Follow the model in `packages/backend/src/t1/zip.ts` and these rules.

- **Enforce limits on DECLARED sizes before inflating anything** — entry count, per-file bytes,
  total bytes. That is how a zip bomb is refused without being decompressed.
- **Reject, do not tolerate:** encryption, zip64, multi-disk, compression methods other than
  store/deflate, undecodable filenames, CRC mismatch, symlink bits.
- **Zip-slip:** resolve every entry path and reject anything escaping the target
  ([Snyk](https://security.snyk.io/research/zip-slip-vulnerability)). Serve files only by
  manifest lookup, never by joining user path segments onto a filesystem root — anything not in
  the manifest is a 404 by construction (current behaviour; keep it).
- **Public access is by content digest, not by user filename.** The digest is the capability
  ([OWASP File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)).
- **MIME allowlist** on serve; unknown extensions are refused, not guessed.

### 4.6 Supply chain

- `pnpm-lock.yaml` is committed; CI installs with `--frozen-lockfile`.
- **CI installs run with lifecycle scripts disabled** unless a package is explicitly allowlisted.
  The [Shai-Hulud npm worm ran from a post-install script](https://www.wiz.io/blog/shai-hulud-npm-supply-chain-attack).
- **Set `minimumReleaseAge: 1440` explicitly** in `pnpm` config — [it only defaults to 1440 from
  pnpm v11](https://pnpm.io/settings/dependency-resolution); we are on 9.15. Most malicious
  releases are removed within an hour.
- **Pin exact versions in `apps/web/package.json`.** This is an examination instrument: a
  floating `^15.1.0` silently became 15.5.23, and while `scoringDigest()` hashes bundled output
  a minor bump literally changes the audit digest.
- Any third-party `<script>`/`<link>` needs [SRI `integrity` +
  `crossorigin`](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity).
  Today there are none — keep it that way; a new frontend dependency in the shell is a review
  event.
- If we ever publish a package: [npm trusted publishing +
  `--provenance`](https://github.blog/security/supply-chain-security/our-plan-for-a-more-secure-npm-supply-chain/).

### 4.7 Never trusted from the client

In a scored exam, the browser is the candidate's territory. In hosted mode the server treats
these as **advisory only**: client-computed scores, client-reported timings and latencies, item
answer keys, attempt completion claims, and item selection. `packages/*` recomputes the score of
record on the server from the append-only event log. The static demo build has no server and
therefore issues **no score of record** — the UI must never imply otherwise (`lib/mode.ts`
`footerModeCopy()` is the precedent: say what the build actually does).

---

## 5. Clean code rules

- **Components render; they do not decide.** A component that computes a scored value is
  misfiled (§2.1). Extract to a pure function, test it there.
- **Size:** if a component file exceeds ~200 lines or its JSX needs scrolling to understand,
  split by *responsibility*, not by line count. `app/exam/page.tsx` at 480+ lines is a phase
  machine, a clock, a persistence shim and a layout in one file — that is four files.
- **Props first, composition second, context last.** [Move state down or pass expensive subtrees
  as `children`](https://overreacted.io/before-you-memo/) before adding a prop; add context only
  for data many components at many depths need
  ([React docs](https://react.dev/learn/passing-data-deeply-with-context)). This repo correctly
  has **no state library** — keep it that way (§7).
- **Effects synchronize with external systems. Nothing else.** Anything derivable from props or
  state is [computed during render](https://react.dev/learn/you-might-not-need-an-effect). Every
  subscribing/timing/allocating effect returns a cleanup.
- **Memoization: adopt React Compiler; stop hand-memoizing new code.** The compiler's
  memoization is usually [as precise or more so](https://react.dev/learn/react-compiler/introduction).
  Two nuances the popular framing gets wrong: it only helps *update* performance (not bundle or
  load), and the React docs say **leave existing `useMemo`/`useCallback` in place** rather than
  mass-deleting them. New code: none. `useMemo` remains a legitimate escape hatch when a value
  is an effect dependency.
- **`react-hooks/exhaustive-deps` suppressions are review-blocking.** There are 7 today; each is
  a latent stale-closure bug and each blocks the compiler, which requires the Rules of React.
- **Error boundaries are a requirement.** `app/global-error.tsx` (must render its own
  `<html>`/`<body>`), `app/error.tsx`, and an exam-scoped boundary around `<mod.Runner>` that
  reports the crash as a track event and offers checkpoint resume. `error.tsx` does **not** wrap
  its own segment's layout, which is exactly why `global-error.tsx` is not optional
  ([Next.js](https://nextjs.org/docs/app/api-reference/file-conventions/error)). Boundaries must
  be Client Components, and they do not catch event-handler or post-render async errors — catch
  those into state explicitly. `use()` cannot be wrapped in `try/catch`
  ([React](https://react.dev/reference/react/use)), so a boundary is the only handler.
- **Accessibility is correctness.**
  - [First Rule of ARIA](https://www.w3.org/TR/using-aria/): native element first. No ARIA beats
    bad ARIA.
  - Custom composites follow [APG](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/):
    one tab stop, arrow-key navigation inside, no keyboard trap.
  - **Never disable the control the user just activated** — focus falls to `<body>`. Use `inert`
    on the surrounding region instead, and move focus deliberately.
  - Dialog/sheet: move focus in on open, contain the tab sequence, `aria-modal`, `Escape`
    closes, focus returns to the trigger ([APG dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)).
    Prefer native `<dialog>` + `inert` over a hand-rolled trap
    ([Scott O'Hara](https://www.scottohara.me/blog/2019/03/05/open-dialog.html)).
  - `role="alert"` must **not** move focus, and is not announced if it exists before load —
    render the live region first, fill it after.
  - WCAG 2.2: focus indicator ≥ a 2px perimeter at ≥3:1 focused-vs-unfocused (2.4.13) and never
    entirely obscured by sticky chrome (2.4.11).
  - Phase/route change: **move focus to the new view's heading**; Marcy Sutton's user testing
    ranks heading > wrapper > top-of-page
    ([Gatsby](https://www.gatsbyjs.com/blog/2019-07-11-user-testing-accessible-client-routing/)).
  - Global key handlers must guard `altKey/metaKey/ctrlKey`, `isComposing`, and
    `input/textarea/[contenteditable]` targets, and be scoped to their container — never
    `window` — on any screen where a keypress commits a scored answer.
  - `docs/A11Y.md` is a product artifact. If it disagrees with the shipped tokens, the PR is
    incomplete.
- **Styling: tokens + CSS Modules. One opinion, three rejections.**
  - **Reject the single 1,325-line global stylesheet.** It is three competing specificity systems
    (global sheet + inline `style={{}}` + a package-scoped `<style>` string) and ships 47.3 kB of
    render-blocking CSS to `/exam`, ~45% of it landing-page cinema that the exam never uses.
  - **Reject inline `style={{}}` for anything repeated.** Five identical hard-coded
    `#3a1f1f`/`#7a3b3b` alert blocks in one file is exactly the DRY violation `AGENTS.md`
    forbids — and they are dark-theme leftovers that never followed the light-palette migration,
    which is the point: inline styles do not participate in a theme.
  - **Reject runtime CSS-in-JS.** It forces `'use client'` boundaries
    ([Next.js](https://nextjs.org/docs/app/guides/css-in-js)) and adds runtime cost
    ([Magura](https://dev.to/srmagura/why-were-breaking-up-wiht-css-in-js-4g9b)) for zero benefit
    here.
  - **Reject a Tailwind migration.** Not because Tailwind is bad — [Next.js recommends
    it](https://nextjs.org/docs/app/getting-started/css) — but because this app's distinguishing
    CSS is hand-written scroll-driven animation and `@supports` gating, and a rewrite buys no
    correctness. §7 applies.
  - **Adopt:** `styles/tokens.css` as the single token source (option tokens separate from
    semantic decision tokens, [Curtis](https://medium.com/eightshapes-llc/naming-tokens-in-design-systems-9e86c7444676));
    `globals.css` under `@layer reset, tokens, base, utilities` and nothing route-specific;
    a colocated `*.module.css` per component; landing cinema in a route-scoped file so `/exam`
    stops paying for it.
- **three.js/R3F:** mutate in `useFrame`, never `setState` per frame; `frameloop="demand"` for
  static scenes; explicitly `dispose()` geometries/materials/textures on unmount — three does not
  GC GPU memory ([R3F pitfalls](https://r3f.docs.pmnd.rs/advanced/pitfalls)). Keep the existing
  `loadSceneModule()` seam: nothing statically reachable from a route may import `three`.
- **Naming:** components `PascalCase.tsx`, hooks `useThing.ts`, pure modules `camelCase.ts`,
  server-only under `server/`. No file named `utils.ts` (§7).
- **TypeScript:** `strict` + `verbatimModuleSyntax`. Zero `any`, zero `@ts-ignore` — the repo is
  at zero today; that is now the floor, not an achievement.

---

## 6. Testing strategy

Today there are ~1,077 vitest tests and **zero E2E**. `docs/PLAN.md` deferred Playwright "to the hosted
phase". The hosted phase has arrived.

### 6.1 Our position in the pyramid-vs-trophy fight: neither

The debate is [largely semantic — trophy advocates are attacking *solitary* (mock-heavy) unit
tests, and what they call "integration" is what Fowler calls a *sociable unit
test*](https://martinfowler.com/articles/2021-test-shapes.html). We adopt Searls' framing quoted
there:

> "People love debating what percentage of which type of tests to write, but it's a distraction…
> Focus on [tests that] establish clear boundaries, run quickly & reliably, and only fail for
> useful reasons."

There is **no ratio target.** Classify tests by resources and determinism
([Google test sizes](https://testing.googleblog.com/2010/12/test-sizes.html)) and place each test
at the cheapest level that can actually observe the behaviour.

### 6.2 The decision rule

| Level | Runner | Owns | Rule |
|---|---|---|---|
| **Unit** | vitest, node env | Scoring, projection, zip validation, origin normalization, digests | Anything pure. Scored logic additionally runs under `runPure()`. Exhaustive edge cases live *here* — they are ~1000× cheaper than E2E. |
| **Component** | vitest + jsdom | Rendering, roles/names, prop-driven behaviour, copy | Query by `getByRole` + name; [`getByTestId` is a last resort and a smell](https://testing-library.com/docs/queries/about/). Never assert on internal state or `container.querySelector`. |
| **Component (browser)** | vitest browser mode | Focus order, focus trap, `inert`, visibility, pointer/drag, canvas | **Adopt when the first focus regression is fixed** (§9). [jsdom "only simulates" a browser](https://vitest.dev/guide/browser/why); it has no layout and unreliable focus semantics. |
| **E2E** | Playwright | Navigation, redirects, resume, real server, real headers, full journey | Terminal user-visible states only (§6.4). |

Placement question: *can this behaviour be observed without a real browser?* If yes, it does not
belong in E2E.

### 6.3 Tool: Playwright

We choose Playwright over Cypress and WebdriverIO. It drives the browser out-of-process, so
multi-origin and multi-tab work natively — [Cypress is one superdomain per test and needs
`cy.origin`](https://docs.cypress.io/app/references/trade-offs), and we must navigate between the
app origin and a sandboxed candidate site with an opaque origin. Cheap `BrowserContext`
isolation makes parallel workers safe. `page.clock` gives deterministic time. `page.route` stubs
third parties. Trace viewer makes a CI failure fixable without a repro. `@axe-core/playwright`
covers the a11y floor. WebdriverIO only wins if we need Appium/mobile grids; we do not.

### 6.4 What MUST be covered E2E — and how to assert it

The dogfood found an **infinite redirect loop on the live-site link** and **focus loss on T2
answering** while the unit suite was green. One suite asserted *"a 308 was emitted"* while
the loop existed. That is the whole argument:

> **A status code is one edge of a redirect graph. The user-visible outcome is the graph's fixed
> point.** A cycle `/a → /b → /a` satisfies every per-hop assertion while the browser dies with
> `ERR_TOO_MANY_REDIRECTS`. And [jsdom lists Navigation and Layout as
> unimplemented](https://www.npmjs.com/package/jsdom), so a jsdom test can *never* traverse a
> redirect chain or observe real focus.

**Rule of record:** every navigation/canonicalization/auth-gate behaviour is proven by
`await expect(page).toHaveURL(final)` **plus** a visible terminal element. Status codes, headers
and hop counts are permitted **only as additional diagnostics**, never as the sole proof
([Playwright best practices](https://playwright.dev/docs/best-practices);
[Beck: couple to behaviour, decouple from structure](https://testdesiderata.com/)).

Required specs:

1. **Full candidate journey** — start → T1 → T2 → T3 → T4 → report renders a score. One happy path.
2. **Timer behaviour** — with `page.clock`: warning threshold announced, expiry transitions the
   phase, the clock does not resume after expiry.
3. **Reload/resume mid-exam** — reload during a track; the event log restores state and the
   candidate lands where they left off; assert visible resumed content, not `localStorage` bytes.
4. **T1 upload → live site link actually loads** — click the link, land on the canonical
   `.../index.html` (`toHaveURL`), assert candidate content is *visible*. This is the redirect-loop
   test. Additionally assert `CSP: sandbox allow-scripts` present and `allow-same-origin` absent.
5. **Keyboard-only path through a track** — Tab/Enter/Arrow only; assert focus lands on the
   confidence control after commit, and returns to a sane target after; no keyboard trap.
6. **Error and offline paths** — force a runner throw: the error boundary renders, the run is
   reported as saved, resume works. Offline: the UI states it, and nothing silently drops a response.
7. **`@axe-core/playwright` scan** on landing, exam, and report; zero violations. Rescan after
   opening the confidence sheet — a scan only sees the current state.
8. **The cross-origin preflight** — one OPTIONS to the exam service asserting it allows every
   name in `BROWSER_REQUEST_HEADERS` (`@ailx/contract`) and the method a seeded run is created
   with. The frontend and the service are two origins, so a header the service does not allow is
   a request the browser NEVER SENDS: the app says "Failed to fetch" and every other spec here
   fails at a locator that has nothing to do with the cause. Adding `traceparent` to the browser
   did exactly that on 2026-09-03 (`e2e/preflight.spec.ts`).

### 6.5 Determinism and isolation

- **Seed the deck.** This app has seeded per-attempt item decks. E2E fixtures pin the seed and
  assert on the *pinned* item; a test that says "the first card" without pinning a seed is a
  scheduled flake.
- **Pin the clock** with `page.clock.setFixedTime` for anything time-dependent. Never
  `waitForTimeout`; use retrying web-first assertions.
- **One `BrowserContext` per test**; no shared auth or `localStorage` except via an explicit
  storage-state setup project.
- **Stub only third parties** (`page.route` for model APIs — and the deterministic simulator
  makes even that mostly unnecessary). Keep our own stack real; mocking it recreates the
  mock-heavy solitary tests the whole trophy argument was fleeing.
- **No `if` statements in tests.** A conditional means the test does not know what the app should do.
- **Test data isolation:** one attempt per test, created through the API in a fixture, never
  reused.
- **Where it runs:** PR gate = ephemeral local **production build** (`next build && next start`
  with `AILX_BACKEND=1`) plus a seeded DB, booted by Playwright's `webServer`
  ([Next.js recommends testing the production build](https://nextjs.org/docs/app/guides/testing/playwright)).
  Post-deploy = a **small** smoke suite against staging, because `AILX_PUBLIC_ORIGIN`,
  proxy-header and CDN bugs exist only there. Both builds (static export and server) must be
  built in CI or dual-mode drift is invisible.
- **Flake policy:** `retries: 0` locally, ≤1 in CI with trace on first retry. A flaky test is
  quarantined with a **named owner and a deadline** — never blanket-retried
  ([Fowler](https://martinfowler.com/articles/nonDeterminism.html),
  [Google](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html)).

### 6.6 What must NOT be tested E2E

E2E is slow, flaky, and [hides small bugs behind big
ones](https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html). Unit
tests are strictly better for:

- **Scoring maths, calibration, SDT arithmetic, tier boundaries** — hundreds of cases in
  milliseconds, under `runPure()`. Never assert a score number through the UI.
- **Zip validation, zip-slip, bombs, CRC, MIME allowlist** — byte-level fixtures.
- **`normalizeOrigin` / `resolvePublicOrigin`** — one test per rejected class; a browser adds nothing.
- **Copy, colour tokens, contrast maths** — the existing CSS-string and luminance tests are
  correct and cheap.
- **Every permutation of anything.** E2E covers one representative path per behaviour; variants
  go down a level.
- **Third-party behaviour** we do not control.

Async Server Components are E2E by policy — [React Testing Library cannot render
them](https://nextjs.org/docs/app/guides/testing) — but we have none today.

### 6.7 Visual contracts: what "green" is not

Four true stories from this repo, all of them green at the time:

1. A unit test asserted *"a 308 redirect was emitted"* while an **infinite redirect
   loop** was live. Only a real browser following the chain found it.
2. A T2 scroll test passed because the deck happened to fit a desktop viewport. On a
   390x844 phone the page jumped 464px and the confidence panel landed **above the
   fold**.
3. A crash-recovery fault injector broke `scrollIntoView` to induce a fault. The runner
   stopped calling `scrollIntoView`. The injector then faulted **nothing**, the test still
   passed, and it tested nothing for hours.
4. A dogfooder found the confidence panel **invisible** on provenance items — it rendered
   behind the card. Every DOM assertion passed.

The common cause is
[jsdom lists Layout as unimplemented](https://www.npmjs.com/package/jsdom): every box it
reports is 0x0 at (0,0). "Is this modal centred", "is it above the fold", "is it covered",
"is this tap target big enough" are not questions jsdom answers wrongly — they are
questions it **cannot be asked**. A component test that passes has said nothing about any
of them.

> **Green means every question we asked was answered "yes". It never means the screen is
> right.** A modal that is supposed to be a centred popup and renders in the corner passes
> every DOM test ever written about it.

**Rule of record:** a change to what the candidate SEES ships with a visual contract, or
with a stated reason in the PR why it does not need one. "The unit tests pass" is not that
reason.

#### 6.7.1 Where each assertion belongs

| Question | Where | Why |
|---|---|---|
| Is the right text/role/name rendered? Is the button disabled? | jsdom component test | Cheap, exhaustive, and jsdom answers it correctly. |
| Does the copy say the honest thing? Are the colour tokens right? | unit / CSS-string test | Strings and maths; a browser adds nothing. |
| Is it on screen, centred, unclipped, uncovered, big enough to tap? Did the page jump? | **Playwright, `e2e/visual.ts`** | Needs a layout engine. jsdom cannot host these at all. |
| Does focus really move? Is there a keyboard trap? | Playwright | jsdom's focus semantics are unreliable. |
| Where does this redirect chain END? | Playwright | A cycle satisfies every per-hop assertion (§6.4). |
| Does the score come out right? | unit, under `runPure()` | Never through a UI. |

#### 6.7.2 The contracts

`apps/web/e2e/visual.ts` is the only place these are implemented; a spec that re-measures
a box by hand is a bug.

- `expectInViewport` — wholly on screen: not above the fold, not below it, not clipped.
- `expectCentred` — centred in the viewport or a named container, within a tolerance.
- `expectNoOverlap` — two elements share no pixel (e.g. *confirm* and *keep working*).
- `expectCovers` — a veil really covers the workspace it hides.
- `expectMaxHeight` — a box stays inside a stated budget. Written for the sticky header,
  which is chrome on every page: when it wraps it spends the visitor's first screen, and
  the CSS token that claims its height is a string a jsdom test can happily confirm while
  the rendered header is a different size.
- `expectNotOccluded` — nothing PAINTS over it. Pointer-events are neutralised for the
  probe, because the card that hid the confidence panel had `pointer-events: none` and a
  plain hit test would have looked straight through it.
- `expectTapTarget` / `expectTapTargets` — interactive targets are ≥ 44x44 CSS px
  (WCAG 2.5.5 AAA; this is a timed exam and a missed tap is charged to the candidate).
- `expectNoHorizontalOverflow` — the page does not scroll sideways, and the culprit
  element is named in the failure.
- `expectScrollStable` / `expectStablePosition` — nothing moves under the candidate
  across a transition. Both exist on purpose: scroll anchoring deliberately changes
  `window.scrollY` in order to keep the pixels still, so `scrollY` alone is neither
  necessary nor sufficient — what the candidate experiences is whether the thing they are
  looking at stayed put.
- `expectTextNotClipped` / `expectNoInnerScroll` — content is not silently truncated by
  its container, and a modal step is not something you must scroll INSIDE.

Two harness details can make a true contract report a false failure:

- **Settle the harness's own scroll first.** Playwright scrolls an element into view as
  part of its actionability checks, so a click can move the page for reasons that have
  nothing to do with the app. `settleOn` in `visual.spec.ts` does it explicitly, with
  `scrollIntoView({ block: "nearest" })` rather than Playwright's
  `scrollIntoViewIfNeeded()` — that one is satisfied by a visibility RATIO and leaves an
  element hanging a pixel or two off the edge, which is exactly the state the next
  assertion is there to judge. `settleAndSee` retries the scroll and the assertion as one
  unit, because a page that is still reflowing can invalidate a scroll that was right when
  it was made.
- **Wait for the page to stop moving.** `awaitStableLayout` waits for `document.fonts.ready`
  and then for two identical measurements of the box. Web fonts land after first paint and
  change every line box, and the T2 deck sizes itself from a `ResizeObserver`; measuring
  across either asks about the settling rather than the product. Without it the T2
  stability specs failed intermittently by 2–19px — a flake that looks exactly like a bug.

`expectScrollStable` takes a tolerance for the same honest reason: scroll anchoring
deliberately moves `window.scrollY` in order to hold the pixels still, so a couple of
pixels there is the browser doing the right thing. `expectStablePosition`, nested inside
it, is the assertion that proves nothing actually moved.

#### 6.7.3 A test that cannot fail is worse than no test

It costs the same to run and wastes the reviewer's trust. In story 3 above, the injector
patched a call the code no longer made.

- **Every visual contract is mutation-tested.** `e2e/visual-contracts.spec.ts` breaks the
  exact thing each contract protects — a corner modal, a panel above the fold, a
  `pointer-events: none` cover, a 20px button, a 130px header, a 464px scroll jump — and
  proves the contract FAILS, with the message it promises. It runs in the normal suite: it
  is the regression test for the test layer. Its own good-layout case is the other half:
  a contract that fires on a correct page gets switched off within a week.
- **The mutation tests are themselves checked, by neutering the contract.** A mutation
  test only proves something if it goes red when the assertion it exercises is removed.
  All thirteen helpers in `visual.ts` — `expectInViewport`, `expectCentred`,
  `expectNoOverlap`, `expectNotOccluded`, `expectMaxHeight`, `expectTapTarget`,
  `expectTapTargets`, `expectNoHorizontalOverflow`, `expectScrollStable`,
  `expectStablePosition`, `expectTextNotClipped`, `expectNoInnerScroll`, `expectCovers` —
  were stubbed to a bare `return` in turn, and in every case the matching mutation test in
  `visual-contracts.spec.ts` went RED. A contract nobody can make fail does not ship. Run
  the same campaign whenever a contract is added; it takes about a second per helper
  against an already-running server (`AILX_E2E_REUSE_SERVER=1`).
- **A fault injector must follow the code it faults.** It patches something the runner
  demonstrably still calls, and the spec that uses it asserts the fault ARRIVED (a visible
  crash notice), never merely that the run survived. It lives in `e2e/fixtures.ts`, once,
  so it cannot rot in one copy. Today it patches `HTMLElement.focus`, which the T2 runner
  calls the moment a card is answered (`Runner.tsx`, focusing the confidence slider).
  That premise is pinned by a UNIT test, so the injector cannot rot silently again:
  *"still focuses the slider — preventScroll must not cost focus"* in
  `packages/tracks/t2-discrimination/test/confidenceInPlace.test.tsx` names the injector
  in its comment. If it goes red, the injector moves with the code.
  The three specs that use the injector all seed, so they need the exam service
  (`AILX_E2E_API_BASE`); the unit test above is the part that runs everywhere.

**What this layer has already found.** `expectNoInnerScroll` measured the T2 confidence
panel at 308px of content inside a 300px panel on a 390x844 phone: a candidate had to
scroll 8px INSIDE a timed, scored step to reach *Lock in*. Every jsdom test of that panel
passed, and always would have — the floor is now 312
(`packages/tracks/t2-discrimination/src/SwipeDeck.tsx`).

#### 6.7.4 Screenshot baselines: few, deterministic, or not at all

Use a baseline only where a human would notice the regression instantly AND the pixels are
deterministic. Anything else becomes flake that people learn to click past. That costs more
than the bug it was meant to catch.

`e2e/visual-baselines.spec.ts` holds four ELEMENT screenshots of copy-only surfaces with
no seeded content and no clock in frame: the pause overlay, the time-up notice, the runner
crash notice, and the shared player-type card. Motion is off twice over (the app's
reduced-motion branch and Playwright's `animations: "disabled"`), fonts are awaited, and
the viewport is pinned.

Deliberately NOT baselined: the T2 card and its confidence step (the deck is seeded per
attempt, so the shot would be mostly mask) and the landing hero (an animated canvas plus a
randomly drawn practice card). Both are covered geometrically instead, which is the honest
tool for them.

Baselines are per platform — Playwright puts `{platform}` in the snapshot name — and the
committed ones are darwin (`*-chromium-darwin.png`), so the CI job that runs them runs on
macOS. Regenerate with `pnpm --filter @ailx/web e2e --update-snapshots` and LOOK at each
image before committing it; an unread baseline is a rubber stamp.

#### 6.7.5 A green run can also be a lie about WHERE it looked

The same bug has two more forms:

- **A dev server poisons a build-output scan.** `next dev` writes development chunks into
  `apps/web/.next/static`, and `test/bundleSecrecy.test.ts` greps that directory. Run
  `next dev` in the same tree and the scan counts 24 `"key":"ai"` against a budget of 12
  and fails for reasons that have nothing to do with secrecy — or, worse, a future scan
  passes on dev output that a production bundle would have failed. The secrecy scan reads
  BUILD output: stop the dev server (and do not run a second build in `apps/web`) before
  trusting it, since `next build` and `next dev` fight over the same directory.
- **A suite that resolves `dist/` measures the last build, not this tree.** Every
  `@ailx/*` package has `main: dist/index.js`, so an unaliased vitest project read build
  output: on a clean clone 75 test files failed to collect ("Failed to resolve entry for
  package @ailx/core"), and with a stale build the run passed on code nobody had
  rebuilt. `vitest.shared.ts` holds one alias table pointing every package at its `src`,
  every project uses it, and `packages/core/test/workspaceWiring.test.ts` fails if a
  package stops. The Next builds still consume `dist/`.
- **A surface that cannot be reached is not a surface that passes.** T4's finish step has
  no contract, because in hosted mode the T4 runner deals its content from
  `GET /attempts/:id/track/t4` and this app serves no such route: the track opens on a
  404 notice. The gap is named in `visual.spec.ts` rather than left as an absence.

---

## 7. Flexible, not over-engineered

This section **governs sections 1–6**. `AGENTS.md` requires right-sized engineering and a minimal
diff. A standard that prescribes ceremony contradicts it.

### 7.1 The tradeoff rule

- **Abstract on the third repetition, not the first.** Two similar things are a coincidence;
  three are a pattern. (The five identical alert blocks are well past three.)
- **Structure must remove a real, observed failure**, not a hypothetical one. If a rule here
  cannot name the bug it prevents, it should not be a rule.
- **Prefer deleting to abstracting.** The cheapest module is the one you removed.
- **No speculative layers.** No interface with one implementation, no wrapper component with no
  behaviour, no config for a value that has never changed.
- **No framework within the framework.** Next's router, React's boundaries, and workspace
  packages are our architecture. We do not build a second one on top.

### 7.2 Traps specific to this stack

- **A state-management library.** The repo has none and does not need one: one event log, one
  `project()`, props. Adopt only if two distant subtrees need the same mutable state and
  composition has already failed.
- **Deep folder taxonomies.** FSD's six layers for a 7-route app is more taxonomy than product
  (§2.5). `features/` + `components/` + `lib/` is the ceiling.
- **Barrel mazes.** Already banned in `apps/web` (§2.4).
- **Wrapper components with no behaviour.** `<Button>` that renders `<button {...props}/>` adds
  a file and a bundle entry and removes nothing.
- **Over-mocking.** Mocking our own modules to test our own modules produces [tests that break on
  refactor and pass while broken](https://kentcdodds.com/blog/testing-implementation-details).
- **A generic `utils/`.** It becomes the next `lib/` grab-bag. Name modules for what they do.
- **Rewrites disguised as standards.** Tailwind, a design-system package, or an i18n framework
  are all defensible in the abstract and none is justified by a current defect.
- **Coverage targets.** [Beyond ~70% the returns are
  negative](https://kentcdodds.com/blog/write-tests) and coverage-chasing pushes tests toward
  implementation details.

### 7.3 Self-audit — where this document is heavier than the repo justifies

| Rule | Verdict |
|---|---|
| Full `features/` reorganisation (§3) | **Adopt** — but as `git mv` batches, not a rewrite. `lib/` is already a 30-file grab-bag; the failure is observed. |
| New `packages/report` (§2.1) | **Adopt.** Justified by a named invariant (purity/recomputability), not by taste. |
| `import 'server-only'` / `client-only` packages | **Deferred.** Trigger: the first accidental server import in a client module. Directory + TS + `pageExtensions` already give three overlapping checks. |
| Trusted Types (§4.4) | **Deferred.** Trigger: any third-party script in the app shell. |
| Separate origin for candidate sites (§4.1) | **Deferred, documented deviation.** Trigger: any cookie or auth token on the serving origin. |
| Full CSS-Modules migration (§5) | **Scoped.** Do it for exam-path and repeated components. The landing cinema stays a route-scoped stylesheet — porting hand-tuned scroll-timeline CSS to modules buys nothing. |
| Vitest browser mode (§6.2) | **Deferred.** Trigger: the T2 focus fix — that regression is unprovable in jsdom, so it is the trigger by definition. |
| Playwright E2E (§6.4) | **Adopt now**, but the seven specs above are the *ceiling*, not a starting point. Suite budget: under 5 minutes. |
| 200-line component guide (§5) | **Guideline, not a gate.** Reviewers cite responsibility, never line count alone. |
| ASVS IDs in security tests (§4) | **Adopt for the T1 serve/upload path only.** Not for the whole app. |
| React Compiler (§5) | **Adopt.** One config line; it deletes a bug class and seven suppressions. |

If a rule in §1–6 is not in this table and you cannot name the bug it prevents, challenge it in
review.

---

## 8. Review checklist

Check every frontend PR against this list. Each item takes under a minute to check.

**Boundaries**
- [ ] No new function in `apps/web` whose output reaches a score, report figure, or audit digest.
- [ ] Scored logic added to `packages/*` has a `runPure()` test.
- [ ] Server capability imported only from `lib/server/**`, only by `route.api.ts`.
- [ ] No new barrel/`index.ts` in `apps/web`; no `utils.ts`.
- [ ] Value imports do not cross the client boundary where a `type` import would do.
- [ ] Build-mode branching goes through `lib/mode.ts`.
- [ ] Every exam-service URL comes from `apiPath()`; no path spelled at a call site.

**Security**
- [ ] No secret in `NEXT_PUBLIC_*`; no new public env var.
- [ ] No `dangerouslySetInnerHTML`, `innerHTML`, or `document.write`.
- [ ] Any user-controlled `href`/`src` passes the shared `safeHref()` allowlist.
- [ ] Changes to sandbox headers, `normalizeOrigin`, or zip limits carry a test per rejected class.
- [ ] New dependency: justified in the PR body, exact version, lockfile committed.

**Correctness / a11y**
- [ ] Every new interactive surface has an error boundary above it.
- [ ] No control is disabled while it holds focus; focus is moved deliberately on state change.
- [ ] Custom composite = one tab stop + arrow keys; dialog traps, `Escape` closes, focus returns.
- [ ] Global key handlers guard modifiers, IME, and text-input targets, and are container-scoped.
- [ ] Native element used unless a documented reason says otherwise.
- [ ] `docs/A11Y.md` still matches the shipped tokens.

**Code**
- [ ] No new `exhaustive-deps` suppression, `any`, or `@ts-ignore`.
- [ ] No new hand-memoization; no new inline `style={{}}` for a repeated block.
- [ ] Third occurrence of a pattern got consolidated.
- [ ] Effect has cleanup; nothing derivable is stored in state.

**Tests**
- [ ] New behaviour tested at the cheapest level that can observe it.
- [ ] Edge cases covered by unit tests, not by more E2E.
- [ ] E2E asserts a terminal user-visible state (`toHaveURL` + visible element), not a status code.
- [ ] No `waitForTimeout`, no `if`, no unseeded deck, no unpinned clock.
- [ ] `pnpm test` and `pnpm -r build` pass — **and the static export build too**.

---

## 9. Migration plan

The repo does not comply. See `/tmp/ailx-research-01a04bca/frontend-audit.md`. The order reflects
risk removed per line changed. Use one PR per numbered step.

*In flight at the time of writing:* work adding `app/error.tsx`, `app/global-error.tsx`,
`RunnerErrorBoundary`, `PersistWarning` and T2 focus/keyboard tests is uncommitted in the
worktree. If it lands, steps 1, 2, 3 and 9 are done — verify against the checklist in §8 rather
than assuming, and renumber nothing.

### P0 — validity and safety (do first)

1. **Error boundaries.** Add `app/global-error.tsx`, `app/error.tsx`, and an exam-scoped boundary
   around `<mod.Runner>` that records the crash as a track event and offers checkpoint resume
   (`lib/data/checkpoints.ts` already exists). ~60 lines. Today one uncaught throw white-screens a
   candidate mid-exam with the clock running. *Gap: §5.*
2. **T2 focus management.** Stop disabling the button the candidate just pressed; mark the deck
   `inert` instead, move focus to the confidence slider on sheet open, return it to "Lock in".
   This is a measurable score bias against AT users on a scored item, and `docs/A11Y.md`
   currently certifies the path as passing. *Gap: §5.*
3. **Scope the global keydown handler.** Guard modifiers/IME/text targets and bind to the deck
   container, not `window`. An arrow key in browse mode currently fires an irreversible scored
   answer. *Gap: §5.*
4. **[done] Move scoring-adjacent logic into the purity sandbox.** `judging`, `composite`,
   `exportTiers`, `calibration`, `insights`, `playerType`, the demo judge and the
   track metadata now live in `packages/report`, with a `runPure()` test over the whole chain and
   a report-golden digest in `apps/web`. `instrument` and `validateChecks` stay in `apps/web` for
   now: both read the app's asset/base-path seam, so moving them is a separate step. *Gap: §2.1.*
5. **[done] Replace `scoringDigest()`.** The `Function.prototype.toString()` path is gone. The
   build walks each plugin's `score()` import closure on disk, hashes the source bytes and emits
   the digest into the instrument snapshot; the browser reads it and fails closed if it is
   missing. Remaining: dependency versions are pinned by declared range only (see
   `docs/PLAN.md`). *Gap: §2.1, §4.6.*

### P1 — the standard's structure and the E2E gap

6. **Playwright, seven specs** (§6.4), booted against `next build && next start` with
   `AILX_BACKEND=1`, seeded DB, pinned seed and clock. Start with spec 4 (T1 link → live site) —
   it is the one that would have caught the redirect loop. Budget: under 5 minutes.
7. **Split `apps/web/lib`** into `features/` + `components/ui/` + a slim `lib/`, per the §3
   mapping. Pure `git mv` plus import updates; no behaviour change; tests move with their files.
8. **Split `app/exam/page.tsx`** into phase machine, clock leaf, persistence shim, and layout.
   Do this *with* step 7 — it is the same file surface.
9. **Extract `<PersistWarning>`** and delete the five duplicated inline-styled alert blocks
   (dark-theme hex leftovers). *Gap: §5, and `AGENTS.md` DRY.*
10. **React Compiler on**, then delete the seven `exhaustive-deps` suppressions the compiler
    exposes as real Rules-of-React violations. Keep existing memoization per React docs. This
    also fixes the 1 Hz whole-runner re-render that lands mid-gesture on a latency-scored item.
11. **Regenerate `docs/A11Y.md`** against the shipped light palette; delete the removed
    locale-switcher rows; extend the contrast test to `--bg-raised` (`--warn` 4.34 and
    `--distinction` 4.42 fail AA there).

### P2 — cost and hygiene

12. **CSS:** introduce `styles/tokens.css`, wrap `globals.css` in `@layer`, move the landing
    cinema (~45% of 1,325 lines) to a route-scoped sheet so `/exam` stops downloading it, and
    convert repeated exam-path blocks to CSS Modules.
13. **Move `Loader.tsx`'s 14.2 kB inline SVG paths** to `public/media/` — currently in the layout
    chunk *and* in every prerendered HTML file.
14. **Supply chain:** `minimumReleaseAge: 1440`, `--frozen-lockfile`, lifecycle scripts off by
    default in CI.
15. **Vitest browser mode** for the focus/visibility specs (trigger met once step 2 lands);
    Vitest 3.
16. **Next 16** in its own PR — nothing in the codebase blocks it.

Steps 1–3 take hours. Steps 4–5 protect the claim in `docs/POSITIONING.md` that audit-grade
recomputability is a strategic asset. Do not start step 7 before step 4. Otherwise, the files
must move twice.
