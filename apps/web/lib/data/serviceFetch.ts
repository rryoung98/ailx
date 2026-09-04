"use client";

/**
 * ONE way for a PAGE to read the exam service.
 *
 * Seven server-rendered pages used to import `@ailx/backend` handlers
 * in-process through `lib/server/api.ts`. They now call the service over
 * HTTP like every other browser surface, which is what lets that duplicate
 * host be deleted (docs/ARCHITECTURE.md 10.1). Seven copies of
 * fetch + identity + try/catch + "what does a non-200 mean here" would have
 * been seven chances to disagree, so there is one:
 *
 *  - the URL is always `apiBase()` + an `ApiPath` built by `apiPath()` from
 *    the route manifest in `@ailx/contract`, never a path spelled here (the
 *    seam is the only thing that knows which host answers, and the manifest is
 *    the only thing that knows which routes exist);
 *  - IDENTITY travels as a HEADER, from `lib/data/authHeaders.ts`. The
 *    `ailx_dev_user` cookie is `SameSite=Lax` and is NOT sent cross-origin,
 *    so the moment `NEXT_PUBLIC_AILX_API_BASE` names another origin a cookie
 *    identity is simply gone. Any page that shows one person their own rows
 *    (`/progress`, `/review`, `/review/[id]`) MUST pass `identity:
 *    "required"`, and a PUBLIC page passes `identity: "optional"` so it sends
 *    what the browser has without inventing a caller it does not have;
 *  - a non-200 is reported as `missing` WITH its status AND the reason the
 *    service gave, so a page can tell "the server does not know you" from
 *    "that token does not exist" — and can say which, out loud. It is never
 *    flattened into an empty render, and never into "we could not reach it":
 *    a refusal is an answer;
 *  - a thrown fetch (offline, DNS, CORS) becomes `error`, which every caller
 *    renders as a sentence. A page that cannot reach its data says so.
 */
import { useQuery } from "@tanstack/react-query";
import { parseApiError, type ApiPath, type ResponseSchema } from "@ailx/contract";
import type { StorageLike } from "@ailx/session";
import { serviceHeaders, traceHeaders } from "./traceparent";
import type { IdentityMode } from "./authHeaders";
import { apiBase } from "../mode";

/**
 * The four things a page can be, and nothing else.
 *
 * `missing` is a call that LANDED and was refused, so it carries the status
 * and — when the service sent its own envelope — the reason it gave. Those
 * two facts are the difference between "we could not reach it" and "it
 * answered and said no", and a page that prints the first for the second is
 * telling a reader something false (TEN-107). The state keeps its name
 * because renaming it would touch six call sites and change nothing a reader
 * sees; what changed is that it now carries enough to be said out loud.
 */
export type ServiceState<T> =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly data: T }
  | { readonly state: "missing"; readonly status: number; readonly reason?: string }
  | { readonly state: "error"; readonly message: string };

/**
 * What a reader is told when the call NEVER LANDED — a thrown fetch: offline,
 * DNS, a blocked origin. Nothing was reached, so there is nothing to quote.
 */
export const SERVICE_ERROR_COPY =
  "The AILX service did not answer, so this page shows nothing rather than something invented. Check your connection and reload.";

/**
 * What a reader is told when the call LANDED AND WAS REFUSED. A different
 * fact from the one above, and the page says which: the status, and the
 * service's own sentence where it sent one.
 *
 * 401 is called out by name because it is the only refusal on a public page a
 * reader could otherwise read as their fault. It is ours: these three pages
 * are meant to be readable with no account (docs/ARCHITECTURE.md), and a 401
 * here means the service has not been opened up yet, not that the reader did
 * something wrong.
 */
export function serviceRefusedCopy(status: number, reason?: string): string {
  const said = reason === undefined ? "" : ` It said: ${reason}`;
  if (status === 401 || status === 403) {
    return `The AILX service was reached and would not answer this page without an account (HTTP ${status}). This page is meant to be public, so that is a fault on our side, not yours.${said}`;
  }
  return `The AILX service was reached and refused this request (HTTP ${status}), so nothing from it is shown. Your connection is fine.${said}`;
}

/**
 * What a reader is told when the call landed and the body was not the shape
 * this route promises. It is a different fact from "we could not reach it",
 * and the page must not pretend otherwise: the service answered, and what it
 * said could not be trusted, so nothing is rendered from it.
 */
export const SERVICE_INVALID_COPY =
  "The AILX service answered with something this page could not read, so nothing from it is shown. That is a bug on our side, not a problem with your connection.";

/**
 * The browser's own store, or null where there is none (server render, a
 * locked-down browser). Null means "send no identity" — never a fabricated
 * one, and never a crash on a page that does not need identity at all.
 */
function browserStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    // `?? null`, because a browser (and jsdom) can have a `window` with NO
    // `localStorage` at all. Returning `undefined` here used to pass an
    // undefined store into `authHeaders`, which threw INSIDE the try and
    // turned a perfectly reachable service into "we could not reach it" — a
    // page that made no request at all and blamed the network for it.
    return (window.localStorage as StorageLike | undefined) ?? null;
  } catch {
    return null;
  }
}

export interface ServiceOptions<T = unknown> {
  /**
   * How hard this read needs an identity. Default `"anonymous"` — send none.
   *
   *  - `"required"` — one person's rows (`/progress`, `/review`). An id is
   *    minted if this browser has none, because the question is meaningless
   *    without one.
   *  - `"optional"` — a PUBLIC read. Send the id this browser already has,
   *    and nothing when it has none. Every `/v1` route is behind auth today,
   *    so a returning browser keeps working; a first-time visitor gets the
   *    honest refusal instead of a page that only worked because it invented
   *    a caller (TEN-107).
   */
  readonly identity?: "anonymous" | IdentityMode;
  readonly signal?: AbortSignal;
  /**
   * The route's response schema from `API_RESPONSE_SCHEMAS`. With one, a body
   * that is not the promised shape becomes `error` and NOTHING is rendered
   * from it. Without one, the body is cast, exactly as it always was — this is
   * per-route work and the seam does not pretend otherwise.
   */
  readonly schema?: ResponseSchema<T>;
}

/** Longest refusal sentence quoted to a reader. A message, not a document. */
const REASON_MAX = 200;

/**
 * What the service SAID about a refusal, ready to spread into the state.
 *
 * Only the frozen envelope is quoted (`parseApiError` in `@ailx/contract`) —
 * a proxy's HTML error page is not a sentence we may put in front of a
 * reader. Whitespace is collapsed because the service's query errors are
 * multi-line, and a body that will not even parse is simply no reason: the
 * status alone is still an honest thing to say.
 */
async function refusal(res: Response): Promise<{ reason?: string }> {
  try {
    const parsed = parseApiError(await res.json());
    if (parsed === null) return {};
    const reason = parsed.message.replace(/\s+/g, " ").trim().slice(0, REASON_MAX);
    return reason === "" ? {} : { reason };
  } catch {
    return {};
  }
}

/** One GET against the exam service, resolved into a `ServiceState`. */
export async function serviceFetch<T>(
  path: ApiPath,
  opts: ServiceOptions<T> = {},
): Promise<ServiceState<T>> {
  try {
    const identity = opts.identity ?? "anonymous";
    const storage = identity === "anonymous" ? null : browserStorage();
    // A trace goes on EVERY read, identified or not. `/wall` and `/gallery`
    // are anonymous and still worth being able to follow into the service;
    // the header is 55 characters of random hex and says nothing about who
    // asked (lib/data/traceparent.ts).
    //
    // KNOWN COST, cross-origin: a custom header makes a GET non-simple, so an
    // anonymous read that used to go straight out now costs a CORS preflight
    // first. Identified reads always paid it (`x-ailx-dev-user` is custom
    // too). The service allows `traceparent` in `Access-Control-Allow-Headers`
    // — without that the browser would drop the header and the continuation
    // would silently never happen. docs/ADR-otel.md §6.
    const headers =
      storage === null || identity === "anonymous"
        ? traceHeaders()
        : await serviceHeaders(storage, identity);
    const res = await fetch(`${apiBase()}${path}`, {
      headers,
      cache: "no-store",
      signal: opts.signal,
    });
    if (res.status !== 200) return { state: "missing", status: res.status, ...(await refusal(res)) };
    const body: unknown = await res.json();
    if (opts.schema === undefined) return { state: "ready", data: body as T };
    const parsed = opts.schema.safeParse(body);
    if (parsed.success) return { state: "ready", data: parsed.data };
    // Loud, because nobody would otherwise hear it: the page renders a
    // sentence, and the console carries the field that was wrong.
    console.error(`AILX: ${path} answered with an unreadable body`, parsed.error);
    return { state: "error", message: SERVICE_INVALID_COPY };
  } catch {
    // Aborted by the query's cleanup: the component is gone, so stay in the
    // state it already had rather than flashing an error on the way out.
    if (opts.signal?.aborted === true) return { state: "loading" };
    return { state: "error", message: SERVICE_ERROR_COPY };
  }
}

/**
 * A page's own query string, ready to append to a service path.
 *
 * FIRST VALUE ONLY. The server pages flattened `searchParams` before handing
 * it to a handler, so `?lane=decided&lane=pending` was one value, not two.
 * `useSearchParams()` keeps both, and a service reading "the last one" would
 * silently answer a different question than the page it replaced. Empty query
 * gives an empty string, so `/gallery` stays `/gallery`.
 */
export function firstValueQuery(params: URLSearchParams | null | undefined): string {
  const out = new URLSearchParams(Object.entries(firstValues(params)));
  const qs = out.toString();
  return qs === "" ? "" : `?${qs}`;
}

/**
 * The same first-value rule as a RECORD, which is what the contract's query
 * parsers take. `/gallery` reads its own URL through `parseGalleryQuery`
 * before it asks for anything, and `Object.fromEntries(params)` would have
 * kept the LAST value of a repeated key — the opposite rule from the one the
 * rest of this seam follows.
 */
export function firstValues(params: URLSearchParams | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (params !== null && params !== undefined) {
    for (const key of new Set(params.keys())) out[key] = params.get(key)!;
  }
  return out;
}

/**
 * The same read, as a hook — a TanStack Query `useQuery` under the seam.
 *
 * The four states stay, because they say something `useQuery` does not: a
 * non-200 is `missing` WITH its status, which is a fact a page renders
 * differently from an outage. What the library replaces is the hand-rolled
 * part around it: the mount effect, the `AbortController`, the `cancelled`
 * flag and the `setState` that had to check it. What it adds is a cache keyed
 * by the path, so a reader who goes to a card and comes back sees the wall
 * they left instead of a spinner, and two components asking for the same path
 * make one request.
 *
 * `path` may be null when there is nothing to ask for yet; the state then
 * stays `loading` and no request is made.
 */
export function useService<T>(path: ApiPath | null, opts: ServiceOptions<T> = {}): ServiceState<T> {
  const identity = opts.identity ?? "anonymous";
  const { schema } = opts;
  const query = useQuery({
    // The key says HOW the read was identified, not who it was — the id is
    // resolved inside `authHeaders()`, one layer down. `QueryProvider` clears
    // the cache when the account changes, which is what stops one person's
    // rows being served to the next.
    queryKey: ["service", path, identity],
    enabled: path !== null,
    queryFn: ({ signal }) => serviceFetch<T>(path!, { identity, signal, schema }),
  });
  // `serviceFetch` resolves every EXPECTED failure into a state and throws
  // nothing, so `isError` here means something unforeseen threw. Reporting it
  // as `error` rather than falling through to `loading` is the difference
  // between a page that says so and a spinner that never stops.
  if (query.isError) return { state: "error", message: SERVICE_ERROR_COPY };
  return query.data ?? { state: "loading" };
}
