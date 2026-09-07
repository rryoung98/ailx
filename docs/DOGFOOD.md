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

## Server mode behind a proxy
Set `AILX_PUBLIC_ORIGIN` (or `AILX_TRUST_PROXY=1`) whenever the app is reached through a
tunnel, load balancer or CDN. Without it the served-site CSP allowlist and the bare-digest
308 redirect carry the internal origin, so a candidate's hosted site loads with every
subresource blocked — a `curl` of one asset still returns 200, so only a real browser
(or the tests in `apps/web/test/publicOrigin.test.ts`) catches it.

## Automated dogfooding after the Clerk production switch

Bot protection is OFF on the Clerk development instance, which is the only
reason an agent-driven run can sign up today. It is ON in production. The
moment staging runs the production instance an automated sign-up gets "Bot
traffic detected" and every run goes red at the door.

What that needs, in order (`docs/CUTOVER-foray.md` §5):

1. One test identity created by hand in the production instance, with an EMAIL
   AND A PASSWORD. Clerk's testing helpers do not support code-based
   authentication in production, so a code-based login will not work. Automation
   signs IN and never signs up.
2. `@clerk/testing` — not a dependency today — for its Playwright integration,
   which attaches a Testing Token automatically. Testing Tokens bypass bot
   detection in both development and production.
3. A stored signed-in session for agent-browser runs, so a run costs no
   challenge.
4. An answer to how that identity is excluded from aggregates, the gallery and
   item statistics. It is a participant as far as the store is concerned, and
   `docs/SAMPLING.md` is the reason that matters.

`+clerk_test` addresses with the fixed code `424242` are test mode. That is on
by default in development only, and Clerk calls enabling it in production
"highly discouraged". It is the first thing anyone reaches for and it is the
wrong one.

## CI gates
- `pnpm -r build && pnpm test` (all packages, golden fixtures, purity harness).
- Static export build of `@ailx/web`.
- Pages deploy must succeed for `main` to be considered healthy.
