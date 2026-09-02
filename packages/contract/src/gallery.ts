/**
 * The gallery WIRE CONTRACT — the shapes a browser receives from
 * `GET /gallery` and the reviewer queue, plus the pure normalization of the
 * query that produced them.
 *
 * The shapes are ZOD SCHEMAS and the TypeScript types are inferred from them
 * (`z.infer`), so there is ONE definition of each. An interface plus a
 * separate validator is two definitions that drift, and this file used to
 * carry a drift: `GalleryListing.entries` declared `approvedBy`, which
 * `GET /gallery` has never sent (docs/ADR-orpc.md §7). A listing entry is a
 * `PublicGalleryEntry` here, and a response that carries `approvedBy` now
 * fails at the seam instead of being believed.
 *
 * STRICT on the way in. Every object rejects an unknown key, a missing field
 * and a wrong type. A response the browser cannot recognise is an outage, not
 * a shape to coerce.
 *
 * Pure by construction: no database, no environment, no clock. The reads,
 * the SQL predicates and the reviewer allowlist that DECIDE what is listed
 * stay server-side (`@ailx/backend` `gallery.ts`); what lives here is only
 * what both sides must spell the same way.
 */

import { parseSharePayload, type SharePayload } from "@ailx/report";
import { z } from "zod";

/**
 * The share payload, carried whole. Its deep shape already has ONE runtime
 * parser, `parseSharePayload` in `@ailx/report`, which is what the store and
 * the share view read rows with. Re-spelling four nested interfaces as
 * schemas here would be a second definition of the same shape, so this
 * delegates and keeps the inferred type exact.
 */
export const sharePayloadSchema = z.custom<SharePayload>((value) => parseSharePayload(value) !== null, {
  error: "not a share payload",
});

/**
 * One card. `id` is the share row's uuid: an opaque handle with NO capability
 * attached (reads key on the token digest, and the reviewer routes check the
 * caller, not the id), needed so the reviewer queue and the browse grid share
 * one shape. `token` is the capability token of the LISTED share, so the tile
 * links to its view. `at` is the ISO stamp the entry was listed at
 * (approval), or submitted at (queue). `approvedBy` names who listed it:
 * "auto:card" for a derived card, a human ref otherwise.
 */
export const galleryEntrySchema = z.strictObject({
  id: z.string().min(1),
  token: z.string().min(1),
  at: z.string().min(1),
  payload: sharePayloadSchema,
  approvedBy: z.string().nullable(),
});
export type GalleryEntry = z.infer<typeof galleryEntrySchema>;

/**
 * GET /gallery data — public, unauthenticated, no per-person field in it.
 * `approvedBy` names the human who approved the listing, which is a fact for
 * the moderation dashboard and nobody else, so it is dropped here rather than
 * left to a renderer to omit.
 */
export const publicGalleryEntrySchema = galleryEntrySchema.omit({ approvedBy: true });
export type PublicGalleryEntry = z.infer<typeof publicGalleryEntrySchema>;

export function publicEntry(entry: GalleryEntry): PublicGalleryEntry {
  const { approvedBy: _approvedBy, ...rest } = entry;
  return rest;
}

/** Player-type facet, so the filter UI shows real counts and never a dead option. */
export const galleryFacetSchema = z.strictObject({
  code: z.string().min(1),
  name: z.string().min(1),
  count: z.number().int().nonnegative(),
});
export type GalleryFacet = z.infer<typeof galleryFacetSchema>;

export const GALLERY_SORTS = ["recent", "oldest", "type"] as const;
export type GallerySort = (typeof GALLERY_SORTS)[number];

/** Player-type codes are four letters, one per axis (@ailx/report AXES). */
export const PLAYER_TYPE_CODE_RE = /^[MP][ST][VA][DE]$/;

export const GALLERY_PAGE_SIZE = 24;
export const GALLERY_MAX_PAGE_SIZE = 48;

/** The query a listing was produced by, as the response echoes it back. */
export const galleryQuerySchema = z.strictObject({
  /** Player-type code filter, e.g. "MSVD". */
  type: z.string().regex(PLAYER_TYPE_CODE_RE).nullable(),
  sort: z.enum(GALLERY_SORTS),
  /** Only entries that carry a built site. */
  withSite: z.boolean(),
  limit: z.number().int().min(1).max(GALLERY_MAX_PAGE_SIZE),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
export type GalleryQuery = z.infer<typeof galleryQuerySchema>;

export const galleryListingSchema = z.strictObject({
  entries: z.array(publicGalleryEntrySchema),
  total: z.number().int().nonnegative(),
  facets: z.array(galleryFacetSchema),
  query: galleryQuerySchema,
});
export type GalleryListing = z.infer<typeof galleryListingSchema>;

/**
 * The RAW query string of `GET /gallery`, as strings, turned into a
 * `GalleryQuery` — or REJECTED.
 *
 * It used to normalize: `?limit=1000000000` came back as 48 with HTTP 200,
 * `?sort=sideways` as "recent", and `?limit=1e9` as **1**, because
 * `Number.parseInt` stops at the "e". A caller asking for something the
 * service will not do is now told so, instead of being served a different
 * answer under the same status code. `?limit=1e9` is a number, so it is read
 * as 1000000000 and refused for being over the cap.
 *
 * UNKNOWN KEYS ARE IGNORED, deliberately, and this is the one place strictness
 * is wrong: a gallery link shared with `?utm_source=` on the end must still
 * open the gallery. Only the keys this route acts on are checked.
 */
export const gallerySearchSchema = z
  .object({
    type: z.string().regex(PLAYER_TYPE_CODE_RE).nullish(),
    sort: z.enum(GALLERY_SORTS).nullish(),
    site: z.literal("1").nullish(),
    limit: z.coerce.number().int().min(1).max(GALLERY_MAX_PAGE_SIZE).nullish(),
    offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullish(),
  })
  .transform((raw): GalleryQuery => ({
    type: raw.type ?? null,
    sort: raw.sort ?? "recent",
    withSite: raw.site === "1",
    limit: raw.limit ?? GALLERY_PAGE_SIZE,
    offset: raw.offset ?? 0,
  }));

/** A query that was refused, and the reason, in one value a caller must open. */
export type QueryParseResult<T> =
  | { readonly ok: true; readonly query: T }
  | { readonly ok: false; readonly message: string };

/**
 * Normalize untrusted query input ONCE — the page and any JSON caller share
 * this, so a hostile `limit=1e9`, a negative offset or an injected sort key
 * cannot exist past this function. It returns a RESULT rather than throwing,
 * so a caller cannot forget that "refused" is an answer: the service turns
 * `ok: false` into a 400.
 */
export function parseGalleryQuery(
  raw: Record<string, string | undefined> = {},
): QueryParseResult<GalleryQuery> {
  const parsed = gallerySearchSchema.safeParse(raw);
  return parsed.success
    ? { ok: true, query: parsed.data }
    : { ok: false, message: z.prettifyError(parsed.error) };
}

/** Longest refusal reason stored. Long enough to be useful, not a document. */
export const REJECT_REASON_MAX = 500;

export const REVIEW_DECISIONS = ["approve", "reject"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
