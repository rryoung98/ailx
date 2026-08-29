import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeReq, makeRes } from "./helpers.js";

const PROD = "https://rryoung98.github.io";
const blob = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock("@vercel/blob", () => blob);

let handler;
beforeEach(async () => {
  vi.resetModules();
  blob.put.mockReset().mockResolvedValue({ url: "u" });
  ({ default: handler } = await import("../api/gallery/vote.js"));
});

const post = (body, ip = "1.2.3.4") => makeReq({ method: "POST", origin: PROD, ip, body });

describe("vote handler", () => {
  it("204s OPTIONS and 405s GET", async () => {
    let res = makeRes();
    await handler(makeReq({ method: "OPTIONS", origin: PROD }), res);
    expect(res.statusCode).toBe(204);
    res = makeRes();
    await handler(makeReq({ method: "GET", origin: PROD }), res);
    expect(res.statusCode).toBe(405);
  });

  it.each([
    [undefined],
    [null],
    [42],
    [{ toString: () => "abcdef" }],   // non-string
    ["short"],                        // < 6 chars
    ["x".repeat(41)],                 // > 40 chars
    ["UPPERCASE1"],
    ["has space1"],
    ["../../../etc"],                 // path traversal chars rejected by charset
    ["id.with.dots"],
  ])("rejects bad id %j with 400 and writes nothing", async (id) => {
    const res = makeRes();
    await handler(post({ id }), res);
    expect(res.statusCode).toBe(400);
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("accepts a valid id and writes an idempotent per-voter blob", async () => {
    const res = makeRes();
    await handler(post({ id: "abc-123" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const [path, payload, opts] = blob.put.mock.calls[0];
    expect(path).toMatch(/^gallery\/votes\/abc-123-vote-[0-9a-f]{12}\.json$/);
    expect(payload).toBe("1");
    expect(opts).toMatchObject({ addRandomSuffix: false, allowOverwrite: true });
  });

  it("derives the same voter hash for the same IP (idempotent re-vote path)", async () => {
    await handler(post({ id: "abc-123" }, "5.5.5.5"), makeRes());
    await handler(post({ id: "abc-123" }, "5.5.5.5"), makeRes());
    expect(blob.put.mock.calls[0][0]).toBe(blob.put.mock.calls[1][0]);
  });

  it("derives different voter hashes for different IPs, without leaking the IP", async () => {
    await handler(post({ id: "abc-123" }, "5.5.5.5"), makeRes());
    await handler(post({ id: "abc-123" }, "6.6.6.6"), makeRes());
    expect(blob.put.mock.calls[0][0]).not.toBe(blob.put.mock.calls[1][0]);
    expect(blob.put.mock.calls[0][0]).not.toContain("5.5.5.5");
  });

  it("handles a missing body", async () => {
    const res = makeRes();
    await handler(post(undefined), res);
    expect(res.statusCode).toBe(400);
  });
});
