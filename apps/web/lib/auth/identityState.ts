"use client";
/**
 * Who the browser thinks it is, as something a component can RE-RENDER on.
 *
 * `lib/authHeaders.ts` already knows which credential travels with a request,
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
import { isClerkEnabled, isServerMode } from "../mode";

/**
 * `pending` is a real state, not a loading spinner's excuse: Clerk resolves a
 * session asynchronously, and a drill that guessed "anonymous" in the meantime
 * would deal a round the signed-in person's account never hears about.
 */
export type IdentityStatus = "pending" | "anonymous" | "signed-in";

export interface Identity {
  status: IdentityStatus;
  /** Stable per-account id, so a claim runs once per account, not per render. */
  userId: string | null;
}

/**
 * The three resolved snapshots are module CONSTANTS, and that is load-bearing:
 * `useSyncExternalStore` compares snapshots by reference, so a `readIdentity`
 * that built a fresh object every call would re-render for ever.
 */
const ANONYMOUS: Identity = { status: "anonymous", userId: null };
const PENDING: Identity = { status: "pending", userId: null };
/** Hosted, no Clerk: the asserted dev id IS an identity the API accepts. */
const DEV_IDENTITY: Identity = { status: "signed-in", userId: null };

let current: Identity = PENDING;
const listeners = new Set<() => void>();

/** Called by the Clerk bridge, and by nothing else. */
export function publishIdentity(next: Identity): void {
  if (next.status === current.status && next.userId === current.userId) return;
  current = next;
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
  if (!isClerkEnabled()) return isServerMode() ? DEV_IDENTITY : ANONYMOUS;
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * Server render has no browser identity to read, and must not pretend
 * otherwise: `pending` is what the first client paint replaces, so nothing
 * flashes an anonymous state at somebody who is signed in.
 */
export function useIdentity(): Identity {
  return useSyncExternalStore(subscribe, readIdentity, () => PENDING);
}

/** Test hook: forget everything a bridge published. */
export function resetIdentity(): void {
  current = PENDING;
  for (const listener of [...listeners]) listener();
}
