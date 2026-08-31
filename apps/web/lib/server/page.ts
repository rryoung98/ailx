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
import { apiBase } from "../mode";
import { resolvePublicOrigin } from "./origin";

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
