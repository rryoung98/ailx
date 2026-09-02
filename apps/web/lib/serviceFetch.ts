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
 *  - IDENTITY travels as a HEADER, from `lib/authHeaders.ts`. The
 *    `ailx_dev_user` cookie is `SameSite=Lax` and is NOT sent cross-origin,
 *    so the moment `NEXT_PUBLIC_AILX_API_BASE` names another origin a cookie
 *    identity is simply gone. Any page that shows one person their own rows
 *    (`/progress`, `/review`, `/review/[id]`) MUST pass `identified: true`;
 *  - a non-200 is reported as `missing` WITH its status, so a page can tell
 *    "the server does not know you" from "that token does not exist" — it is
 *    never flattened into an empty render;
 *  - a thrown fetch (offline, DNS, CORS) becomes `error`, which every caller
 *    renders as a sentence. A page that cannot reach its data says so.
 */
import { useQuery } from "@tanstack/react-query";
import type { ApiPath, ResponseSchema } from "@ailx/contract";
import type { StorageLike } from "@ailx/session";
import { authHeaders } from "./authHeaders";
import { apiBase } from "./mode";

/** The four things a page can be, and nothing else. */
export type ServiceState<T> =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly data: T }
  | { readonly state: "missing"; readonly status: number }
  | { readonly state: "error"; readonly message: string };

/** What a reader is told when the call never landed. Honest, not blank. */
export const SERVICE_ERROR_COPY =
  "We could not reach the AILX service, so this page has nothing to show you rather than something invented. Reload in a moment.";

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
    return typeof window === "undefined" ? null : (window.localStorage as StorageLike | null);
  } catch {
    return null;
  }
}

export interface ServiceOptions<T = unknown> {
  /** Send `authHeaders()`. Required for any page that shows one person's rows. */
  readonly identified?: boolean;
  readonly signal?: AbortSignal;
  /**
   * The route's response schema from `API_RESPONSE_SCHEMAS`. With one, a body
   * that is not the promised shape becomes `error` and NOTHING is rendered
   * from it. Without one, the body is cast, exactly as it always was — this is
   * per-route work and the seam does not pretend otherwise.
   */
  readonly schema?: ResponseSchema<T>;
}

/** One GET against the exam service, resolved into a `ServiceState`. */
export async function serviceFetch<T>(
  path: ApiPath,
  opts: ServiceOptions<T> = {},
): Promise<ServiceState<T>> {
  try {
    const storage = opts.identified === true ? browserStorage() : null;
    const headers = storage === null ? {} : await authHeaders(storage);
    const res = await fetch(`${apiBase()}${path}`, {
      headers,
      cache: "no-store",
      signal: opts.signal,
    });
    if (res.status !== 200) return { state: "missing", status: res.status };
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
  const out = new URLSearchParams();
  if (params !== null && params !== undefined) {
    for (const key of new Set(params.keys())) out.set(key, params.get(key)!);
  }
  const qs = out.toString();
  return qs === "" ? "" : `?${qs}`;
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
  const identified = opts.identified === true;
  const { schema } = opts;
  const query = useQuery({
    // The key says WHETHER the read was identified, not who it was — the id
    // is resolved inside `authHeaders()`, one layer down. `QueryProvider`
    // clears the cache when the account changes, which is what stops one
    // person's rows being served to the next.
    queryKey: ["service", path, identified],
    enabled: path !== null,
    queryFn: ({ signal }) => serviceFetch<T>(path!, { identified, signal, schema }),
  });
  // `serviceFetch` resolves every EXPECTED failure into a state and throws
  // nothing, so `isError` here means something unforeseen threw. Reporting it
  // as `error` rather than falling through to `loading` is the difference
  // between a page that says so and a spinner that never stops.
  if (query.isError) return { state: "error", message: SERVICE_ERROR_COPY };
  return query.data ?? { state: "loading" };
}
