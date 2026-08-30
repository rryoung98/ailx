/**
 * One spelling of the reduced-motion media query, for the same reason
 * `lib/mode.ts` is the one spelling of the build-mode env var: four files had
 * their own copy of the string, and a typo in any of them fails silently as
 * "animates anyway" — which is an accessibility defect, not a cosmetic one
 * (docs/UX-DIRECTION.md: "motion must respect prefers-reduced-motion").
 *
 * Browser-only. Callers that need to react to a LIVE change build their own
 * `MediaQueryList` from `REDUCED_MOTION_QUERY`; callers that only need the
 * value once call `prefersReducedMotion()`.
 */

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** True when the user asked for less motion. False on the server and in any
 *  environment without `matchMedia` — never animate MORE than asked. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.(REDUCED_MOTION_QUERY)?.matches === true;
}
