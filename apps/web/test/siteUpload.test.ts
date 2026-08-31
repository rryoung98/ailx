// @vitest-environment jsdom
/**
 * T1 live-site upload — client side, through programmable fetch/storage
 * doubles (the persistence.test.ts pattern).
 *
 * MOVED, not deleted: the assertions that fed `buildSiteZip` output through
 * the REAL server validator (`readZip` / `snapshotFromZip`) now live in the
 * private repo, as `packages/backend/test/t1-zip-roundtrip.test.ts`. The
 * validator is server code and no longer exists here, and a round trip needs
 * BOTH ends: the writer is `writeStoredZip` in `@ailx/core`, which is a shared
 * package vendored into that repo and compared byte for byte in CI, so the
 * test asserts the same two implementations it always did — just from the side
 * that can see the reader. `buildSiteZip` is a re-export of that writer
 * (lib/siteUpload.ts), so nothing about the browser's bytes is untested.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { T1_LIMITS } from "@ailx/contract";
import {
  DIRECT_UPLOAD_MIN_BYTES,
  PLATFORM_TOO_LARGE_MESSAGE,
  T1_SITE_SEQ,
  buildSiteZip,
  clearSiteSubmission,
  loadSiteSubmission,
  submitT1Site,
  uploadSiteZip,
  type SiteUploadResult,
} from "../lib/siteUpload";

/** The Blob SDK is a network client: mocked, never reached. */
const blobPut = vi.fn(async () => ({ pathname: "staged" }));
vi.mock("@vercel/blob/client", () => ({ put: (...args: unknown[]) => blobPut(...(args as [])) }));

const enc = new TextEncoder();
const utf8 = (s: string) => enc.encode(s);

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    _map: map,
  };
}

interface Call {
  path: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

/** Programmable fetch double for the raw-ZIP upload endpoint. */
function fakeUploadServer(digest = `sha256:${"a".repeat(64)}`) {
  const calls: Call[] = [];
  const state = {
    failNext: 0,
    /** Next response override: [status, body]. */
    respond: null as [number, unknown] | null,
  };
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    calls.push({
      path: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body as Uint8Array,
    });
    if (state.failNext > 0) {
      state.failNext--;
      throw new Error("network down");
    }
    const [status, body] = state.respond ?? [
      201,
      { submission: { digest, created: true, fileCount: 1, totalBytes: 1, path: `/api/site/${digest}/index.html` } },
    ];
    state.respond = null;
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }) as typeof fetch;
  return { fetchFn, calls, state };
}

const ATTEMPT = "att-local-1";
const SERVER_ID = "00000000-0000-4000-8000-0000000000aa";

/** Sync bookkeeping as the persistence mirror writes it. */
function mirroredStorage() {
  const storage = fakeStorage();
  storage.setItem(
    `ailx:sync:v1:${ATTEMPT}`,
    JSON.stringify({ serverAttemptId: SERVER_ID, syncedThrough: 1, finalized: false }),
  );
  return storage;
}

const upload = (
  storage: ReturnType<typeof fakeStorage>,
  server: ReturnType<typeof fakeUploadServer>,
  zip: Uint8Array = buildSiteZip([{ path: "index.html", data: utf8("<h1>hi</h1>") }]),
): Promise<SiteUploadResult> =>
  uploadSiteZip(storage, { baseUrl: "/api", siteRoot: "/api", fetchFn: server.fetchFn }, ATTEMPT, zip);

// ---------------------------------------------------------------------------
// buildSiteZip round-trip: see the header — it moved to the private repo with
// the validator it round-trips through.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// uploadSiteZip — success + every failure path.
// ---------------------------------------------------------------------------

describe("uploadSiteZip", () => {
  it("posts the raw ZIP with seq, dev identity and client timestamp, and records the live URL", async () => {
    const storage = mirroredStorage();
    const server = fakeUploadServer();
    const zip = buildSiteZip([{ path: "index.html", data: utf8("<h1>hi</h1>") }]);
    const r = await upload(storage, server, zip);
    expect(r).toMatchObject({ ok: true, digest: `sha256:${"a".repeat(64)}`, created: true });
    if (!r.ok) throw new Error("unreachable");
    expect(r.url).toBe(`/api/site/sha256:${"a".repeat(64)}/index.html`);

    expect(server.calls).toHaveLength(1);
    expect(server.calls[0].path).toBe(`/api/attempts/${SERVER_ID}/site?seq=${T1_SITE_SEQ}`);
    expect(server.calls[0].body).toBe(zip); // raw bytes, not JSON
    expect(server.calls[0].headers["content-type"]).toBe("application/zip");
    expect(server.calls[0].headers["x-ailx-dev-user"]).toMatch(/^web-/);
    expect(new Date(server.calls[0].headers["x-ailx-client-ts"]).getTime()).not.toBeNaN();

    expect(loadSiteSubmission(storage, ATTEMPT)).toEqual({
      digest: `sha256:${"a".repeat(64)}`,
      url: `/api/site/sha256:${"a".repeat(64)}/index.html`,
    });
  });

  it("canonicalises a legacy trailing-slash URL recorded before the index.html fix", () => {
    const storage = mirroredStorage();
    const digest = `sha256:${"c".repeat(64)}`;
    storage.setItem(`ailx:site:v1:${ATTEMPT}`, JSON.stringify({ digest, url: `/api/site/${digest}/` }));
    // The old form now redirects (Next strips the slash); the report page must
    // link straight at the served file.
    expect(loadSiteSubmission(storage, ATTEMPT)).toEqual({ digest, url: `/api/site/${digest}/index.html` });
  });

  it("treats an idempotent 200 replay as success", async () => {
    const storage = mirroredStorage();
    const server = fakeUploadServer();
    server.state.respond = [200, { submission: { digest: `sha256:${"b".repeat(64)}`, created: false } }];
    const r = await upload(storage, server);
    expect(r).toMatchObject({ ok: true, created: false });
  });

  it("409 divergent resubmit → conflict with the server's explanation", async () => {
    const storage = mirroredStorage();
    const server = fakeUploadServer();
    server.state.respond = [409, { error: { code: "already_submitted", message: "attempt already has a site submission — submissions are append-only" } }];
    const r = await upload(storage, server);
    expect(r).toEqual({
      ok: false,
      kind: "conflict",
      message: "attempt already has a site submission — submissions are append-only",
    });
    expect(loadSiteSubmission(storage, ATTEMPT)).toBeNull();
  });

  it.each([
    [400, "bad_zip", "end-of-central-directory record not found — not a ZIP archive"],
    [413, "total_too_large", "total uncompressed size exceeds 26214400 bytes"],
  ])("%i validator rejection → rejected, surfacing the validator message", async (status, code, message) => {
    const storage = mirroredStorage();
    const server = fakeUploadServer();
    server.state.respond = [status, { error: { code, message } }];
    const r = await upload(storage, server);
    expect(r).toEqual({ ok: false, kind: "rejected", message });
  });

  // Vercel rejects an oversized body before our handler runs, with a
  // plain-text "Request Entity Too Large" instead of our JSON envelope. The
  // participant must learn WHY, not just "HTTP 413".
  it("platform 413 (non-JSON body) → rejected, with the upload-limit explanation", async () => {
    const storage = mirroredStorage();
    const server = fakeUploadServer();
    server.state.respond = [413, "Request Entity Too Large\n\nFUNCTION_PAYLOAD_TOO_LARGE"];
    const r = await upload(storage, server);
    expect(r).toEqual({ ok: false, kind: "rejected", message: PLATFORM_TOO_LARGE_MESSAGE });
    expect(loadSiteSubmission(storage, ATTEMPT)).toBeNull();
  });

  it("network failure → unavailable, nothing recorded, and a retry succeeds", async () => {
    const storage = mirroredStorage();
    const server = fakeUploadServer();
    server.state.failNext = 1;
    const first = await upload(storage, server);
    expect(first).toMatchObject({ ok: false, kind: "unavailable" });
    expect(loadSiteSubmission(storage, ATTEMPT)).toBeNull();

    const retry = await upload(storage, server);
    expect(retry).toMatchObject({ ok: true });
    expect(loadSiteSubmission(storage, ATTEMPT)).not.toBeNull();
  });

  it("5xx → unavailable (retryable), not a terminal rejection", async () => {
    const storage = mirroredStorage();
    const server = fakeUploadServer();
    server.state.respond = [503, "backend restarting"];
    const r = await upload(storage, server);
    expect(r).toMatchObject({ ok: false, kind: "unavailable", message: "Upload failed (HTTP 503)." });
  });

  it("no mirrored server attempt yet → unavailable without touching the network", async () => {
    const storage = fakeStorage(); // no sync bookkeeping at all
    const server = fakeUploadServer();
    const r = await upload(storage, server);
    expect(r).toMatchObject({ ok: false, kind: "unavailable" });
    expect(server.calls).toEqual([]);
  });

  it("malformed success body → unavailable instead of a dead link", async () => {
    const storage = mirroredStorage();
    const server = fakeUploadServer();
    server.state.respond = [201, { submission: {} }];
    const r = await upload(storage, server);
    expect(r).toMatchObject({ ok: false, kind: "unavailable" });
    expect(loadSiteSubmission(storage, ATTEMPT)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------
// Client-direct upload — the path a 25 MB site must take, because
// a serverless request body caps out at ~4.5 MB (DEPLOY.md §5.1).
// ---------------------------------------------------------------

interface DirectServerState {
  /** Ticket endpoint response: [status, body]. */
  ticket: [number, unknown];
  /** Finalize endpoint response: [status, body]. */
  finalize: [number, unknown];
}

const DIGEST = `sha256:${"d".repeat(64)}`;

/** Programmable fetch double routing the two direct-upload endpoints. */
function fakeDirectServer() {
  const calls: Call[] = [];
  const state: DirectServerState = {
    ticket: [
      201,
      {
        upload: {
          uploadId: "f".repeat(32),
          pathname: `uploads/${SERVER_ID}/${"f".repeat(32)}.zip`,
          token: "vercel_blob_client_scoped",
          contentType: "application/zip",
          maxBytes: T1_LIMITS.maxTotalBytes,
        },
      },
    ],
    finalize: [201, { submission: { digest: DIGEST, created: true } }],
  };
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    const path = String(url);
    calls.push({
      path,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body as Uint8Array,
    });
    const [status, body] = path.endsWith("/upload-ticket")
      ? state.ticket
      : path.endsWith("/finalize")
        ? state.finalize
        : [201, { submission: { digest: DIGEST, created: true } }];
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }) as typeof fetch;
  return { fetchFn, calls, state };
}

/** A ZIP over the platform request cap — the whole reason this path exists. */
function oversizeZip(): Uint8Array<ArrayBuffer> {
  const zip = buildSiteZip([
    { path: "index.html", data: utf8("<h1>big</h1>") },
    { path: "assets/photo.png", data: new Uint8Array(DIRECT_UPLOAD_MIN_BYTES).fill(7) },
  ]);
  expect(zip.length).toBeGreaterThanOrEqual(DIRECT_UPLOAD_MIN_BYTES);
  return zip;
}

describe("uploadSiteZip — large sites", () => {
  afterEach(() => blobPut.mockClear());

  it("tickets, PUTs to the object store, then finalizes by uploadId", async () => {
    const storage = mirroredStorage();
    const server = fakeDirectServer();
    const zip = oversizeZip();
    const r = await uploadSiteZip(storage, { baseUrl: "/api", siteRoot: "/api", fetchFn: server.fetchFn }, ATTEMPT, zip);
    expect(r).toMatchObject({ ok: true, digest: DIGEST, created: true });

    expect(server.calls.map((c) => c.path)).toEqual([
      `/api/attempts/${SERVER_ID}/site/upload-ticket`,
      `/api/attempts/${SERVER_ID}/site/finalize`,
    ]);
    // The bytes never went through our function.
    expect(server.calls.every((c) => !(c.body instanceof Uint8Array))).toBe(true);

    // The PUT used the server's key and the server's scoped token —
    // the client chooses neither.
    expect(blobPut).toHaveBeenCalledTimes(1);
    const [pathname, , opts] = blobPut.mock.calls[0] as unknown as [string, unknown, Record<string, unknown>];
    expect(pathname).toBe(`uploads/${SERVER_ID}/${"f".repeat(32)}.zip`);
    expect(opts).toMatchObject({ token: "vercel_blob_client_scoped", access: "private" });

    // Finalize names the upload, never a digest.
    const body = JSON.parse(String(server.calls[1].body)) as Record<string, unknown>;
    expect(body).toEqual({ uploadId: "f".repeat(32), seq: T1_SITE_SEQ });
    expect(server.calls[1].headers["x-ailx-dev-user"]).toMatch(/^web-/);

    expect(loadSiteSubmission(storage, ATTEMPT)).toEqual({
      digest: DIGEST,
      url: `/api/site/${DIGEST}/index.html`,
    });
  });

  it("small sites keep the single POST — no ticket, no object store", async () => {
    const storage = mirroredStorage();
    const server = fakeDirectServer();
    const zip = buildSiteZip([{ path: "index.html", data: utf8("<h1>small</h1>") }]);
    expect(zip.length).toBeLessThan(DIRECT_UPLOAD_MIN_BYTES);
    const r = await uploadSiteZip(storage, { baseUrl: "/api", siteRoot: "/api", fetchFn: server.fetchFn }, ATTEMPT, zip);
    expect(r).toMatchObject({ ok: true });
    expect(server.calls.map((c) => c.path)).toEqual([`/api/attempts/${SERVER_ID}/site?seq=${T1_SITE_SEQ}`]);
    expect(blobPut).not.toHaveBeenCalled();
  });

  it("no direct target (501, or an older deployment's 404) falls back to the POST", async () => {
    for (const status of [501, 404, 401]) {
      const storage = mirroredStorage();
      const server = fakeDirectServer();
      server.state.ticket = [status, { error: { code: "direct_upload_unavailable", message: "no" } }];
      const r = await uploadSiteZip(storage, { baseUrl: "/api", siteRoot: "/api", fetchFn: server.fetchFn }, ATTEMPT, oversizeZip());
      expect(r).toMatchObject({ ok: true });
      expect(server.calls.map((c) => c.path)).toEqual([
        `/api/attempts/${SERVER_ID}/site/upload-ticket`,
        `/api/attempts/${SERVER_ID}/site?seq=${T1_SITE_SEQ}`,
      ]);
      expect(blobPut).not.toHaveBeenCalled();
    }
  });

  it("a refused or failed PUT is unavailable, and never finalizes", async () => {
    const storage = mirroredStorage();
    const server = fakeDirectServer();
    blobPut.mockRejectedValueOnce(new Error("content type not allowed"));
    const r = await uploadSiteZip(storage, { baseUrl: "/api", siteRoot: "/api", fetchFn: server.fetchFn }, ATTEMPT, oversizeZip());
    expect(r).toMatchObject({ ok: false, kind: "unavailable" });
    expect(server.calls.map((c) => c.path)).toEqual([`/api/attempts/${SERVER_ID}/site/upload-ticket`]);
    expect(loadSiteSubmission(storage, ATTEMPT)).toBeNull();
  });

  it("surfaces a finalize rejection exactly as the POST path does", async () => {
    const storage = mirroredStorage();
    const server = fakeDirectServer();
    server.state.finalize = [413, { error: { code: "total_too_large", message: "too big" } }];
    const r = await uploadSiteZip(storage, { baseUrl: "/api", siteRoot: "/api", fetchFn: server.fetchFn }, ATTEMPT, oversizeZip());
    expect(r).toEqual({ ok: false, kind: "rejected", message: "too big" });
    expect(loadSiteSubmission(storage, ATTEMPT)).toBeNull();
  });

  it("a malformed ticket is treated as no ticket", async () => {
    const storage = mirroredStorage();
    const server = fakeDirectServer();
    server.state.ticket = [201, { upload: { uploadId: 7 } }];
    const r = await uploadSiteZip(storage, { baseUrl: "/api", siteRoot: "/api", fetchFn: server.fetchFn }, ATTEMPT, oversizeZip());
    expect(r).toMatchObject({ ok: true });
    expect(blobPut).not.toHaveBeenCalled();
    expect(server.calls[1].path).toBe(`/api/attempts/${SERVER_ID}/site?seq=${T1_SITE_SEQ}`);
  });
});

// Submission bookkeeping
// ---------------------------------------------------------------------------

describe("site submission record", () => {
  it("clearSiteSubmission removes the record; corrupt records read as absent", () => {
    const storage = fakeStorage();
    storage.setItem(`ailx:site:v1:${ATTEMPT}`, JSON.stringify({ digest: "d", url: "u" }));
    expect(loadSiteSubmission(storage, ATTEMPT)).toEqual({ digest: "d", url: "u" });
    clearSiteSubmission(storage, ATTEMPT);
    expect(loadSiteSubmission(storage, ATTEMPT)).toBeNull();

    storage.setItem(`ailx:site:v1:${ATTEMPT}`, "{corrupt");
    expect(loadSiteSubmission(storage, ATTEMPT)).toBeNull();
    storage.setItem(`ailx:site:v1:${ATTEMPT}`, JSON.stringify({ digest: 1 }));
    expect(loadSiteSubmission(storage, ATTEMPT)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// submitT1Site — mode gating.
// ---------------------------------------------------------------------------

describe("submitT1Site", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns null outside server mode — static showcase behaviour unchanged", () => {
    expect(submitT1Site(ATTEMPT, { html: "<h1>hi</h1>" })).toBeNull();
  });

  it("returns null in server mode when there is no document to serve", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    expect(submitT1Site(ATTEMPT, { html: "" })).toBeNull();
    expect(submitT1Site(ATTEMPT, { html: "   " })).toBeNull();
    expect(submitT1Site(ATTEMPT, {})).toBeNull();
    expect(submitT1Site(ATTEMPT, null)).toBeNull();
    expect(submitT1Site(ATTEMPT, "not an artifact")).toBeNull();
  });

  it("in server mode uploads the artifact HTML as index.html after the mirror settles", async () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    // jsdom's window.localStorage is unavailable here (runStart.test.tsx
    // replaces it the same way) — install a memory-backed double.
    const mem = fakeStorage();
    Object.defineProperty(window, "localStorage", { value: mem, configurable: true });
    window.localStorage.setItem(
      `ailx:sync:v1:${ATTEMPT}`,
      JSON.stringify({ serverAttemptId: SERVER_ID, syncedThrough: 1, finalized: false }),
    );
    const server = fakeUploadServer();
    vi.stubGlobal("fetch", server.fetchFn);
    Object.defineProperty(window, "fetch", { value: server.fetchFn, configurable: true });
    try {
      const r = await submitT1Site(ATTEMPT, { html: "<h1>site</h1>", promptLog: [], selfReport: "" });
      expect(r).toMatchObject({ ok: true });
      expect(server.calls).toHaveLength(1);
      // The BODY is what this test owns: that submitT1Site sent a ZIP built
      // from the candidate's html. Its readability by the server validator is
      // the private repo's round-trip test; here we assert the bytes are a
      // real archive carrying that content.
      const body = server.calls[0].body as Uint8Array;
      expect(body.slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b])); // "PK"
      expect(body).toEqual(buildSiteZip([{ path: "index.html", data: utf8("<h1>site</h1>") }]));
    } finally {
      vi.unstubAllGlobals();
      window.localStorage.removeItem(`ailx:sync:v1:${ATTEMPT}`);
    }
  });
});
