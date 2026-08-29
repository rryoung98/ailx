/**
 * apiRoute — the server-mode adapter. These tests pin the two security
 * properties the adapter (not the handlers) is responsible for: the caller is
 * authenticated BEFORE any request byte is buffered, and the body read is
 * capped mid-stream so an oversized upload is never fully held in memory.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// pg must never really connect: these tests exercise the adapter, not Postgres.
const released = { count: 0 };
const fakeClient = {
  query: vi.fn(),
  release: () => {
    released.count += 1;
  },
};
vi.mock("pg", () => ({
  Pool: class {
    async connect() {
      return fakeClient;
    }
  },
}));

const CHUNK = 1024 * 1024;

/** A body stream that reports how many chunks were actually pulled/cancelled. */
function countingBody(chunks: number, chunkBytes = CHUNK) {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled >= chunks) {
        controller.close();
        return;
      }
      state.pulled += 1;
      controller.enqueue(new Uint8Array(chunkBytes));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

function streamRequest(
  body: ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/api/attempts/a/site", {
    method: "POST",
    headers,
    body,
    // Node requires an explicit duplex for a streaming request body.
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

const DEV_HEADERS = { "x-ailx-dev-user": "alice" };

/** Constructing a Request primes the source stream; settle that first so a
 *  pulled-chunk assertion measures the ADAPTER, not Request construction. */
async function settled<T>(value: T): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 5));
  return value;
}

async function load() {
  vi.resetModules();
  return import("../lib/server/api");
}

const ok = vi.fn(async () => ({ status: 200, body: { ok: true } }));

beforeEach(() => {
  released.count = 0;
  ok.mockClear();
  vi.stubEnv("AILX_AUTH", "dev");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DATABASE_URL", "postgres://test/test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("apiRoute authentication ordering", () => {
  it("rejects an anonymous oversized upload WITHOUT reading the body", async () => {
    const { apiRoute } = await load();
    const { stream, state } = countingBody(1000);
    const req = await settled(streamRequest(stream));
    const primed = state.pulled; // baseline the adapter must not add to
    const res = await apiRoute(req, ok, { rawBody: true });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "unauthorized", message: "authentication required" },
    });
    // The point: the adapter buffered nothing for an unauthenticated caller.
    expect(state.pulled).toBe(primed);
    expect(primed).toBeLessThanOrEqual(1);
    expect(ok).not.toHaveBeenCalled();
    expect(released.count).toBe(0); // no DB client checked out either
  });

  it("rejects a bad dev identity rather than falling through to the handler", async () => {
    const { apiRoute } = await load();
    const { stream } = countingBody(1);
    const res = await apiRoute(streamRequest(stream, { "x-ailx-dev-user": "not valid" }), ok, {
      rawBody: true,
    });
    expect(res.status).toBe(401);
    expect(ok).not.toHaveBeenCalled();
  });

  it("hands the handler the already-verified identity (no second verify)", async () => {
    const { apiRoute } = await load();
    let seen: string | null = null;
    const res = await apiRoute(
      new Request("http://localhost/api/attempts/a", { headers: DEV_HEADERS }),
      async (ctx) => {
        // Even with no headers at all the identity resolved by the adapter stands.
        seen = (await ctx.auth.verify({}))?.authRef ?? null;
        return { status: 200, body: { ok: true } };
      },
    );
    expect(res.status).toBe(200);
    expect(seen).toBe("dev:alice");
    expect(released.count).toBe(1);
  });

  it("fails closed (500, no handler) when AILX_AUTH is unset", async () => {
    vi.stubEnv("AILX_AUTH", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { apiRoute } = await load();
    const res = await apiRoute(new Request("http://localhost/api/attempts", { headers: DEV_HEADERS }), ok);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "internal", message: "internal server error" },
    });
    expect(ok).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });
});

describe("apiRoute body cap", () => {
  it("short-circuits an oversized raw body mid-stream instead of buffering it", async () => {
    const { apiRoute, MAX_RAW_BODY_BYTES } = await load();
    const total = Math.ceil(MAX_RAW_BODY_BYTES / CHUNK) + 100; // 100 MB if fully read
    const { stream, state } = countingBody(total);

    const res = await apiRoute(streamRequest(stream, DEV_HEADERS), ok, { rawBody: true });

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: { code: "payload_too_large", message: "request body is too large" },
    });
    expect(ok).not.toHaveBeenCalled();
    // The cap must bite DURING the read: only just past the cap was pulled,
    // and the producer was cancelled. A status-only assertion would pass even
    // if we had buffered all 100 MB first.
    expect(state.pulled).toBeLessThanOrEqual(Math.ceil(MAX_RAW_BODY_BYTES / CHUNK) + 2);
    expect(state.pulled).toBeLessThan(total);
    expect(state.cancelled).toBe(true);
  });

  it("caps a JSON body far below the raw-upload cap", async () => {
    const { apiRoute, MAX_JSON_BODY_BYTES, MAX_RAW_BODY_BYTES } = await load();
    expect(MAX_JSON_BODY_BYTES).toBeLessThan(MAX_RAW_BODY_BYTES);
    const total = Math.ceil(MAX_JSON_BODY_BYTES / CHUNK) + 50;
    const { stream, state } = countingBody(total);

    const res = await apiRoute(streamRequest(stream, DEV_HEADERS), ok);

    expect(res.status).toBe(413);
    expect(state.pulled).toBeLessThan(total);
    expect(state.cancelled).toBe(true);
  });

  it("refuses an honest oversized content-length without reading anything", async () => {
    const { apiRoute, MAX_RAW_BODY_BYTES } = await load();
    const { stream, state } = countingBody(1);
    const req = await settled(
      streamRequest(stream, { ...DEV_HEADERS, "content-length": String(MAX_RAW_BODY_BYTES + 1) }),
    );
    const primed = state.pulled;
    const res = await apiRoute(req, ok, { rawBody: true });
    expect(res.status).toBe(413);
    // An honest oversized header is refused before the adapter reads at all.
    expect(state.pulled).toBe(primed);
    expect(ok).not.toHaveBeenCalled();
  });

  it("still caps a body whose content-length LIES about being small", async () => {
    const { apiRoute, MAX_RAW_BODY_BYTES } = await load();
    const total = Math.ceil(MAX_RAW_BODY_BYTES / CHUNK) + 20;
    const { stream, state } = countingBody(total);
    const res = await apiRoute(
      streamRequest(stream, { ...DEV_HEADERS, "content-length": "10" }),
      ok,
      { rawBody: true },
    );
    expect(res.status).toBe(413);
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBeLessThan(total);
  });

  it("ignores a garbage content-length and falls back to the streaming cap", async () => {
    const { apiRoute, MAX_RAW_BODY_BYTES } = await load();
    const total = Math.ceil(MAX_RAW_BODY_BYTES / CHUNK) + 20;
    const { stream } = countingBody(total);
    const res = await apiRoute(
      streamRequest(stream, { ...DEV_HEADERS, "content-length": "not-a-number" }),
      ok,
      { rawBody: true },
    );
    expect(res.status).toBe(413);
  });
});

describe("apiRoute normal traffic", () => {
  it("passes raw bytes through under the cap", async () => {
    const { apiRoute } = await load();
    const zip = new Uint8Array([80, 75, 3, 4, 1, 2, 3]);
    let seen: unknown;
    const res = await apiRoute(
      new Request("http://localhost/api/attempts/a/site", {
        method: "POST",
        headers: DEV_HEADERS,
        body: zip,
      }),
      async (_ctx, _headers, body) => {
        seen = body;
        return { status: 201, body: { stored: true } };
      },
      { rawBody: true },
    );
    expect(res.status).toBe(201);
    expect(seen).toBeInstanceOf(Uint8Array);
    expect(Array.from(seen as Uint8Array)).toEqual(Array.from(zip));
  });

  it("parses a JSON body and lower-cases headers", async () => {
    const { apiRoute } = await load();
    let seenBody: unknown;
    let seenHeaders: Record<string, string | undefined> = {};
    const res = await apiRoute(
      new Request("http://localhost/api/attempts", {
        method: "POST",
        headers: { ...DEV_HEADERS, "X-Ailx-Client-Ts": "2026-01-01T00:00:00.000Z" },
        body: JSON.stringify({ track: "t2" }),
      }),
      async (_ctx, headers, body) => {
        seenBody = body;
        seenHeaders = { ...headers };
        return { status: 200, body: { ok: true } };
      },
    );
    expect(res.status).toBe(200);
    expect(seenBody).toEqual({ track: "t2" });
    expect(seenHeaders["x-ailx-client-ts"]).toBe("2026-01-01T00:00:00.000Z");
  });

  it("treats a non-JSON body as undefined (handlers validate)", async () => {
    const { apiRoute } = await load();
    let seen: unknown = "unset";
    await apiRoute(
      new Request("http://localhost/api/attempts", {
        method: "POST",
        headers: DEV_HEADERS,
        body: "not json",
      }),
      async (_ctx, _headers, body) => {
        seen = body;
        return { status: 200, body: {} };
      },
    );
    expect(seen).toBeUndefined();
  });

  it("never reads a body for GET and releases the client", async () => {
    const { apiRoute } = await load();
    let seen: unknown = "unset";
    const res = await apiRoute(
      new Request("http://localhost/api/attempts/a", { headers: DEV_HEADERS }),
      async (_ctx, _headers, body) => {
        seen = body;
        return { status: 200, body: { id: "a" } };
      },
    );
    expect(res.status).toBe(200);
    expect(seen).toBeUndefined();
    expect(released.count).toBe(1);
  });

it("releases the DB client when the handler throws, and hides the error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { apiRoute } = await load();
    const res = await apiRoute(
      new Request("http://localhost/api/attempts/a", { headers: DEV_HEADERS }),
      async () => {
        throw new Error("boom: secret connection string");
      },
    );
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
    expect(released.count).toBe(1);
    expect(error).toHaveBeenCalled();
  });
});

/**
 * Pool sizing is a serverless-correctness property: every warm instance keeps
 * its own pool, so the default must be small and an idle instance must be
 * able to exit rather than sit on a Postgres session.
 */
describe("poolConfig", () => {
  it("defaults to a small pool that can go idle and exit", async () => {
    const { poolConfig, DEFAULT_POOL_MAX } = await load();
    const cfg = poolConfig({ DATABASE_URL: "postgres://u@h/db" });
    expect(cfg.connectionString).toBe("postgres://u@h/db");
    expect(cfg.max).toBe(DEFAULT_POOL_MAX);
    expect(DEFAULT_POOL_MAX).toBeLessThanOrEqual(5);
    expect(cfg.allowExitOnIdle).toBe(true);
    expect(cfg.idleTimeoutMillis).toBeGreaterThan(0);
    expect(cfg.connectionTimeoutMillis).toBeGreaterThan(0);
  });

  it("honours AILX_PG_POOL_MAX and ignores nonsense", async () => {
    const { poolConfig, DEFAULT_POOL_MAX } = await load();
    const max = (v: string | undefined) =>
      poolConfig({ DATABASE_URL: "postgres://u@h/db", AILX_PG_POOL_MAX: v }).max;
    expect(max("1")).toBe(1);
    expect(max("12")).toBe(12);
    for (const bad of [undefined, "", "0", "-4", "2.5", "lots"]) {
      expect(max(bad)).toBe(DEFAULT_POOL_MAX);
    }
  });

  it("refuses to start without DATABASE_URL", async () => {
    const { poolConfig } = await load();
    expect(() => poolConfig({})).toThrow(/DATABASE_URL/);
  });
});
