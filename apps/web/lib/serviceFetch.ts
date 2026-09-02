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
import { useEffect, useState } from "react";
import type { ApiPath } from "@ailx/contract";
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

export interface ServiceOptions {
  /** Send `authHeaders()`. Required for any page that shows one person's rows. */
  readonly identified?: boolean;
  readonly signal?: AbortSignal;
}

/** One GET against the exam service, resolved into a `ServiceState`. */
export async function serviceFetch<T>(
  path: ApiPath,
  opts: ServiceOptions = {},
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
    return { state: "ready", data: (await res.json()) as T };
  } catch {
    // Aborted by the effect's cleanup: the component is gone, so stay in the
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
 * The same read, as a hook. `path` may be null when there is nothing to ask
 * for yet; the state then stays `loading` and no request is made.
 */
export function useService<T>(path: ApiPath | null, opts: ServiceOptions = {}): ServiceState<T> {
  const identified = opts.identified === true;
  const [state, setState] = useState<ServiceState<T>>({ state: "loading" });
  useEffect(() => {
    if (path === null) return;
    const ctrl = new AbortController();
    setState({ state: "loading" });
    void serviceFetch<T>(path, { identified, signal: ctrl.signal }).then((next) => {
      if (!ctrl.signal.aborted) setState(next);
    });
    return () => ctrl.abort();
  }, [path, identified]);
  return state;
}
