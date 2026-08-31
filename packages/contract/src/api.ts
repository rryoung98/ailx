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

/** The single 403 body: authenticated, but not a reviewer. */
export const FORBIDDEN_RESULT: ApiResult = {
  status: 403,
  body: { error: { code: "forbidden", message: "reviewer access required" } },
};
