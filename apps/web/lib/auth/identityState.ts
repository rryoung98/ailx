"use client";
/**
 * Who the browser thinks it is, as something a component can RE-RENDER on.
 *
 * `lib/data/authHeaders.ts` already knows which credential travels with a request,
 * but it is deliberately a plain module with no subscribers: a fetch asks it
 * once, at call time. A view has the opposite need — it must change when the
 * answer changes, because "signed in" decides whether a practice round is
 * recorded on an account or kept in this browser.
 *
 * SDK-FREE on purpose, exactly like `authHeaders`. `lib/auth/ClerkTokenBridge`
 * is the ONE module that imports Clerk and the one that publishes here, so the
 * static GitHub Pages export — which mounts no provider at all — pulls no auth
 * SDK through this file.
 */
import { useSyncExternalStore } from "react";
import { isServerMode } from "../mode";

/**
 * `pending` is a real state, not a loading spinner's excuse: Clerk resolves a
 * session asynchronously, and a drill that guessed "anonymous" in the meantime
 * would deal a round the signed-in person's account never hears about.
 */
export type IdentityStatus = "pending" | "anonymous" | "asserted" | "signed-in";

export interface Identity {
  status: IdentityStatus;
  /** Stable per-account id, so a claim runs once per account, not per render. */
  userId: string | null;
}

/**
 * TWO FACTS, TWO WORDS (TEN-153).
 *
 * "signed-in" used to cover both of them, and a deployment could not tell
 * them apart: the asserted dev id was called signed-in, so a build with NO
 * accounts at all reported an account. The funnel counted a `signed_in` step
 * on every hosted page load, which docs/KPI.md defines as "an account exists
 * and this browser holds it".
 *
 *  - `"signed-in"` — a real account provider answered and this browser holds
 *    an ACCOUNT. It is the only status that ever carries a `userId`.
 *  - `"asserted"` — the hosted build with no Clerk key. The browser asserts a
 *    dev id the exam service accepts, and there is no account behind it.
 *
 * Nearly every reader wants the OTHER question — "is there an identity the
 * service will accept?" — and that is `hasIdentity`, never a status
 * comparison. Ask for an account only where a claim, a sign-out control or a
 * funnel step really means an account.
 */
export function hasIdentity(status: IdentityStatus): boolean {
  return status === "signed-in" || status === "asserted";
}

/**
 * The three resolved snapshots are module CONSTANTS, and that is load-bearing:
 * `useSyncExternalStore` compares snapshots by reference, so a `readIdentity`
 * that built a fresh object every call would re-render for ever.
 */
const ANONYMOUS: Identity = { status: "anonymous", userId: null };
const PENDING: Identity = { status: "pending", userId: null };
/**
 * Hosted, no Clerk: the asserted dev id IS an identity the API accepts, and
 * it is NOT an account. `asserted` says both halves in one word.
 */
const DEV_IDENTITY: Identity = { status: "asserted", userId: null };

/**
 * By status, and only for the statuses that carry NO id: a signed-in identity
 * is the one state with a value in it, so it is built rather than looked up.
 */
const SNAPSHOTS: Record<Exclude<IdentityStatus, "signed-in">, Identity> = {
  pending: PENDING,
  anonymous: ANONYMOUS,
  asserted: DEV_IDENTITY,
};

let current: Identity = PENDING;
const listeners = new Set<() => void>();

/**
 * HOW LONG `pending` MAY LAST (TEN-214).
 *
 * The bridge is the only thing that leaves `pending`, and it can only publish
 * once Clerk's script has loaded and answered. An extension, a CSP or a dead
 * CDN means it never does, and every reader here treats `pending` as "wait" —
 * so a finished candidate sat on "Checking what the exam service has issued
 * for this sitting…" with no button, for ever.
 *
 * Eight seconds is longer than a cold Clerk load on a slow phone and shorter
 * than a candidate's patience. It is a deadline on the WAIT, not on Clerk: a
 * bridge that answers late still wins, because `publishIdentity` is unchanged.
 */
export const IDENTITY_DEADLINE_MS = 8_000;

let deadline: ReturnType<typeof setTimeout> | null = null;

/**
 * Start the clock the first time something actually WAITS on the identity.
 *
 * Armed from `subscribeIdentity` rather than at module load, because that is
 * the moment a view exists to be stuck: a server render subscribes to
 * nothing, and a module that armed a timer on import would do it during SSR.
 */
function armDeadline(): void {
  if (deadline !== null || current.status !== "pending") return;
  if (typeof window === "undefined" || !isServerMode()) return;
  deadline = setTimeout(() => {
    deadline = null;
    if (current.status !== "pending") return;
    /* What the browser ACTUALLY has when no provider ever registered: with
       no token source, `authHeaders()` sends the asserted dev id, and the
       service accepts it. `asserted` is that in one word — an identity, and
       NOT an account, so nothing offers a sign-out or counts a funnel step
       for it. Server mode implies the hosted build, so there is no
       second case to answer here. */
    publishIdentity(DEV_IDENTITY);
  }, IDENTITY_DEADLINE_MS);
}

/**
 * Called by the Clerk bridge, and by nothing else.
 *
 * An id belongs to a SIGNED-IN identity and to nothing else, and that is
 * normalized here rather than trusted: everything downstream reads "is there
 * an account?" as "is there an id?", so a pending or anonymous state carrying
 * a leftover id would be an account that does not exist.
 */
export function publishIdentity(next: Identity): void {
  const userId = next.status === "signed-in" ? next.userId : null;
  if (next.status === current.status && userId === current.userId) return;
  current = next.status === "signed-in" ? { status: "signed-in", userId } : SNAPSHOTS[next.status];
  /* An answer of any kind ends the wait, so the deadline has nothing left to
     rescue — and a timer left running would keep a test's clock alive. */
  if (current.status !== "pending" && deadline !== null) {
    clearTimeout(deadline);
    deadline = null;
  }
  for (const listener of [...listeners]) listener();
}

/**
 * The identity as every view should read it.
 *
 * Builds with no Clerk are resolved by construction rather than left pending:
 * the static export has no accounts at all, and a hosted build without a
 * publishable key runs on the asserted dev id, which is an identity the API
 * accepts. Only a build that really does mount Clerk can be waiting on it.
 */
export function readIdentity(): Identity {
  if (!isServerMode()) return ANONYMOUS;
  return current;
}

/** Exported for the hook below and for the test that pins the notify rule. */
export function subscribeIdentity(listener: () => void): () => void {
  armDeadline();
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * Server render has no browser identity to read, and must not pretend
 * otherwise: `pending` is what the first client paint replaces, so nothing
 * flashes an anonymous state at somebody who is signed in.
 */
export function useIdentity(): Identity {
  return useSyncExternalStore(subscribeIdentity, readIdentity, () => PENDING);
}

/** Test hook: forget everything a bridge published. */
export function resetIdentity(): void {
  if (deadline !== null) clearTimeout(deadline);
  deadline = null;
  current = PENDING;
  for (const listener of [...listeners]) listener();
}
