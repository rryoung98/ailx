/**
 * The API envelope both sides speak: `{ status, body }`, and the two frozen
 * refusal bodies.
 *
 * A rejection produced BEFORE a handler runs (an adapter that must know the
 * caller before it buffers a body) has to be byte-identical to one produced
 * inside it, and a test in the browser repo asserts on those exact bytes. So
 * the envelope and the refusals are defined once, here, and the handlers and
 * their adapters import them.
 */

export interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

/** The single 401 body. */
export const UNAUTHORIZED_RESULT: ApiResult = {
  status: 401,
  body: { error: { code: "unauthorized", message: "authentication required" } },
};

/**
 * The refusal envelope, read back.
 *
 * A page that says "we could not reach the service" when the service in fact
 * answered and refused is telling a reader something false (TEN-107). To say
 * the true thing a browser has to be able to open the body it got, and the
 * shape of that body is a wire fact, so it is read here rather than guessed
 * at a call site. Anything that is not the envelope is null — a proxy's HTML
 * error page is not a message we may quote.
 */
export interface ApiError {
  readonly code: string;
  readonly message: string;
}

export function parseApiError(body: unknown): ApiError | null {
  if (typeof body !== "object" || body === null) return null;
  const { error } = body as { error?: unknown };
  if (typeof error !== "object" || error === null) return null;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code !== "string" || code === "") return null;
  if (typeof message !== "string" || message === "") return null;
  return { code, message };
}

/** The single 403 body: authenticated, but not a reviewer. */
export const FORBIDDEN_RESULT: ApiResult = {
  status: 403,
  body: { error: { code: "forbidden", message: "reviewer access required" } },
};
