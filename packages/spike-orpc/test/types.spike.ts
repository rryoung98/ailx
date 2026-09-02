/**
 * SPIKE (TEN-37) — the claims that only a COMPILER can check.
 *
 * `vitest run` cannot see any of this: the runtime tests in
 * `gallery.spike.test.ts` pass whether or not the types are right. So these
 * assertions are checked by `tsc -p tsconfig.test.json --noEmit`, which the
 * package's `build` script runs, which `pnpm -r build` runs. If oRPC's types
 * stop meaning what the ADR says they mean, the monorepo build goes red.
 *
 * There is no runtime code here on purpose.
 */
import type { ContractRouterClient } from "@orpc/contract";
import type { JsonifiedClient } from "@orpc/openapi-client";
import type { SharePayload } from "@ailx/report";
import type { galleryContract, PublicGalleryListing } from "../src/contract.js";
import type { SpikeGalleryClient } from "../src/client.js";

/** Exact type equality, not assignability — `unknown` accepts everything. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type Assert<T extends true> = T;

type Result = Awaited<ReturnType<SpikeGalleryClient["listGallery"]>>;

/** CLAIM 1: the client's result type IS the contract's output type, exactly. */
type _Result = Assert<Equals<Result, { gallery: PublicGalleryListing }>>;

/** CLAIM 2: the nested share payload survives. This is what fails below. */
type _PayloadKept = Assert<
  Equals<Result["gallery"]["entries"][number]["payload"], SharePayload>
>;

/**
 * CLAIM 3, and the reason `SpikeGalleryClient` does not use the wrapper the
 * oRPC docs prescribe. `JsonifiedClient` is meant to model "what survives
 * JSON". Over our wire types it silently returns `unknown` for any nested
 * `interface`, because an interface has no implicit index signature and the
 * `Jsonify` mapped type falls through. `poles`, `profile` and `process` are
 * real fields of a real share card, and every one of them is lost.
 *
 * Pinned rather than described: if a later oRPC release fixes this, this file
 * goes red and the ADR's recommendation should be revisited.
 */
type JsonifiedResult = Awaited<
  ReturnType<JsonifiedClient<ContractRouterClient<typeof galleryContract>>["listGallery"]>
>;

/**
 * The whole listing, not some deep corner of it, comes back as `unknown`.
 * `PublicGalleryListing` is an `interface`, and that alone is enough.
 */
type _JsonifiedLosesTheListing = Assert<
  Equals<JsonifiedResult, { gallery: unknown }>
>;
