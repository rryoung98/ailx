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
 * appear here — with ONE declared exception, `funnelEvents`, which the
 * service does not mount yet and which says so on its own entry (TEN-133). Neither direction reads a response body, so `response` is a
 * name a reader can check, not a type a compiler enforces (docs/ADR-orpc.md
 * §8, TEN-43) — unless the route also has a schema in `API_RESPONSE_SCHEMAS`,
 * which the browser validates the body against (docs/ADR-zod-tanstack.md). `getAttempt` has no caller in `apps/web`; it stays
 * listed because that second check is an equality. `countShareView` had none
 * until TEN-146 and now has one (`apps/web/lib/data/shareViews.ts`).
 *
 * Order is not declared. `/practice/claim` must still be mounted before
 * `/practice/:id`, and nothing here says so.
 */

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
  /**
   * The success body, as the browser reads it. A name, not a checked type —
   * except where `API_RESPONSE_SCHEMAS` holds a schema for the same key, and
   * then the seam checks it (`apps/web/lib/serviceFetch.ts`).
   */
  readonly response: string;
  /**
   * The shared parser that normalizes this route's query string, when one
   * exists. Absence does not mean the route takes no query: `uploadSite`
   * carries `?seq=` (`apps/web/lib/data/siteUpload.ts`), which only the service
   * reads. A parser is named here when the browser and the service must clamp
   * the same input the same way.
   */
  readonly queryParser?: ApiQueryParserName;
}

/**
 * The model gateway's own root, below the versioned root.
 *
 * Named once because two things need it and they must not drift: the six
 * route templates below, and the OpenAI-compatible BASE URL a track runner is
 * handed (`apps/web/lib/data/modelGateway.ts`). `<root>/model` + `/chat/
 * completions` is exactly the shape an OpenAI client already builds, so the
 * runners keep one request builder for both the hosted gateway and a local
 * endpoint.
 */
export const MODEL_ROOT = "/model";

export const API_ROUTES = {
  // ---- attempts -----------------------------------------------------------
  createAttempt: { method: "POST", path: "/attempts", response: "{ attempt: { id }, decks?: DeckRecord[] }" },
  getAttempt: {
    method: "GET",
    path: "/attempts/:id",
    // `scores` is the attempt's scores of record, including the ones the
    // judging pass issues after finalize has answered (TEN-69). It is a field
    // on this read rather than a route of its own, so this manifest keeps the
    // same URLs it froze.
    response: "{ attempt: AttemptRecord, decks?: DeckRecord[], scores?: AttemptScores }",
  },
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
  // ---- model gateway ------------------------------------------------------
  // The provider key is held by the SERVICE, sealed against the caller's
  // identity, and no route here returns it. Every one is mounted behind the
  // service's auth seam, so an anonymous browser gets 401 before a body is
  // read — which is why the static export cannot use any of them (TEN-62).
  modelCatalog: { method: "GET", path: `${MODEL_ROOT}/models`, response: "{ data: { id: string }[] }" },
  modelChat: { method: "POST", path: `${MODEL_ROOT}/chat/completions`, response: "the provider's chat-completion body, verbatim" },
  modelKey: { method: "GET", path: `${MODEL_ROOT}/key`, response: "{ connected, provider, fingerprint?, connectedAt? }" },
  disconnectModelKey: { method: "DELETE", path: `${MODEL_ROOT}/key`, response: "{ connected: false, provider, removed }" },
  startModelConnect: { method: "POST", path: `${MODEL_ROOT}/connect/start`, response: "{ provider, state, authorizeUrl, expiresAt }" },
  finishModelConnect: { method: "POST", path: `${MODEL_ROOT}/connect/callback`, response: "{ connected: true, provider, fingerprint }" },
  // ---- funnel ------------------------------------------------------------
  /**
   * THE FUNNEL SINK, WHICH NO DEPLOYMENT MOUNTS YET (TEN-133).
   *
   * `FUNNEL_EVENTS_PATH` lived only in `./funnel.js`, outside this manifest,
   * so `apps/web/test/routeManifest.test.ts` could not see the spelling and
   * nothing compared it with the service. On 2026-09-04 every page load on
   * staging posted here and got 404 `no such route`: the exam service
   * registers no `/v1/events`, and all funnel telemetry was dropped in
   * silence. It is listed HERE so the browser's one spelling is the
   * manifest's, and so the day the service mounts it, both sides mean the
   * same URL. Until then the emitter stops posting after the first 404
   * rather than repeating it on every page (`apps/web/lib/data/funnel.ts`).
   *
   * This is the ONE entry the service does not mount. Every other route in
   * this file is live.
   */
  funnelEvents: { method: "POST", path: "/events", response: "{ ok: true }" },
  // ---- public reads (the token or the code IS the capability) -------------
  shareView: { method: "GET", path: "/share/:token", response: "{ share: SharedView }" },
  countShareView: { method: "POST", path: "/share/:token/views", response: "{ views: number }" },
  credentialView: { method: "GET", path: "/credentials/:code", response: "CredentialRecord" },
} as const satisfies Record<string, ApiRoute>;

export type ApiRouteKey = keyof typeof API_ROUTES;

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
