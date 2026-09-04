/**
 * Vote round trip: the vote handler and the listing handler over ONE store.
 *
 * TEN-131. Every existing test mocks `put` and asserts the 200 body, so a
 * vote that is acknowledged and not readable back would pass all of them.
 * These drive both handlers against a shared in-memory blob store, so a
 * write/read key mismatch, or an acknowledgement the next GET contradicts,
 * fails here.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeReq, makeRes } from "./helpers.js";

const PROD = "https://rryoung98.github.io";

// One store, shared by both handlers, keyed by pathname like the real one.
const store = vi.hoisted(() => new Map());
const blob = vi.hoisted(() => ({ put: vi.fn(), list: vi.fn() }));
vi.mock("@vercel/blob", () => blob);

let vote;
let gallery;

beforeEach(async () => {
  vi.resetModules();
  store.clear();
  blob.put.mockReset().mockImplementation(async (pathname, body, opts) => {
    if (store.has(pathname) && !opts?.allowOverwrite) throw new Error("blob already exists");
    store.set(pathname, body);
    return { url: `https://blob.test/${pathname}`, pathname };
  });
  blob.list.mockReset().mockImplementation(async ({ prefix }) => ({
    blobs: [...store.keys()]
      .filter((p) => p.startsWith(prefix))
      .map((p) => ({ pathname: p, url: `https://blob.test/${p}` })),
    hasMore: false,
  }));
  ({ default: vote } = await import("../api/gallery/vote.js"));
  ({ default: gallery } = await import("../api/gallery/index.js"));
});

const ID = "27a1v4ft6-iyvpns"; // the shape the listing handler mints

function seedSubmission(id = ID) {
  store.set(`gallery/subs/${id}.json`, JSON.stringify({ id }));
}

async function castVote(ip, id = ID) {
  const res = makeRes();
  await vote(makeReq({ method: "POST", origin: PROD, ip, body: { id } }), res);
  return res;
}

async function readWall() {
  const res = makeRes();
  await gallery(makeReq({ method: "GET", origin: PROD, ip: "9.9.9.9" }), res);
  return res.body.items;
}

describe("a vote that returns 200 is readable back", () => {
  it("counts a stored vote on the very next listing", async () => {
    seedSubmission();
    expect((await readWall())[0].votes).toBe(0);
    const res = await castVote("1.1.1.1");
    expect(res.statusCode).toBe(200);
    expect((await readWall())[0].votes).toBe(1);
  });

  it("answers with the count the next listing will report", async () => {
    seedSubmission();
    await castVote("1.1.1.1");
    const res = await castVote("2.2.2.2");
    // The acknowledgement is the fix for TEN-131: `{ok:true}` alone let the
    // page show a vote the next load contradicted.
    expect(res.body.votes).toBe(2);
    expect((await readWall())[0].votes).toBe(2);
  });

  it("reports the unchanged count when the same IP votes twice", async () => {
    seedSubmission();
    const first = await castVote("1.1.1.1");
    const second = await castVote("1.1.1.1");
    expect(first.body.votes).toBe(1);
    expect(second.body.votes).toBe(1); // one vote per IP, and it says so
    expect((await readWall())[0].votes).toBe(1);
    expect([...store.keys()].filter((k) => k.startsWith("gallery/votes/"))).toHaveLength(1);
  });

  it("counts many distinct voters exactly", async () => {
    seedSubmission();
    for (let i = 0; i < 21; i++) await castVote(`10.0.0.${i}`);
    expect((await readWall())[0].votes).toBe(21);
  });

  it("counts the write even when the listing has not caught up with it", async () => {
    // Read-after-write on the blob store is not promised. The handler knows
    // its own vote is stored, so it must never answer with a count that
    // omits it.
    seedSubmission();
    await castVote("1.1.1.1");
    blob.list.mockImplementation(async () => ({ blobs: [], hasMore: false }));
    const res = await castVote("2.2.2.2");
    expect(res.body.votes).toBe(1);
  });

  it("keeps one submission's votes out of another's count", async () => {
    seedSubmission("aaa111a");
    seedSubmission("bbb222b");
    await castVote("1.1.1.1", "aaa111a");
    await castVote("2.2.2.2", "aaa111a");
    const res = await castVote("1.1.1.1", "bbb222b");
    expect(res.body.votes).toBe(1);
    const items = await readWall();
    expect(Object.fromEntries(items.map((i) => [i.id, i.votes]))).toEqual({ aaa111a: 2, bbb222b: 1 });
  });
});
