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
 * wire types: `SharePayload.poles` degrades to `unknown[]` and
 * `SharePayload.profile` / `.process` degrade to `unknown`, silently. The
 * cause is that they are `interface`s, which have no implicit index
 * signature, so the `Jsonify` mapped type gives up and returns `unknown`.
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
  /** Absolute or relative root the paths hang off — `apiBase()` in the app. */
  readonly url: string;
  readonly headers?: () => Record<string, string>;
  /** Injected so a test can answer without a network. */
  readonly fetch?: (request: Request, init: RequestInit) => Promise<Response>;
}

export function spikeGalleryClient(opts: SpikeClientOptions): SpikeGalleryClient {
  const link = new OpenAPILink(galleryContract, {
    url: opts.url,
    headers: opts.headers,
    fetch: opts.fetch,
  });
  return createORPCClient(link);
}
