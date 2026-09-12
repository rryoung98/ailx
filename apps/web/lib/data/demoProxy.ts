/**
 * THE SHARED DEMO PROXY'S ORIGIN, SPELLED ONCE.
 *
 * `services/openrouter-proxy` hosts a small public wall of T4 final sets. It
 * is NOT the exam service: it holds no exam content, answers no exam route,
 * and it is the only backend the static GitHub Pages export has (see
 * `services/openrouter-proxy/AGENTS.md`). So it does not belong in the route
 * manifest — `apiPath()` names routes the EXAM service answers — and
 * `apiBase()` must not be asked for it either.
 *
 * What it does need is one spelling. The host was typed out in THREE files —
 * `app/report/page.tsx` (the share button), `app/wall/page.tsx` (the wall
 * that reads it) and `features/exam/ConnectPanel.tsx` (the capped model
 * proxy on the same deployment) — so moving the demo proxy would have left
 * some of them pointing into the void (TEN-235).
 */

/** The demo proxy's origin. Nothing else in this app may spell it. */
export const SHARED_DEMO_ORIGIN = "https://ailx-shared-demo.vercel.app";

/** The wall itself: `GET` lists sets, `POST` shares one, `POST /vote` votes. */
export const DEMO_GALLERY_API = `${SHARED_DEMO_ORIGIN}/api/gallery`;

/**
 * The capped MODEL proxy on the same deployment, which is why the origin is
 * here rather than beside the wall: `ConnectPanel` had a third spelling of
 * the same host, so moving the demo proxy meant editing three files and
 * remembering all three.
 */
export const SHARED_DEMO_MODEL_BASE = `${SHARED_DEMO_ORIGIN}/api/v1`;
