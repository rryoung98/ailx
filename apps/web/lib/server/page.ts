/**
 * What a server COMPONENT still needs after the pages became client
 * components: this deployment's public origin, and an ABSOLUTE root for the
 * exam service.
 *
 * Only `generateMetadata` uses either. A social scraper never runs the
 * client, so the Open Graph card for `/s/<token>` has to be built on the
 * server, from a real read — and a server fetch cannot use the relative
 * `/api` that `apiBase()` returns when the seam is unset.
 *
 * Deliberately NOT a copy of the origin rule: `resolvePublicOrigin` in
 * `lib/server/origin.ts` is the one definition, including the reason the Host
 * header is not trusted unless `AILX_TRUST_PROXY=1` says a proxy overwrites
 * it. This module only calls it.
 */
import type { ApiPath } from "@ailx/contract";
import { apiBase } from "../mode";
import { resolvePublicOrigin } from "./origin";

/**
 * How long a SERVER read of the exam service may take before it is given up
 * on. Default 4 s, well inside the 10 s Hobby / 15 s Pro function limit
 * (docs/DEPLOY.md §5), and short enough to leave room for the render that
 * follows — rasterizing the share card is the expensive half.
 *
 * A deadline is the whole point: without one, these reads have no failure
 * mode for a service that ACCEPTS the connection and never answers. Their
 * catch blocks only ever ran on a rejection, so a hang was not a "link not
 * found" sentence but the platform's own 504 (TEN-213).
 */
export const SERVER_READ_TIMEOUT_MS = 4_000;

/** The budget in force, overridable per deployment. Never zero, never negative. */
export function serverReadTimeoutMs(): number {
  const raw = Number(process.env.AILX_SERVER_READ_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : SERVER_READ_TIMEOUT_MS;
}

/**
 * One BOUNDED server read of the exam service. Three call sites (the share
 * metadata, the verify metadata and the card route), so the deadline cannot
 * be on two of them and missing from the third.
 *
 * Returns the response, or null when nothing was reached inside the budget —
 * which every caller already renders as the sentence it wrote for an
 * unreachable service.
 */
export async function serverRead(path: ApiPath): Promise<Response | null> {
  try {
    return await fetch(`${await serverApiBase()}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(serverReadTimeoutMs()),
    });
  } catch {
    return null;
  }
}

/** The origin browsers actually reach us on, for a server COMPONENT. */
export async function pageOrigin(): Promise<string> {
  const { headers } = await import("next/headers");
  const h = await headers();
  const host = h.get("host") ?? "localhost";
  return resolvePublicOrigin(process.env, new URL(`https://${host}`), h as unknown as Headers);
}

/**
 * `apiBase()`, made absolute so `fetch` can use it from the server.
 *
 * Cross-origin the seam already returns an absolute `<service>/v1` and this
 * is a no-op. Same-origin it returns `<basePath>/api`, which only a browser
 * can resolve, so this deployment's own public origin is prefixed.
 */
export async function serverApiBase(): Promise<string> {
  const base = apiBase();
  return /^https?:\/\//.test(base) ? base : `${await pageOrigin()}${base}`;
}
