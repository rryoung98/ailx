/**
 * Server-mode plumbing shared by every route handler: one pg Pool for the
 * process, one checked-out client per request (transactions in @ailx/backend
 * need a single session), env-selected AuthProvider, Fetch ↔ handler
 * adaptation, and a last-resort 500 that never leaks internals.
 *
 * Only `app/api/**\/route.api.ts` and `app/**\/page.api.tsx` files import
 * this — in the static export neither extension is in `pageExtensions`, so
 * none of this is bundled.
 */
import { Pool } from "pg";
import {
  UNAUTHORIZED_RESULT,
  authProviderFromEnv,
  verifiedAuthProvider,
  type ApiContext,
  type ApiResult,
  type AuthProvider,
  type HeaderMap,
} from "@ailx/backend";
import { T1_LIMITS } from "@ailx/backend/t1";

let pool: Pool | undefined;
let auth: Promise<AuthProvider> | undefined;

/**
 * Request-body caps. The ZIP upload is bounded by the T1 snapshot cap itself
 * (a body that cannot inflate to a legal snapshot can never be accepted), so
 * there is exactly ONE number — T1_LIMITS.maxTotalBytes — and no second,
 * drifting limit. JSON bodies are event-log payloads: orders of magnitude
 * smaller, and capped separately so a JSON route is not a 25 MB memory hole.
 */
export const MAX_RAW_BODY_BYTES = T1_LIMITS.maxTotalBytes;
export const MAX_JSON_BODY_BYTES = 1024 * 1024;

const TOO_LARGE: ApiResult = {
  status: 413,
  body: { error: { code: "payload_too_large", message: "request body is too large" } },
};

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

function apiResponse(result: ApiResult): Response {
  return Response.json(result.body, { status: result.status });
}

/** The process-wide provider — resolved once, and fail-closed (see auth.ts). */
function authProvider(): Promise<AuthProvider> {
  auth ??= authProviderFromEnv(process.env);
  return auth;
}

/**
 * Read at most `cap` bytes, returning null the moment the cap is passed —
 * the stream is cancelled there, so an oversized upload is never fully held
 * in memory. `content-length` short-circuits the read when it is present and
 * honest, but it is never the only check: an absent or lying header still
 * hits the streaming cap.
 */
export async function readCappedBody(req: Request, cap: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get("content-length"));
  // NaN (absent/garbage header) is not > cap, so it falls through to the cap.
  if (declared > cap) return null;
  const stream = req.body;
  if (stream === null) return new Uint8Array(await req.arrayBuffer());
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel(); // Stop the sender; do not buffer the rest.
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/**
 * Check out one DB session, resolve the AuthProvider, run `fn`, release.
 * Shared by the API adapter and the server-only share PAGE, which needs the
 * same context without a Request/Response round trip.
 */
export async function withApiContext<T>(
  fn: (ctx: ApiContext) => Promise<T>,
  /** Pre-verified provider (apiRoute authenticates before it buffers a body). */
  provider?: AuthProvider,
): Promise<T> {
  const resolved = provider ?? (await authProvider());
  const client = await getPool().connect();
  try {
    return await fn({ db: client, auth: resolved });
  } finally {
    client.release();
  }
}

/**
 * Adapt a fetch Request onto an @ailx/backend handler. `rawBody` hands the
 * handler the request bytes untouched (T1 ZIP upload) instead of parsed JSON.
 *
 * Order matters: the caller is authenticated BEFORE a single body byte is
 * buffered, so an anonymous client cannot spend our memory. The verified
 * identity is then handed to the handler (which still authenticates through
 * the AuthProvider seam) instead of being verified a second time.
 */
export async function apiRoute(
  req: Request,
  fn: (ctx: ApiContext, headers: HeaderMap, body: unknown) => Promise<ApiResult>,
  opts: { rawBody?: boolean } = {},
): Promise<Response> {
  try {
    const headers = toHeaderMap(req);
    const provider = await authProvider();
    const identity = await provider.verify(headers);
    if (identity === null) return apiResponse(UNAUTHORIZED_RESULT);

    let body: unknown;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const cap = opts.rawBody ? MAX_RAW_BODY_BYTES : MAX_JSON_BODY_BYTES;
      const bytes = await readCappedBody(req, cap);
      if (bytes === null) return apiResponse(TOO_LARGE);
      if (opts.rawBody) {
        body = bytes;
      } else {
        try {
          body = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          body = undefined; // Empty/non-JSON body — handlers validate fields anyway.
        }
      }
    }

    return apiResponse(
      await withApiContext(
        (ctx) => fn(ctx, headers, body),
        verifiedAuthProvider(provider.name, identity),
      ),
    );
  } catch (err) {
    console.error("[ailx api]", err);
    return Response.json(
      { error: { code: "internal", message: "internal server error" } },
      { status: 500 },
    );
  }
}

/**
 * The current request's headers, lower-cased, for a server COMPONENT — a page
 * has no `Request` to read, and every server-gated page needs exactly this.
 * Defined once so two pages cannot build the map differently.
 */
export async function requestHeaderMap(): Promise<HeaderMap> {
  const { headers } = await import("next/headers");
  const h = await headers();
  const map: Record<string, string> = {};
  h.forEach((value, key) => {
    map[key.toLowerCase()] = value;
  });
  return map;
}

/** Next 15 dynamic-segment params for /api/attempts/[id]/... routes. */
export type AttemptRouteContext = { params: Promise<{ id: string }> };

/** Next 15 dynamic-segment params for the share capability routes. */
export type ShareRouteContext = { params: Promise<{ token: string }> };
