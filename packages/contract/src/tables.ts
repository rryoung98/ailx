/**
 * The two TABLES that hang off the route manifest: the query parser each route
 * normalizes its query string with, and the schema its success body is
 * validated against.
 *
 * WHY THEY ARE NOT IN `routes.ts`. Both reach zod, and `apiPath()` is imported
 * by every page in the app. While the tables lived beside it, webpack could
 * not separate them, so the STATIC Pages export — which has no gallery page
 * and no exam service — shipped zod on all nine of its pages. Measured: 14.5 kB
 * gzip of chunk, on every page, buying that build nothing
 * (docs/ADR-zod-tanstack.md §3). Splitting the file is the whole fix.
 */
import { z } from "zod";
import { parseCaseQuery } from "./moderation.js";
import { galleryListingSchema, parseGalleryQuery } from "./gallery.js";
import type { ApiQueryParserName, ApiRouteKey } from "./routes.js";

/**
 * The pure query normalizer each `queryParser` name refers to. One object, so a new
 * parser cannot be added to the package without a route being able to name it.
 */
export const API_QUERY_PARSERS = {
  gallery: parseGalleryQuery,
  case: parseCaseQuery,
} as const satisfies Record<ApiQueryParserName, (raw: Record<string, string | undefined>) => unknown>;

/**
 * The SCHEMA a route's success body is validated against at the seam, keyed by
 * the same route key. One route, one schema, and the schema is the definition
 * of the type the `response` line above names — `GalleryListing` IS
 * `z.infer<typeof galleryListingSchema>`, not a second spelling of it
 * (`./gallery.js`).
 *
 * PARTIAL on purpose. A route with no entry here is read exactly as it was
 * before: a typed `fetch` whose body nobody checked. Filling the table in is
 * per-route work, and claiming a validated wire while 37 of 38 routes are
 * unchecked would be the drift this package exists to stop. `apps/web` fails
 * closed the other way — `useService` only claims a validated body when it was
 * given a schema.
 */
/**
 * A schema for one wire body, as a consumer types it. `apps/web` reads this
 * rather than importing `zod` itself: the seam takes "a schema for a T", and
 * only this package decides what a schema is.
 */
export type ResponseSchema<T> = z.ZodType<T>;

export const API_RESPONSE_SCHEMAS = {
  gallery: z.strictObject({ gallery: galleryListingSchema }),
} as const satisfies Partial<Record<ApiRouteKey, z.ZodType>>;

