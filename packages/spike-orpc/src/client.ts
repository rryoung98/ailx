/**
 * SPIKE (TEN-37) — the client half: the same read, typed from the contract.
 *
 * Compare with `apps/web/lib/serviceFetch.ts`, which is what this would
 * replace: one `fetch`, one `apiBase()`, one `ServiceState`. This factory
 * takes `apiBase()`'s value as an argument rather than reading the env, so
 * the "NEXT_PUBLIC_AILX_API_BASE is read in exactly one module" rule
 * (`apps/web/test/apiBase.test.ts`) still holds if this ever ships.
 */
import type { ContractRouterClient } from "@orpc/contract";
import { createORPCClient } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { galleryContract } from "./contract.js";

/**
 * MEASURED, TEN-37. The documented wrapper is
 * `JsonifiedClient<ContractRouterClient<...>>`, and it does not work over our
 * wire types: the whole listing comes back as `unknown`. The cause is that
 * `PublicGalleryListing` is an `interface`, which has no implicit index
 * signature, so the `Jsonify` mapped type falls through.
 * `packages/spike-orpc/test/types.spike.ts` pins that result.
 *
 * So this spike uses the UNWRAPPED `ContractRouterClient`, which keeps the
 * types exact. That is only honest because our payloads are already plain
 * JSON — no `Date`, no `BigInt`, no `File`. The documented alternative is a
 * real zod output schema plus `ResponseValidationPlugin`, which means
 * re-spelling `SharePayload` as a schema and shipping it in the browser.
 */
export type SpikeGalleryClient = ContractRouterClient<typeof galleryContract>;

export interface SpikeClientOptions {
  /** The value of `apiBase()`: absolute (`https://host/v1`) or relative (`/api`). */
  readonly url: string;
  /**
   * Async on purpose. `apps/web/lib/authHeaders.ts` returns a promise,
   * because Clerk may have to refresh a token before the call goes out.
   */
  readonly headers?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Injected so a test can answer without a network. */
  readonly fetch?: (request: Request, init: RequestInit) => Promise<Response>;
  /** Origin a relative `url` is resolved against. Defaults to the browser's. */
  readonly origin?: string;
}

/**
 * MEASURED, TEN-37, and the sharpest integration snag found.
 *
 * `apiBase()` returns a RELATIVE path in two of the three builds this repo
 * ships: `/ailx/api` for the GitHub Pages export and `/api` for a hosted
 * build with no `NEXT_PUBLIC_AILX_API_BASE`. `OpenAPILink` calls `new URL()`
 * on its `url`, which throws `TypeError: Invalid URL` on either of them. So
 * adopting oRPC means every relative base becomes absolute at the seam.
 *
 * Doing it here rather than at the call site keeps the rule that only
 * `lib/mode.ts` knows what `apiBase()` means.
 */
function absoluteUrl(url: string, origin?: string): string {
  if (/^https?:\/\//.test(url)) return url;
  const root = origin ?? (typeof window === "undefined" ? undefined : window.location.origin);
  if (root === undefined) {
    throw new TypeError(`oRPC needs an absolute URL and there is no origin to resolve "${url}" against`);
  }
  return new URL(url, root).toString();
}

export function spikeGalleryClient(opts: SpikeClientOptions): SpikeGalleryClient {
  const link = new OpenAPILink(galleryContract, {
    url: absoluteUrl(opts.url, opts.origin),
    headers: opts.headers,
    fetch: opts.fetch,
  });
  return createORPCClient(link);
}
