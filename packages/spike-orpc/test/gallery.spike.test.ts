/**
 * SPIKE (TEN-37) — does an oRPC contract actually do what the issue asks?
 *
 * The issue's failure is concrete: the browser called a route the deployed
 * service did not have. So these tests do not check that oRPC "works". They
 * check the three things that would have to be true for it to have PREVENTED
 * that failure, and one that shows what it still cannot prevent.
 *
 *  1. The client derives the URL from the contract, so the frontend cannot
 *     invent a path (assert the exact bytes of the request URL).
 *  2. An implementation that answers the wrong shape does not compile.
 *  3. A call to a procedure the contract does not declare does not compile.
 *  4. It is all COMPILE time, in ONE compilation. Two repos that build
 *     separately still only find out when someone compiles both.
 */
import { describe, expect, it } from "vitest";
import type { PublicGalleryEntry } from "@ailx/contract";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { implement } from "@orpc/server";
import { galleryContract, type PublicGalleryListing } from "../src/contract.js";
import { spikeGalleryClient } from "../src/client.js";

const TOKEN = "a".repeat(43);

/** A share payload is deep and comes from @ailx/report; the spike needs a body, not a fixture. */
const payload = { schema: 1 } as unknown as PublicGalleryEntry["payload"];

const entry: PublicGalleryEntry = {
  id: "9a2f0f8e-0000-4000-8000-000000000001",
  token: TOKEN,
  at: "2026-03-02T09:00:00.000Z",
  payload,
};

/** The FAKE exam service: the private repo's handler, reduced to its shape. */
const os = implement(galleryContract);

const listGallery = os.listGallery.handler(({ input }): { gallery: PublicGalleryListing } => ({
  gallery: {
    entries: [entry],
    total: 1,
    facets: [{ code: "MSVD", name: "Mapmaker", count: 1 }],
    query: {
      type: input.type ?? null,
      sort: input.sort,
      withSite: input.site === "1",
      limit: input.limit,
      offset: input.offset,
    },
  },
}));

const handler = new OpenAPIHandler(os.router({ listGallery }));

/** Every request the client makes, so a test can assert the URL it chose. */
const seen: string[] = [];

const client = spikeGalleryClient({
  url: "https://api.example.test/v1",
  fetch: async (request) => {
    seen.push(request.url);
    const { response } = await handler.handle(request, { prefix: "/v1" });
    return response ?? new Response("not found", { status: 404 });
  },
});

describe("an oRPC contract over GET /gallery", () => {
  it("spells the URL from the contract, not from the call site", async () => {
    seen.length = 0;
    await client.listGallery({ sort: "oldest", limit: 5, offset: 10 });
    expect(seen).toHaveLength(1);
    const url = new URL(seen[0]!);
    expect(url.pathname).toBe("/v1/gallery");
    expect(url.searchParams.get("sort")).toBe("oldest");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("offset")).toBe("10");
  });

  it("round-trips the listing through a real HTTP request and response", async () => {
    const result = await client.listGallery({ type: "MSVD" });
    expect(result.gallery.total).toBe(1);
    expect(result.gallery.entries[0]!.token).toBe(TOKEN);
    // The public read drops `approvedBy`, and the contract says so, so the
    // browser's type cannot claim a field the service never sends.
    expect("approvedBy" in result.gallery.entries[0]!).toBe(false);
    expect(result.gallery.query).toEqual({
      type: "MSVD",
      sort: "recent",
      withSite: false,
      limit: 24,
      offset: 0,
    });
  });

  it("applies the contract's caps and defaults on the SERVER side", async () => {
    // `parseGalleryQuery` clamps; the schema REJECTS. That is a behaviour
    // change, not a port: today `?limit=1e9` yields 48 and a 200, here it is
    // an input-validation error. Whichever we want, we must choose it.
    await expect(client.listGallery({ limit: 1_000_000_000 })).rejects.toThrow();
  });

  it("refuses a query value the contract does not allow", async () => {
    // @ts-expect-error "sideways" is not a GallerySort — caught at compile time.
    await expect(client.listGallery({ sort: "sideways" })).rejects.toThrow();
  });

  it("rejects an undeclared route at COMPILE time, and only then", async () => {
    // THE FAILURE THIS ISSUE IS ABOUT. `POST /attempts/:id/score` did not
    // exist on the deployed service; the browser called it anyway.
    //
    // TypeScript stops it: the line below needs `@ts-expect-error` to build.
    // The runtime does not stop it kindly — the client is a Proxy, so the
    // property exists, the call is made, and the failure is a thrown
    // "expect a contract procedure at scoreAttempt" with no HTTP request
    // behind it. Type-checking is the whole guarantee. A build that skips it
    // gets the same class of bug back.
    // @ts-expect-error the contract declares only `listGallery`.
    const call = client.scoreAttempt as () => Promise<unknown>;
    expect(typeof call).toBe("function");
    await expect(call()).rejects.toThrow(/expect a contract procedure/);
    expect(seen.some((u) => u.includes("scoreAttempt"))).toBe(false);
  });

  it("does not let an implementation answer the wrong shape", () => {
    os.listGallery.handler(
      // @ts-expect-error `gallery.total` is a number and `entries` is required.
      () => ({ gallery: { total: "one" } }),
    );
    expect(true).toBe(true);
  });
});
