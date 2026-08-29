import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeReq, makeRes } from "./helpers.js";

const PROD = "https://rryoung98.github.io";

const blob = vi.hoisted(() => ({ put: vi.fn(), list: vi.fn() }));
vi.mock("@vercel/blob", () => blob);

let handler;
let nextIp = 0;
const freshIp = () => `10.1.${Math.floor(nextIp / 256)}.${nextIp++ % 256}`;

beforeEach(async () => {
  vi.resetModules(); // fresh rate limiter per test
  blob.put.mockReset().mockImplementation(async (pathname) => ({ url: `https://blob.test/${pathname}`, pathname }));
  blob.list.mockReset().mockResolvedValue({ blobs: [], hasMore: false });
  ({ default: handler } = await import("../api/gallery/index.js"));
});

const sub = (id) => ({ pathname: `gallery/subs/${id}.json`, url: `https://blob.test/gallery/subs/${id}.json` });
const voteBlob = (id, voter) => ({ pathname: `gallery/votes/${id}-vote-${voter}.json`, url: "u" });

// 1x1 transparent PNG
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function get(origin = PROD) { return makeReq({ method: "GET", origin, ip: freshIp() }); }
function post(body, ip = freshIp()) { return makeReq({ method: "POST", origin: PROD, ip, body }); }

describe("method / CORS handling", () => {
  it("204s OPTIONS", async () => {
    const res = makeRes();
    await handler(makeReq({ method: "OPTIONS", origin: PROD }), res);
    expect(res.statusCode).toBe(204);
  });
  it("405s DELETE", async () => {
    const res = makeRes();
    await handler(makeReq({ method: "DELETE", origin: PROD }), res);
    expect(res.statusCode).toBe(405);
  });
  it("echoes allowed localhost origin", async () => {
    const res = makeRes();
    await handler(get("http://localhost:3199"), res);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3199");
  });
});

describe("GET listing", () => {
  it("returns submissions newest-first with vote counts", async () => {
    blob.list.mockImplementation(async ({ prefix }) => {
      if (prefix === "gallery/subs/") return { blobs: [sub("aaa111"), sub("zzz999")], hasMore: false };
      return { blobs: [voteBlob("zzz999", "v1"), voteBlob("zzz999", "v2"), voteBlob("aaa111", "v1")], hasMore: false };
    });
    const res = makeRes();
    await handler(get(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.items).toEqual([
      { id: "zzz999", url: sub("zzz999").url, votes: 2 },
      { id: "aaa111", url: sub("aaa111").url, votes: 1 },
    ]);
    expect(res.headers["cache-control"]).toContain("s-maxage=15");
  });

  it("caps the response at 60 items", async () => {
    const blobs = Array.from({ length: 80 }, (_, i) => sub(`id${String(i).padStart(3, "0")}`));
    blob.list.mockImplementation(async ({ prefix }) =>
      prefix === "gallery/subs/" ? { blobs, hasMore: false } : { blobs: [], hasMore: false });
    const res = makeRes();
    await handler(get(), res);
    expect(res.body.items).toHaveLength(60);
  });

  it("paginates votes past 1000 blobs via cursor (the silent-undercount bug)", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => voteBlob("hot123", `a${i}`));
    const page2 = Array.from({ length: 500 }, (_, i) => voteBlob("hot123", `b${i}`));
    blob.list.mockImplementation(async ({ prefix, cursor }) => {
      if (prefix === "gallery/subs/") return { blobs: [sub("hot123")], hasMore: false };
      if (!cursor) return { blobs: page1, hasMore: true, cursor: "c1" };
      expect(cursor).toBe("c1");
      return { blobs: page2, hasMore: false };
    });
    const res = makeRes();
    await handler(get(), res);
    expect(res.body.items[0].votes).toBe(1500);
  });

  it("paginates submissions too, and stops at the page hard cap", async () => {
    let calls = 0;
    blob.list.mockImplementation(async ({ prefix }) => {
      if (prefix === "gallery/votes/") return { blobs: [], hasMore: false };
      calls++;
      return { blobs: [sub(`p${calls}`)], hasMore: true, cursor: `c${calls}` }; // never-ending store
    });
    const res = makeRes();
    await handler(get(), res);
    expect(res.statusCode).toBe(200);
    expect(calls).toBe(25); // MAX_LIST_PAGES guard, no infinite loop
  });

  it("ignores malformed vote pathnames", async () => {
    blob.list.mockImplementation(async ({ prefix }) =>
      prefix === "gallery/subs/"
        ? { blobs: [sub("ok1234")], hasMore: false }
        : { blobs: [{ pathname: "gallery/votes/", url: "u" }], hasMore: false });
    const res = makeRes();
    await handler(get(), res);
    expect(res.body.items[0].votes).toBe(0);
  });
});

describe("POST validation", () => {
  it.each([
    [undefined, "no body"],
    [{}, "no images"],
    [{ images: [] }, "empty"],
    [{ images: [PNG, PNG, PNG, PNG] }, "too many"],
    [{ images: "not-an-array" }, "not array"],
  ])("rejects %j (%s) with 400 and writes nothing", async (body) => {
    const res = makeRes();
    await handler(post(body), res);
    expect(res.statusCode).toBe(400);
    expect(blob.put).not.toHaveBeenCalled();
  });

  it.each([
    ["not a data uri"],
    ["data:image/gif;base64,R0lGOD"],                 // gif not allowed
    ["data:image/png;base64,%%%invalid%%%"],
    ["data:text/html;base64,PGh0bWw+"],
    [null],
    [42],
  ])("rejects bad image %j with 400", async (img) => {
    const res = makeRes();
    await handler(post({ images: [img] }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("image 1");
  });

  it("rejects an oversized image with 413", async () => {
    const big = "data:image/png;base64," + "A".repeat(Math.ceil((450 * 1024 + 3) / 3) * 4);
    const res = makeRes();
    await handler(post({ images: [big] }), res);
    expect(res.statusCode).toBe(413);
  });

  it("names jpeg files .jpg and preserves png/webp extensions", async () => {
    const jpeg = "data:image/jpeg;base64,AAAA";
    const webp = "data:image/webp;base64,AAAA";
    const res = makeRes();
    await handler(post({ images: [jpeg, webp] }), res);
    expect(res.statusCode).toBe(201);
    const paths = blob.put.mock.calls.map(([p]) => p);
    expect(paths[0]).toMatch(/gallery\/img\/.+-0\.jpg$/);
    expect(paths[1]).toMatch(/gallery\/img\/.+-1\.webp$/);
  });

  it("stores the doc with truncated note/model and disclosure", async () => {
    const res = makeRes();
    await handler(post({ images: [PNG], note: "x".repeat(2000), model: "m".repeat(200) }), res);
    expect(res.statusCode).toBe(201);
    const docCall = blob.put.mock.calls.find(([p]) => p.startsWith("gallery/subs/"));
    const doc = JSON.parse(docCall[1]);
    expect(doc.note).toHaveLength(800);
    expect(doc.model).toHaveLength(80);
    expect(doc.disclosure).toContain("AI-generated");
    expect(doc.images).toHaveLength(1);
    expect(res.body.id).toBe(doc.id);
  });

  it("coerces a non-string note instead of crashing", async () => {
    const res = makeRes();
    await handler(post({ images: [PNG], note: { evil: true }, model: 42 }), res);
    expect(res.statusCode).toBe(201);
  });
});

describe("POST rate limiting", () => {
  it("allows 6 shares per IP per day, then 429", async () => {
    const ip = "7.7.7.7";
    for (let i = 0; i < 6; i++) {
      const res = makeRes();
      await handler(post({ images: [PNG] }, ip), res);
      expect(res.statusCode).toBe(201);
    }
    const res = makeRes();
    await handler(post({ images: [PNG] }, ip), res);
    expect(res.statusCode).toBe(429);
  });

  it("does not consume the quota on failed validation", async () => {
    const ip = "6.6.6.6";
    for (let i = 0; i < 20; i++) await handler(post({ images: [] }, ip), makeRes());
    const res = makeRes();
    await handler(post({ images: [PNG] }, ip), res);
    expect(res.statusCode).toBe(201);
  });
});
