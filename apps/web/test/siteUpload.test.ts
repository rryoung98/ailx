// @vitest-environment jsdom
/**
 * T1 live-site upload — client side. The ZIP writer is verified through the
 * REAL backend validator (readZip / snapshotFromZip), and the upload logic
 * through programmable fetch/storage doubles (persistence.test.ts pattern).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readZip, snapshotFromZip, T1_LIMITS } from "@ailx/backend/t1";
import {
  PLATFORM_TOO_LARGE_MESSAGE,
  T1_SITE_SEQ,
  buildSiteZip,
  clearSiteSubmission,
  loadSiteSubmission,
  submitT1Site,
  uploadSiteZip,
  type SiteUploadResult,
} from "../lib/siteUpload";

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
  uploadSiteZip(storage, { baseUrl: "/api", fetchFn: server.fetchFn }, ATTEMPT, zip);

// ---------------------------------------------------------------------------
// buildSiteZip — validated by the REAL server-side reader.
// ---------------------------------------------------------------------------

describe("buildSiteZip", () => {
  it("round-trips through the backend readZip validator (CRCs and sizes agree)", () => {
    const files = [
      { path: "index.html", data: utf8("<!doctype html><h1>hé — こんにちは</h1>") },
      { path: "assets/style.css", data: utf8("body{margin:0}") },
      { path: "empty.txt", data: new Uint8Array(0) },
    ];
    const entries = readZip(buildSiteZip(files), T1_LIMITS);
    expect(entries.map((e) => e.path)).toEqual(files.map((f) => f.path));
    for (let i = 0; i < files.length; i++) {
      // Array.from: cross-realm Uint8Arrays (jsdom vs node) defeat toEqual.
      expect(Array.from(entries[i].data)).toEqual(Array.from(files[i].data));
      expect(entries[i].isSymlink).toBe(false);
    }
  });

  it("passes the FULL snapshot pipeline and gets a stable content digest", () => {
    const files = [{ path: "index.html", data: utf8("<h1>site</h1>") }];
    const a = snapshotFromZip(buildSiteZip(files));
    const b = snapshotFromZip(buildSiteZip(files));
    // Deterministic bytes (zeroed timestamps) → same digest → an accidental
    // resubmit is an idempotent replay server-side, never a 409.
    expect(buildSiteZip(files)).toEqual(buildSiteZip(files));
    expect(a.digest).toBe(b.digest);
    expect(a.fileCount).toBe(1);
  });

  it("handles binary content byte-exactly", () => {
    const data = new Uint8Array(4096).map((_, i) => (i * 7 + 13) & 0xff);
    const [entry] = readZip(buildSiteZip([{ path: "img/raw.png", data }]), T1_LIMITS);
    expect(Array.from(entry.data)).toEqual(Array.from(data));
  });

  it("produces an empty-but-valid archive for zero files", () => {
    expect(readZip(buildSiteZip([]), T1_LIMITS)).toEqual([]);
  });
});

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
      const [entry] = readZip(server.calls[0].body, T1_LIMITS);
      expect(entry.path).toBe("index.html");
      expect(new TextDecoder().decode(entry.data)).toBe("<h1>site</h1>");
    } finally {
      vi.unstubAllGlobals();
      window.localStorage.removeItem(`ailx:sync:v1:${ATTEMPT}`);
    }
  });
});
