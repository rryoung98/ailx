/**
 * The ROUTE MANIFEST — every URL of the exam service a browser may call,
 * declared once: method, path template, and the name of the success body.
 *
 * WHY IT EXISTS. The frontend and the exam service live in different
 * repositories and build independently. In 2026 a browser called
 * `POST /attempts/:id/score` on a deployed service that did not have it
 * (`packages/core/test/frontendOnly.test.ts`, file header). A shared wire
 * TYPE does not catch that: nothing compiles both sides, and the request path
 * was a string in a component. So the paths live here, and
 * `apps/web/test/routeManifest.test.ts` fails the build if any module in
 * `apps/web` spells one by hand again.
 *
 * WHAT A PATH HERE IS. The path BELOW the versioned root, never including it.
 * The root is spelled differently by the two hosts — `/api` for this app's own
 * origin, `<origin>/v1` for the standalone service — and translating it is
 * `apps/web/lib/mode.ts` `apiBase()`'s job, which stays the only reader of
 * `NEXT_PUBLIC_AILX_API_BASE`.
 *
 * WHAT IS NOT HERE, on purpose:
 *  - the SERVED-SITE space, `/api/site/<digest>/index.html`. It is not
 *    versioned, it is frozen into stored share payloads and credential claims,
 *    and `./site-url.js` `siteUrlPath()` already owns that one spelling.
 *  - the share VIEW and its card, `/s/<token>` and `/s/<token>/card.png`.
 *    Those are pages of the FRONTEND, not routes of the service;
 *    `./share-url.js` owns them.
 *  - `/livez` and `/readyz`. The platform calls them; no browser does.
 *
 * WHAT THIS DOES NOT DO, AND WHO MUST FINISH IT. This table proves nothing on
 * its own: it names routes, and only the service knows which routes it mounts.
 * The private repo vendors this file byte for byte (`pnpm sync:shared:check`),
 * so the assertion it owes is a loop over `API_ROUTES`, and it is TWO
 * directions:
 *
 *  1. every entry here is mounted. For each `[key, route]`, the Hono app must
 *     have a handler for `route.method` at `/v1${route.path}` — the template
 *     compared literally, `:id` against `:id`. A manifest entry with no
 *     handler is the 2026 failure, one release earlier.
 *  2. every mounted `/v1` route appears here. Enumerate the app's routes
 *     (`app.routes` gives method and path), drop `/livez`, `/readyz` and the
 *     `/api/site/*` space, and the remainder must equal this table exactly.
 *     A route the manifest does not name is a route the browser cannot reach
 *     through `apiPath()`, so it is either dead or it is drift.
 *
 * Neither direction checks a response BODY. Enumerating routes cannot prove
 * what a handler returns, so `response` below is a NAME a reader can check,
 * not a type a compiler enforces. Closing that half means making the private
 * repo's `apiRoute` wrapper generic in `ApiRouteKey`; that is a separate
 * decision (docs/ADR-orpc.md §8, TEN-43).
 *
 * TWO ENTRIES HAVE NO CALLER in `apps/web` today: `getAttempt` and
 * `countShareView`. They stay listed because direction 2 above is an equality,
 * and a service route missing from this table would fail it. Delete the route
 * and the entry together, or neither.
 *
 * ORDER IS NOT DECLARED. This is a table, not a router. `/practice/claim` must
 * still be mounted before `/practice/:id` — Hono matches in registration order
 * and "claim" is a valid-looking session id — and nothing here says so.
 */
import { parseCaseQuery } from "./moderation.js";
import { parseGalleryQuery } from "./gallery.js";

export type ApiMethod = "GET" | "POST" | "DELETE";

/**
 * Which pure parser normalizes this route's query string. Named rather than
 * inlined so the manifest and `parseGalleryQuery`/`parseCaseQuery` cannot
 * drift: a route that takes `?limit=` must say which clamp applies to it.
 */
export type ApiQueryParserName = "gallery" | "case";

export interface ApiRoute {
  readonly method: ApiMethod;
  /** Template below the versioned root; `:name` marks a parameter. */
  readonly path: string;
  /** The success body, as the browser reads it. A name, not a checked type. */
  readonly response: string;
  /**
   * The shared parser that normalizes this route's query string, when one
   * exists. Absence does not mean the route takes no query: `uploadSite`
   * carries `?seq=` (`apps/web/lib/siteUpload.ts`), which only the service
   * reads. A parser is named here when the browser and the service must clamp
   * the same input the same way.
   */
  readonly queryParser?: ApiQueryParserName;
}

export const API_ROUTES = {
  // ---- attempts -----------------------------------------------------------
  createAttempt: { method: "POST", path: "/attempts", response: "{ attempt: { id }, decks?: DeckRecord[] }" },
  getAttempt: { method: "GET", path: "/attempts/:id", response: "{ attempt: AttemptRecord }" },
  appendResponse: { method: "POST", path: "/attempts/:id/responses", response: "{ response: AppendResult }" },
  appendTranscript: { method: "POST", path: "/attempts/:id/transcripts", response: "{ transcript: AppendResult }" },
  finalizeAttempt: { method: "POST", path: "/attempts/:id/finalize", response: "{ attempt: AttemptRecord }" },
  scoreTrack: { method: "POST", path: "/attempts/:id/score", response: "ServerTrackScore" },
  attemptItems: { method: "GET", path: "/attempts/:id/items", response: "{ phase, deckDigest, released, items }" },
  attemptTrackView: { method: "GET", path: "/attempts/:id/track/:trackId", response: "{ phase, released, view }" },
  t3Assist: { method: "POST", path: "/attempts/:id/t3/assist", response: "{ text, claimRefs, seq }" },
  // ---- share --------------------------------------------------------------
  createShare: { method: "POST", path: "/attempts/:id/share", response: "{ share: OwnerShare }" },
  getShare: { method: "GET", path: "/attempts/:id/share", response: "{ share: OwnerShare }" },
  revokeShare: { method: "DELETE", path: "/attempts/:id/share", response: "{ share: OwnerShare }" },
  publishShare: { method: "POST", path: "/attempts/:id/share/publish", response: "{ share: OwnerShare }" },
  // ---- credentials --------------------------------------------------------
  issueCredential: { method: "POST", path: "/attempts/:id/credential", response: "{ credential: OwnerCredential }" },
  getCredential: { method: "GET", path: "/attempts/:id/credential", response: "{ credential: OwnerCredential }" },
  revokeCredential: { method: "DELETE", path: "/attempts/:id/credential", response: "{ credential: OwnerCredential }" },
  // ---- T1 candidate site --------------------------------------------------
  uploadSite: { method: "POST", path: "/attempts/:id/site", response: "{ submission: { digest, created } }" },
  siteUploadTicket: { method: "POST", path: "/attempts/:id/site/upload-ticket", response: "{ upload: UploadTicket }" },
  finalizeSiteUpload: { method: "POST", path: "/attempts/:id/site/finalize", response: "{ submission: { digest, created } }" },
  exportSite: { method: "GET", path: "/attempts/:id/site/export", response: "application/zip bytes, not JSON" },
  startGithubExport: { method: "POST", path: "/attempts/:id/site/github/start", response: "{ authorization: GithubAuthorization }" },
  finishGithubExport: { method: "POST", path: "/attempts/:id/site/github", response: "{ repo: ExportedRepo }" },
  // ---- moderation ---------------------------------------------------------
  candidateThread: { method: "GET", path: "/attempts/:id/moderation", response: "{ thread: CandidateThread }" },
  candidateReply: { method: "POST", path: "/attempts/:id/moderation", response: "{ thread: CandidateThread }" },
  moderationCases: { method: "GET", path: "/moderation/cases", response: "{ listing: CaseListing }", queryParser: "case" },
  moderationCase: { method: "GET", path: "/moderation/:id", response: "{ case: ModerationCaseDetail }" },
  moderationComment: { method: "POST", path: "/moderation/:id", response: "{ comment: ModerationComment }" },
  // ---- gallery + review ---------------------------------------------------
  gallery: { method: "GET", path: "/gallery", response: "{ gallery: GalleryListing }", queryParser: "gallery" },
  reviewQueue: { method: "GET", path: "/gallery/review", response: "{ submissions: GalleryEntry[] }" },
  reviewDecision: { method: "POST", path: "/gallery/review", response: "{ share: GalleryEntry }" },
  // ---- practice + progress ------------------------------------------------
  startPractice: { method: "POST", path: "/practice", response: "{ session: { id, itemIds } }" },
  claimPractice: { method: "POST", path: "/practice/claim", response: "{ claimed: string[], progress: ProgressReport }" },
  submitPractice: { method: "POST", path: "/practice/:id", response: "{ result, progress: ProgressReport }" },
  progress: { method: "GET", path: "/progress", response: "{ progress: ProgressReport, claimedDays?: string[] }" },
  aggregates: { method: "GET", path: "/aggregates", response: "{ aggregates: WorldAggregates }" },
  // ---- public reads (the token or the code IS the capability) -------------
  shareView: { method: "GET", path: "/share/:token", response: "{ share: SharedView }" },
  countShareView: { method: "POST", path: "/share/:token/views", response: "{ views: number }" },
  credentialView: { method: "GET", path: "/credentials/:code", response: "CredentialRecord" },
} as const satisfies Record<string, ApiRoute>;

export type ApiRouteKey = keyof typeof API_ROUTES;

/**
 * The pure query normalizer each `queryParser` name refers to. One object, so a new
 * parser cannot be added to the package without a route being able to name it.
 */
export const API_QUERY_PARSERS = {
  gallery: parseGalleryQuery,
  case: parseCaseQuery,
} as const satisfies Record<ApiQueryParserName, (raw: Record<string, string | undefined>) => unknown>;

/**
 * A path built from the manifest. BRANDED so the type system says what the
 * grep guard says: `apiPath()` is the only way to make one, and a hand-written
 * string is not one.
 */
export type ApiPath = string & { readonly __brand: "ApiPath" };

const PARAM_RE = /:([A-Za-z][A-Za-z0-9]*)/g;

/**
 * The path for one route, parameters substituted and percent-encoded.
 *
 * Throws rather than guesses. A missing parameter used to produce
 * `/attempts/undefined/items` — a real request, a 404, and nothing to read in
 * the log. `query` is appended verbatim and must be empty or start with "?";
 * it is not parsed here, because the parser that owns it is named on the route
 * (`API_QUERY_PARSERS`) and runs server-side.
 */
export function apiPath(
  routeKey: ApiRouteKey,
  params: Readonly<Record<string, string>> = {},
  query = "",
): ApiPath {
  const route = API_ROUTES[routeKey] as ApiRoute | undefined;
  if (route === undefined) throw new Error(`unknown route: ${String(routeKey)}`);
  if (query !== "" && !query.startsWith("?")) throw new Error(`query must start with "?": ${query}`);
  const declared = new Set<string>();
  const path = route.path.replace(PARAM_RE, (_m, name: string) => {
    declared.add(name);
    const value = params[name];
    if (typeof value !== "string" || value === "") {
      throw new Error(`route ${routeKey}: missing parameter "${name}"`);
    }
    return encodeURIComponent(value);
  });
  for (const given of Object.keys(params)) {
    if (!declared.has(given)) throw new Error(`route ${routeKey}: no parameter "${given}"`);
  }
  return `${path}${query}` as ApiPath;
}
