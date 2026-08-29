/**
 * Server-mode plumbing shared by every route handler: one pg Pool for the
 * process, one checked-out client per request (transactions in @ailx/backend
 * need a single session), env-selected AuthProvider, Fetch ↔ handler
 * adaptation, and a last-resort 500 that never leaks internals.
 *
 * Only `app/api/**\/route.api.ts` files import this — in the static export
 * those are not routes and none of this is bundled.
 */
import { Pool } from "pg";
import {
  authProviderFromEnv,
  type ApiContext,
  type ApiResult,
  type AuthProvider,
  type HeaderMap,
} from "@ailx/backend";

let pool: Pool | undefined;
let auth: Promise<AuthProvider> | undefined;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("server mode requires DATABASE_URL");
    pool = new Pool({ connectionString });
  }
  return pool;
}

function toHeaderMap(req: Request): HeaderMap {
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

/**
 * Adapt a fetch Request onto an @ailx/backend handler. `rawBody` hands the
 * handler the request bytes untouched (T1 ZIP upload) instead of parsed JSON.
 */
export async function apiRoute(
  req: Request,
  fn: (ctx: ApiContext, headers: HeaderMap, body: unknown) => Promise<ApiResult>,
  opts: { rawBody?: boolean } = {},
): Promise<Response> {
  let body: unknown;
  if (req.method !== "GET" && req.method !== "HEAD") {
    if (opts.rawBody) {
      body = new Uint8Array(await req.arrayBuffer());
    } else {
      try {
        body = await req.json();
      } catch {
        body = undefined; // Empty/non-JSON body — handlers validate fields anyway.
      }
    }
  }
  try {
    auth ??= authProviderFromEnv(process.env);
    const client = await getPool().connect();
    try {
      const result = await fn({ db: client, auth: await auth }, toHeaderMap(req), body);
      return Response.json(result.body, { status: result.status });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[ailx api]", err);
    return Response.json(
      { error: { code: "internal", message: "internal server error" } },
      { status: 500 },
    );
  }
}

/** Next 15 dynamic-segment params for /api/attempts/[id]/... routes. */
export type AttemptRouteContext = { params: Promise<{ id: string }> };
