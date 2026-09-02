/**
 * SPIKE (TEN-37) — can oRPC keep the refusal bodies this repo has frozen?
 *
 * `packages/contract/src/api.ts` freezes two bodies, and the exam service
 * emits those exact bytes for every refusal. A wire contract that forced a
 * different 401 body would be a wire-visible change to every protected
 * endpoint, so the ADR needs an answer rather than an assumption.
 *
 * The answer is yes: `OpenAPIHandler`'s `customErrorResponseBodyEncoder`
 * (@orpc/openapi 1.15.0) replaces the body oRPC would otherwise send. What
 * does NOT survive untouched is the `{ status, body }` envelope itself — a
 * handler stops returning it and throws an `ORPCError` instead — so the
 * private repo's `apiRoute` wrapper is rewritten, not deleted.
 */
import { describe, expect, it } from "vitest";
import { UNAUTHORIZED_RESULT } from "@ailx/contract";
import { ORPCError } from "@orpc/server";
import { implement } from "@orpc/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { galleryContract } from "../src/contract.js";

const os = implement(galleryContract);

const refusing = os.listGallery.handler(() => {
  throw new ORPCError("UNAUTHORIZED");
});

const handler = new OpenAPIHandler(os.router({ listGallery: refusing }), {
  customErrorResponseBodyEncoder: (error) =>
    error.status === UNAUTHORIZED_RESULT.status ? UNAUTHORIZED_RESULT.body : null,
});

describe("the frozen refusal body", () => {
  it("survives oRPC byte for byte", async () => {
    const { response } = await handler.handle(
      new Request("https://api.example.test/v1/gallery"),
      { prefix: "/v1" },
    );
    expect(response?.status).toBe(401);
    expect(await response?.text()).toBe(JSON.stringify(UNAUTHORIZED_RESULT.body));
  });
});
