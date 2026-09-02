/**
 * The route manifest: every URL of the exam service a browser may call, with
 * its method, its path template and the name of its success body.
 *
 * The frontend and the service build in separate repositories, and nothing
 * compiles both sides. In 2026 a browser called `POST /attempts/:id/score` on
 * a deployed service that did not have it, because the path was a string in a
 * component (`packages/core/test/frontendOnly.test.ts`, file header).
 * `apps/web/test/routeManifest.test.ts` fails the build on one now.
 *
 * A path here sits below the versioned root and never includes it. `apiBase()`
 * in `apps/web/lib/mode.ts` owns "/api" against "<origin>/v1". Left out on
 * purpose are the served-site space (`./site-url.js` owns that spelling), the
 * share view and its card (`./share-url.js`), and `/livez` and `/readyz`,
 * which no browser calls.
 *
 * Only the service knows which routes it mounts, and the private repo vendors
 * this file, so the check it owes there runs both ways. Every entry must be
 * mounted at `/v1${path}` for its method, and every mounted `/v1` route must
 * appear here. Neither direction reads a response body, so `response` is a
 * name a reader can check, not a type a compiler enforces (docs/ADR-orpc.md
 * §8, TEN-43). `getAttempt` and `countShareView` have no caller in `apps/web`;
 * they stay listed because that second check is an equality.
 *
 * Order is not declared. `/practice/claim` must still be mounted before
 * `/practice/:id`, and nothing here says so.
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
 * A path built from the manifest. Branded, so the type system says what the
 * guard in `apps/web` says. `apiPath()` is the only way to make one, and a
 * hand-written string is not one.
 */
export type ApiPath = string & { readonly __brand: "ApiPath" };

const PARAM_RE = /:([A-Za-z][A-Za-z0-9]*)/g;

/** The `:name` parameters of a path template, as a union of their names. */
type PathParams<P extends string> = P extends `${string}:${infer Name}/${infer Rest}`
  ? Name | PathParams<Rest>
  : P extends `${string}:${infer Name}`
    ? Name
    : never;

/**
 * What `apiPath()` takes after the route key. A route with parameters requires
 * an object holding exactly them; a route without takes none. So
 * `apiPath("attemptItems")` and `apiPath("gallery", { id })` are compile
 * errors, not runtime throws.
 */
type ApiPathArgs<K extends ApiRouteKey> = [PathParams<(typeof API_ROUTES)[K]["path"]>] extends [never]
  ? [params?: Readonly<Record<string, never>>, query?: string]
  : [params: Readonly<Record<PathParams<(typeof API_ROUTES)[K]["path"]>, string>>, query?: string];

/**
 * The path for one route, parameters substituted and percent-encoded.
 *
 * Still throws rather than guesses, because a value can be empty or arrive
 * from an `any`. A missing parameter used to produce
 * `/attempts/undefined/items`, which is a real request, a 404, and nothing to
 * read in the log. `query` is appended verbatim and must be empty or start
 * with "?". It is not parsed here, because the parser that owns it is named on
 * the route (`API_QUERY_PARSERS`) and runs server-side.
 */
export function apiPath<K extends ApiRouteKey>(routeKey: K, ...args: ApiPathArgs<K>): ApiPath {
  const [params = {}, query = ""] = args as [Readonly<Record<string, string>>?, string?];
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
