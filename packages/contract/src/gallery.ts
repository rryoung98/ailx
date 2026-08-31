/**
 * The gallery WIRE CONTRACT — the shapes a browser receives from
 * `GET /gallery` and the reviewer queue, plus the pure normalization of the
 * query that produced them.
 *
 * Pure by construction: no database, no environment, no clock. The reads,
 * the SQL predicates and the reviewer allowlist that DECIDE what is listed
 * stay server-side (`@ailx/backend` `gallery.ts`); what lives here is only
 * what both sides must spell the same way.
 */

import type { SharePayload } from "@ailx/report";
import { clampInt } from "./clamp.js";

/**
 * One card. `id` is the share row's uuid: an opaque handle with NO capability
 * attached (reads key on the token digest, and the reviewer routes check the
 * caller, not the id), needed so the reviewer queue and the browse grid share
 * one shape.
 */
export interface GalleryEntry {
  id: string;
  /** Capability token of the LISTED share, so the tile links to its view. */
  token: string;
  /** ISO stamp the entry was listed at (approval), or submitted at (queue). */
  at: string;
  /**
   * The share's own FROZEN payload, carried whole rather than re-copied field
   * by field. A gallery tile and a share view must show the same thing, and a
   * new opt-in section must not need a second allowlist here to appear.
   */
  payload: SharePayload;
  /** Who listed it: "auto:card" for a derived card, a human ref otherwise. */
  approvedBy: string | null;
}

/** Player-type facet, so the filter UI shows real counts and never a dead option. */
export interface GalleryFacet {
  code: string;
  name: string;
  count: number;
}

export interface GalleryQuery {
  /** Player-type code filter, e.g. "MSVD". */
  type: string | null;
  sort: GallerySort;
  /** Only entries that carry a built site. */
  withSite: boolean;
  limit: number;
  offset: number;
}

export const GALLERY_SORTS = ["recent", "oldest", "type"] as const;
export type GallerySort = (typeof GALLERY_SORTS)[number];

export interface GalleryListing {
  entries: GalleryEntry[];
  total: number;
  facets: GalleryFacet[];
  query: GalleryQuery;
}

/** Player-type codes are four letters, one per axis (@ailx/report AXES). */
export const PLAYER_TYPE_CODE_RE = /^[MP][ST][VA][DE]$/;

export const GALLERY_PAGE_SIZE = 24;
export const GALLERY_MAX_PAGE_SIZE = 48;

/**
 * Normalize untrusted query input ONCE — the page and any JSON caller share
 * this, so a hostile `limit=1e9`, a negative offset or an injected sort key
 * cannot exist past this function.
 */
export function parseGalleryQuery(raw: Record<string, string | undefined> = {}): GalleryQuery {
  const type = raw.type !== undefined && PLAYER_TYPE_CODE_RE.test(raw.type) ? raw.type : null;
  const sort = (GALLERY_SORTS as readonly string[]).includes(raw.sort ?? "")
    ? (raw.sort as GallerySort)
    : "recent";
  return {
    type,
    sort,
    withSite: raw.site === "1",
    limit: clampInt(raw.limit, 1, GALLERY_MAX_PAGE_SIZE, GALLERY_PAGE_SIZE),
    offset: clampInt(raw.offset, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

/** Longest refusal reason stored. Long enough to be useful, not a document. */
export const REJECT_REASON_MAX = 500;

/**
 * GET /gallery data — public, unauthenticated, no per-person field in it.
 * `approvedBy` names the human who approved the listing, which is a fact for
 * the moderation dashboard and nobody else, so it is dropped here rather than
 * left to a renderer to omit.
 */
export type PublicGalleryEntry = Omit<GalleryEntry, "approvedBy">;

export function publicEntry(entry: GalleryEntry): PublicGalleryEntry {
  const { approvedBy: _approvedBy, ...rest } = entry;
  return rest;
}

export const REVIEW_DECISIONS = ["approve", "reject"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
