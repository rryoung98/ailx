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

import { AXES, parseSharePayload, type SharePayload } from "@ailx/report";
import { z } from "zod";

/**
 * The share payload, carried whole. Its deep shape already has ONE runtime
 * parser, `parseSharePayload` in `@ailx/report`, which is what the store and
 * the share view read rows with. Re-spelling four nested interfaces as
 * schemas here would be a second definition of the same shape, so this
 * delegates and keeps the inferred type exact.
 */
export const sharePayloadSchema = z.unknown().transform((value, ctx): SharePayload => {
  const parsed = parseSharePayload(value);
  if (parsed === null) {
    ctx.addIssue({ code: "custom", message: "not a share payload" });
    return z.NEVER;
  }
  // The PARSED value, not the one that arrived. `parseSharePayload` drops keys
  // it does not know and reads a malformed section as null, so returning the
  // original would hand the UI an object typed `SharePayload` that the parser
  // had already decided to clean.
  return parsed;
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
  /**
   * The artefact was REMOVED from `payload.site` before serialization, for a
   * caller who has not sat the material (docs/ADR-profile-and-type.md §16).
   * Present so a renderer can say the section is withheld rather than say the
   * owner published nothing. Absent means nothing was removed.
   */
  siteLocked: z.literal(true).optional(),
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

/**
 * THE AXIS FILTER (docs/ADR-profile-and-type.md §4, §9).
 *
 * The unit of the filter is an AXIS, not a four-letter code. Two thirds of the
 * demo cohort has at least one letter within a quarter of a standard deviation
 * of its own cutline, so a code is a hard bucket over soft evidence; an axis
 * keeps the strength that says how firmly the letter was decided, and an axis
 * that was decided at 51 matches BOTH sides of its filter rather than
 * pretending to be one of them.
 *
 * Derived from `AXES` in `@ailx/report`, never re-typed. The letters ARE the
 * poles, and a second list of them here is a second answer to "what does S
 * mean".
 */
export const AXIS_TRACKS = AXES.map((a) => a.track);
export type AxisTrack = (typeof AXES)[number]["track"];

/** `[high, low]` per track: t1 M/P, t2 S/T, t3 V/A, t4 D/E. */
export const AXIS_LETTERS = Object.fromEntries(
  AXES.map((a) => [a.track, [a.hi.letter, a.lo.letter] as const]),
) as Readonly<Record<AxisTrack, readonly [string, string]>>;

/** `null` = this track is not being filtered on. */
export type AxisFilter = Readonly<Record<AxisTrack, string | null>>;

export const axisFilterSchema = z.strictObject(
  Object.fromEntries(
    AXIS_TRACKS.map((track) => [
      track,
      z.enum(AXIS_LETTERS[track] as unknown as [string, string]).nullable(),
    ]),
  ) as Record<AxisTrack, z.ZodNullable<z.ZodEnum<Record<string, string>>>>,
);

/** Every track unfiltered. A FUNCTION: a shared constant is one caller's edit away from moving everybody's default. */
export function emptyAxisFilter(): AxisFilter {
  return Object.fromEntries(AXIS_TRACKS.map((t) => [t, null])) as AxisFilter;
}

export const isEmptyAxisFilter = (filter: AxisFilter): boolean =>
  AXIS_TRACKS.every((t) => filter[t] === null);

/** `t1:M,t2:S` — ascending track order, at most one entry per track, ANDed. */
export function axisFilterString(filter: AxisFilter): string {
  return AXIS_TRACKS.filter((t) => filter[t] !== null)
    .map((t) => `${t}:${filter[t]}`)
    .join(",");
}

const AXIS_ENTRY_RE = /^([a-z0-9]+):([A-Z])$/;

/**
 * Parse `?axis=`. REJECT, NEVER NORMALISE — TEN-107's rule, written after
 * `?limit=1e9` came back as 1 under a 200.
 *
 * A re-sorted or duplicated query is a 400 rather than a re-sort, because two
 * spellings of one filter is how a browser grows a private vocabulary and how
 * a shared link stops being canonical.
 */
export function parseAxisFilter(raw: string): QueryParseResult<AxisFilter> {
  const refuse = (message: string): QueryParseResult<AxisFilter> => ({ ok: false, message });
  if (raw === "") return refuse("axis: empty. Omit the parameter instead of sending an empty one");
  if (/\s/.test(raw)) return refuse("axis: no whitespace is allowed in the filter");
  const parts = raw.split(",");
  if (parts.length > AXIS_TRACKS.length) {
    return refuse(`axis: at most ${AXIS_TRACKS.length} entries, one per track`);
  }
  const filter: Record<string, string | null> = emptyAxisFilter();
  let previous = -1;
  for (const part of parts) {
    const m = AXIS_ENTRY_RE.exec(part);
    if (m === null) return refuse(`axis: "${part}" is not <track>:<LETTER>`);
    const [, track, letter] = m;
    const index = (AXIS_TRACKS as readonly string[]).indexOf(track);
    if (index < 0) return refuse(`axis: "${track}" is not a track`);
    const letters = AXIS_LETTERS[track as AxisTrack];
    if (!letters.includes(letter)) {
      return refuse(`axis: "${letter}" is not a ${track} letter (${letters.join(" or ")})`);
    }
    if (filter[track] !== null) return refuse(`axis: ${track} appears twice; a track may be filtered once`);
    if (index < previous) return refuse("axis: tracks must be in ascending order, e.g. t1:M,t2:S");
    previous = index;
    filter[track] = letter;
  }
  return { ok: true, query: filter as AxisFilter };
}

/**
 * Per-axis facet, so an axis chip is never a dead option. `undecided` is the
 * part of `count` that matched only because the axis was a coin flip — a
 * number the wall shows rather than hides, because it is the honest half of
 * the both-sides rule.
 */
export const galleryAxisFacetSchema = z.strictObject({
  track: z.enum(AXIS_TRACKS as unknown as [AxisTrack, ...AxisTrack[]]),
  letter: z.string().length(1),
  label: z.string().min(1),
  count: z.number().int().nonnegative(),
  undecided: z.number().int().nonnegative(),
});
export type GalleryAxisFacet = z.infer<typeof galleryAxisFacetSchema>;

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
  /** Player-type code filter, e.g. "MSVD". Never set together with `axis`. */
  type: z.string().regex(PLAYER_TYPE_CODE_RE).nullable(),
  /** Per-axis filter; every track null when absent. */
  axis: axisFilterSchema,
  /** `decided=1`: an undecided axis stops matching both sides. */
  decided: z.boolean(),
  sort: z.enum(GALLERY_SORTS),
  /** Only entries that carry a built site. */
  withSite: z.boolean(),
  limit: z.number().int().min(1).max(GALLERY_MAX_PAGE_SIZE),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
export type GalleryQuery = z.infer<typeof galleryQuerySchema>;

/**
 * THE PARTICIPATION GATE, as the browser sees it (ADR §16).
 *
 * `tier` is what the service decided: 0 signed out, 1 signed in with no
 * qualifying round, 2 a server-stamped practice round, 3 an attempt of their
 * own. `total` is the count of published cards — an aggregate, and the ONLY
 * number a locked caller is given.
 */
export const GALLERY_ACCESS_STATES = ["signed-out", "no-round", "open"] as const;
export type GalleryAccessState = (typeof GALLERY_ACCESS_STATES)[number];

export const galleryAccessSchema = z.strictObject({
  state: z.enum(GALLERY_ACCESS_STATES),
  tier: z.number().int().min(0).max(3),
  total: z.number().int().nonnegative(),
  /**
   * The page size the SERVER imposed, or null when it imposed none.
   *
   * State 1 — signed in, no qualifying round — gets one page and no paging
   * past it. That cap is a property of the CALLER, not of the query, so it is
   * reported here rather than refused as a 400: the query is legal, and the
   * answer says which state produced it. It is `GALLERY_PAGE_SIZE`, so it
   * invents no number.
   */
  pageCap: z.number().int().positive().nullable(),
});
export type GalleryAccess = z.infer<typeof galleryAccessSchema>;

/**
 * ONE PUBLISHED CARD, REDUCED TO THE SAFE LIST (§16.5.1).
 *
 * A hand-listed strict object, deliberately NOT `sharePayloadSchema.pick()`
 * and never the payload itself: `galleryEntrySchema` carries the whole frozen
 * payload on purpose, and that is exactly the property a preview must not
 * inherit. A new opt-in section must reach the wall automatically and must not
 * reach this automatically.
 *
 * No token, no `/s/` link, no `site`, no `note`, no `displayName`, nothing
 * item-derived.
 */
export const previewPoleSchema = z.strictObject({
  track: z.enum(AXIS_TRACKS as unknown as [AxisTrack, ...AxisTrack[]]),
  letter: z.string().length(1),
  label: z.string().min(1),
  /** Absent on a v1/v2 card: it predates the number and renders no meter. */
  strength: z.number().min(0).max(100).optional(),
});

export const previewCardSchema = z.strictObject({
  code: z.string().regex(PLAYER_TYPE_CODE_RE),
  name: z.string().min(1),
  tagline: z.string().min(1),
  poles: z.array(previewPoleSchema).max(AXIS_TRACKS.length),
  tracks: z.record(z.enum(AXIS_TRACKS as unknown as [AxisTrack, ...AxisTrack[]]), z.number().min(0).max(100)),
  band: z.string().min(1),
  completedOn: z.string().nullable(),
});
export type PreviewCardWire = z.infer<typeof previewCardSchema>;

/** The strip: a fixed sample, and the aggregate count it is a sample of. */
export const galleryPreviewSchema = z.strictObject({
  cards: z.array(previewCardSchema),
  total: z.number().int().nonnegative(),
});
export type GalleryPreview = z.infer<typeof galleryPreviewSchema>;

/**
 * `entries`, `facets` and `axisFacets` are OPTIONAL and ABSENT at state 0 —
 * optional, not nullable and not empty — and `preview` is what arrives
 * instead.
 *
 * The distinction is the whole design. An empty array would render under the
 * "Nobody has published a card yet" sentence, which is a lie about other
 * people's work; a client that forgets to check `state` should fail to compile
 * instead. And the withholding is SERVER-SIDE: a signed-out caller never
 * receives a wall entry, so there is nothing for `filter: none` in devtools to
 * reveal, and no search cache can hold one.
 *
 * State 1 gets the wall — one page of it, with the filters and the facets on
 * (§16.3). The cap is in `access.pageCap`, never in a silently truncated
 * `total`.
 */
export const galleryListingSchema = z.strictObject({
  access: galleryAccessSchema,
  entries: z.array(publicGalleryEntrySchema).optional(),
  /** Cards matching the query. Present only with the wall. */
  total: z.number().int().nonnegative().optional(),
  facets: z.array(galleryFacetSchema).optional(),
  axisFacets: z.array(galleryAxisFacetSchema).optional(),
  /** The fixed sample a state-0 caller gets INSTEAD of the wall. */
  preview: galleryPreviewSchema.optional(),
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
  .transform((raw): Omit<GalleryQuery, "axis" | "decided"> => ({
    type: raw.type ?? null,
    sort: raw.sort ?? "recent",
    withSite: raw.site === "1",
    limit: raw.limit ?? GALLERY_PAGE_SIZE,
    offset: raw.offset ?? 0,
  }));

/**
 * A `GalleryQuery` written back as a query STRING, canonically.
 *
 * The other half of `parseGalleryQuery`, and it exists because the browser
 * had grown a second, private vocabulary: `/gallery` forwarded its own URL to
 * the service verbatim, so `?sort=top&site=0` — a spelling no parser here has
 * ever accepted — went out on the wire and came back 400 (TEN-107). One
 * writer means the only queries the browser can send are the ones this file
 * can read, and `test/shapes.test.ts` round-trips them to keep it that way.
 *
 * A DEFAULT IS OMITTED, never spelled out. `sort=recent`, `offset=0` and the
 * page-size limit are what the parser fills in, so writing them adds noise to
 * every shareable link. An absent filter is an ABSENT PARAMETER: there is no
 * `site=0` and never was — `site` is the literal `"1"` or it is not there.
 */
export function galleryQueryString(query: GalleryQuery): string {
  const params = new URLSearchParams();
  if (query.type !== null) params.set("type", query.type);
  if (!isEmptyAxisFilter(query.axis)) params.set("axis", axisFilterString(query.axis));
  if (query.decided) params.set("decided", "1");
  if (query.sort !== "recent") params.set("sort", query.sort);
  if (query.withSite) params.set("site", "1");
  if (query.limit !== GALLERY_PAGE_SIZE) params.set("limit", String(query.limit));
  if (query.offset > 0) params.set("offset", String(query.offset));
  const qs = params.toString();
  return qs === "" ? "" : `?${qs}`;
}

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
  if (!parsed.success) return { ok: false, message: z.prettifyError(parsed.error) };

  // `held=` is the ONE unknown key that is refused rather than ignored, and it
  // is named here because it is the spelling somebody will try. A wall of
  // frozen snapshots has no "current" (ADR §7.3): the filter matches the run
  // each card was published from, and offering the word would promise a
  // person-level index this design does not build.
  if (raw.held !== undefined) {
    return {
      ok: false,
      message:
        "held: not a filter. A card is one run, so the wall has no 'current' or 'ever' to match",
    };
  }

  let axis = emptyAxisFilter();
  if (raw.axis !== undefined) {
    // `type` and `axis` are two spellings of one filter, and accepting both
    // invites them to disagree.
    if (parsed.data.type !== null) {
      return { ok: false, message: "type and axis are two spellings of one filter; send one" };
    }
    const filter = parseAxisFilter(raw.axis);
    if (!filter.ok) return filter;
    axis = filter.query;
  }

  let decided = false;
  if (raw.decided !== undefined) {
    // `decided=0` is a 400: a default is written by OMITTING the key, the same
    // rule `galleryQueryString` already follows for `site`.
    if (raw.decided !== "1") {
      return { ok: false, message: 'decided: only "1" is accepted; omit the parameter for the default' };
    }
    if (parsed.data.type === null && isEmptyAxisFilter(axis)) {
      return { ok: false, message: "decided=1 needs a type or an axis to be decided about" };
    }
    decided = true;
  }

  return { ok: true, query: { ...parsed.data, axis, decided } };
}

/** Longest refusal reason stored. Long enough to be useful, not a document. */
export const REJECT_REASON_MAX = 500;

export const REVIEW_DECISIONS = ["approve", "reject"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
