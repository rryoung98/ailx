/**
 * SPIKE (TEN-37) — one endpoint expressed as an oRPC contract, so the
 * evaluation in `docs/ADR-orpc.md` rests on code that runs.
 *
 * NOT PRODUCTION. Nothing in `apps/web` imports this package, and no real
 * call site was changed. Delete the whole package when the ADR is read.
 *
 * The endpoint is `GET /gallery`: a public, unauthenticated read with a
 * normalized query and a frozen URL spelling. It was chosen because
 * `@ailx/contract` already spells all of it by hand (`parseGalleryQuery`,
 * `GalleryQuery`, `GalleryListing`, `PublicGalleryEntry`), so the two
 * designs can be compared over the same wire surface instead of a toy.
 */
import type { PublicGalleryEntry, GalleryFacet, GalleryQuery } from "@ailx/contract";
import { GALLERY_MAX_PAGE_SIZE, GALLERY_PAGE_SIZE, GALLERY_SORTS, PLAYER_TYPE_CODE_RE } from "@ailx/contract";
import { oc, type } from "@orpc/contract";
import * as z from "zod";

/**
 * The response body as the SERVICE really sends it:
 * `{ gallery: { entries, total, facets, query } }` with `publicEntry()`
 * applied (private repo, `packages/backend/src/gallery.ts:225`).
 *
 * Note what this fixes for free. The browser today declares this read as
 * `useService<{ gallery: GalleryListing }>` (`apps/web/lib/GalleryView.tsx`),
 * and `GalleryListing.entries` is `GalleryEntry[]`, which carries
 * `approvedBy`. The public endpoint drops that field. Nothing reads it, so
 * the overstatement is harmless today — but it is exactly the drift class
 * TEN-37 is about, and it exists because the request type and the response
 * type are declared in two places by two people.
 */
export interface PublicGalleryListing {
  entries: PublicGalleryEntry[];
  total: number;
  facets: GalleryFacet[];
  query: GalleryQuery;
}

/**
 * The query, as a schema rather than as `parseGalleryQuery`.
 *
 * This is the honest cost of the schema half: the caps, the default sort and
 * the player-type regex are re-stated in zod, and the CONSTANTS are imported
 * from `@ailx/contract` so the two spellings cannot drift apart in value.
 * The normalization RULES still exist twice — once as a parser, once as a
 * schema — which is why the ADR does not recommend deleting the parser.
 */
export const GalleryQuerySchema = z.object({
  type: z.string().regex(PLAYER_TYPE_CODE_RE).nullish(),
  sort: z.enum(GALLERY_SORTS).default("recent"),
  site: z.literal("1").optional(),
  limit: z.coerce.number().int().min(1).max(GALLERY_MAX_PAGE_SIZE).default(GALLERY_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * `GET /gallery`, with the URL spelled ONCE and read by both sides.
 *
 * `type<PublicGalleryListing>()` reuses the hand-written wire type instead of
 * re-spelling `SharePayload` in zod. That is deliberate: `SharePayload` is a
 * deep `@ailx/report` type carried whole, and re-declaring it as a schema is
 * the single largest migration cost oRPC would impose. The price of the
 * shortcut is that the server validates no response — see the ADR.
 */
export const listGalleryContract = oc
  .route({ method: "GET", path: "/gallery" })
  .input(GalleryQuerySchema)
  .output(type<{ gallery: PublicGalleryListing }>());

export const galleryContract = { listGallery: listGalleryContract };
