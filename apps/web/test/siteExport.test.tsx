// @vitest-environment jsdom
/**
 * T1 artifact export — client side.
 *
 * The claims worth testing here are the honest ones: the download is the
 * floor and never breaks, every failure mode collapses to one vocabulary the
 * UI can explain, a deployment without GitHub degrades instead of lying, and
 * the panel states what it is about to do to the candidate's account BEFORE
 * they authorize.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DEFAULT_REPO_NAME } from "@ailx/contract";
import {
  DEFAULT_EXPORT_REPO_NAME,
  V0_NOTE,
  downloadSiteZip,
  exportFilename,
  pollGithubExport,
  startGithubExport,
} from "../features/report/siteExport";
import { SiteExportPanel } from "../features/report/SiteExportPanel";

const ATTEMPT = "att-local-1";
const SERVER_ID = "00000000-0000-4000-8000-0000000000aa";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

/** Sync bookkeeping as the persistence mirror writes it. */
function mirrored() {
  const storage = fakeStorage();
  storage.setItem(
    `foray:sync:v1:${ATTEMPT}`,
    JSON.stringify({ serverAttemptId: SERVER_ID, syncedThrough: 1, finalized: false }),
  );
  return storage;
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Programmable server: a queue of [status, body, headers] per request. */
function fakeServer(queue: [number, unknown, Record<string, string>?][]) {
  const calls: Call[] = [];
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
    });
    const next = queue.shift();
    if (next === undefined) throw new Error(`unqueued request: ${String(url)}`);
    const [status, body, headers] = next;
    // Copied into a fresh Uint8Array: a `BlobPart` must be backed by an
    // ArrayBuffer, and `body instanceof Uint8Array` only narrows as far as
    // ArrayBufferLike (a SharedArrayBuffer-backed view is not a BlobPart).
    const bytes = body instanceof Uint8Array ? new Uint8Array(body) : new Uint8Array();
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k: string) => headers?.[k.toLowerCase()] ?? null },
      json: async () => body,
      blob: async () => new Blob([bytes]),
    } as unknown as Response;
  }) as typeof fetch;
  return { fetchFn, calls };
}

const opts = (server: ReturnType<typeof fakeServer>) => ({
  baseUrl: "/api",
  siteRoot: "/api",
  fetchFn: server.fetchFn,
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

describe("exportFilename", () => {
  it("takes the server's filename", () => {
    expect(exportFilename('attachment; filename="ailx-site-abc123.zip"')).toBe("ailx-site-abc123.zip");
  });

  it("falls back when the header is absent or malformed", () => {
    expect(exportFilename(null)).toBe("ailx-site.zip");
    expect(exportFilename("attachment")).toBe("ailx-site.zip");
  });
});

describe("downloadSiteZip", () => {
  beforeEach(() => {
    // jsdom has no object URLs and no real navigation.
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  it("fetches the attempt's export with identity headers and saves it", async () => {
    const server = fakeServer([
      [200, new Uint8Array([1, 2, 3]), { "content-disposition": 'attachment; filename="ailx-site-abc.zip"' }],
    ]);
    const result = await downloadSiteZip(mirrored(), ATTEMPT, opts(server));
    expect(result.ok).toBe(true);
    expect(server.calls[0]!.url).toBe(`/api/attempts/${SERVER_ID}/site/export`);
    // A navigation cannot carry the identity header, so this must be a fetch.
    expect(Object.keys(server.calls[0]!.headers).join()).toMatch(/x-ailx-dev-user|authorization/);
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("says so when the run was never mirrored to the server", async () => {
    const server = fakeServer([]);
    const result = await downloadSiteZip(fakeStorage(), ATTEMPT, opts(server));
    expect(result).toMatchObject({ ok: false, kind: "unsupported" });
    expect(server.calls).toHaveLength(0);
  });

  it("does nothing at all in the static export", async () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "");
    const server = fakeServer([]);
    expect(await downloadSiteZip(mirrored(), ATTEMPT, opts(server))).toMatchObject({ ok: false });
    expect(server.calls).toHaveLength(0);
  });

  it("reports a missing submission as no_submission", async () => {
    const server = fakeServer([[404, { error: { code: "not_found", message: "nothing to export" } }]]);
    const result = await downloadSiteZip(mirrored(), ATTEMPT, opts(server));
    expect(result).toMatchObject({ ok: false, kind: "no_submission", message: "nothing to export" });
  });

  it("reports a network failure as retryable", async () => {
    const fetchFn = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    const result = await downloadSiteZip(mirrored(), ATTEMPT, {
      baseUrl: "/api",
      siteRoot: "/api",
      fetchFn,
    });
    expect(result).toMatchObject({ ok: false, kind: "unavailable" });
  });
});

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

const AUTH_BODY = {
  authorization: {
    deviceCode: "device-123",
    userCode: "WXYZ-1234",
    verificationUri: "https://github.com/login/device",
    intervalSeconds: 1,
    expiresInSeconds: 900,
    scope: "public_repo",
  },
};

describe("startGithubExport", () => {
  it("returns the code the candidate types and the scope GitHub recorded", async () => {
    const server = fakeServer([[200, AUTH_BODY]]);
    const result = await startGithubExport(mirrored(), ATTEMPT, opts(server));
    expect(result).toMatchObject({ ok: true, value: { userCode: "WXYZ-1234", scope: "public_repo" } });
    expect(server.calls[0]!.url).toBe(`/api/attempts/${SERVER_ID}/site/github/start`);
    expect(server.calls[0]!.method).toBe("POST");
  });

  it("maps 501 onto unsupported, so the UI can drop the option", async () => {
    const server = fakeServer([
      [501, { error: { code: "github_not_configured", message: "download the ZIP instead" } }],
    ]);
    expect(await startGithubExport(mirrored(), ATTEMPT, opts(server))).toMatchObject({
      ok: false,
      kind: "unsupported",
    });
  });

  it("refuses an unintelligible answer rather than inventing a code", async () => {
    const server = fakeServer([[200, { authorization: { userCode: "X" } }]]);
    expect(await startGithubExport(mirrored(), ATTEMPT, opts(server))).toMatchObject({
      ok: false,
      kind: "unavailable",
    });
  });
});

describe("pollGithubExport", () => {
  const input = { deviceCode: "device-123", repoName: "my-site" };

  it("reports 202 as pending, with the server's retry interval", async () => {
    const server = fakeServer([
      [202, { error: { code: "authorization_pending", message: "waiting", retryAfterSeconds: 12 } }],
    ]);
    expect(await pollGithubExport(mirrored(), ATTEMPT, input, opts(server))).toMatchObject({
      ok: false,
      kind: "pending",
      retryAfterSeconds: 12,
    });
  });

  it("maps a taken repository name onto name_taken", async () => {
    const server = fakeServer([
      [409, { error: { code: "repo_name_unavailable", message: "name already exists" } }],
    ]);
    expect(await pollGithubExport(mirrored(), ATTEMPT, input, opts(server))).toMatchObject({
      ok: false,
      kind: "name_taken",
    });
  });

  it("maps an expired authorization onto authorization_failed", async () => {
    const server = fakeServer([
      [401, { error: { code: "authorization_failed", message: "expired" } }],
    ]);
    expect(await pollGithubExport(mirrored(), ATTEMPT, input, opts(server))).toMatchObject({
      ok: false,
      kind: "authorization_failed",
    });
  });

  it("returns the repository and the Vercel deploy link", async () => {
    const server = fakeServer([
      [
        201,
        {
          repo: {
            owner: "candidate",
            name: "my-site",
            htmlUrl: "https://github.com/candidate/my-site",
            defaultBranch: "main",
          },
          deployUrl: "https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com",
        },
      ],
    ]);
    const result = await pollGithubExport(mirrored(), ATTEMPT, input, opts(server));
    expect(result).toMatchObject({
      ok: true,
      value: { name: "my-site", deployUrl: expect.stringContaining("vercel.com/new/clone") },
    });
    expect(server.calls[0]!.body).toEqual(input);
  });
});

describe("DEFAULT_EXPORT_REPO_NAME", () => {
  it("is the server's own default, so the field is pre-filled with the truth", () => {
    expect(DEFAULT_EXPORT_REPO_NAME).toBe(DEFAULT_REPO_NAME);
  });
});

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(node));
}

afterEach(() => {
  if (root !== undefined) act(() => root.unmount());
  container?.remove();
});

const click = (label: string) => {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
  if (button === undefined) throw new Error(`no button matching ${label}`);
  act(() => button.click());
};

describe("SiteExportPanel", () => {
  it("renders nothing in the static export", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "");
    render(<SiteExportPanel attemptId={ATTEMPT} />);
    expect(container.textContent).toBe("");
  });

  it("always offers the download, and says it needs no account", () => {
    render(<SiteExportPanel attemptId={ATTEMPT} />);
    expect(container.textContent).toContain("Download ZIP");
    expect(container.textContent).toContain("no account needed");
  });

  it("states exactly what AILX will do to the GitHub account, before connecting", () => {
    render(<SiteExportPanel attemptId={ATTEMPT} />);
    click("Put it on GitHub");
    const text = container.textContent ?? "";
    expect(text).toContain("public_repo");
    expect(text).toContain("PUBLIC repository");
    expect(text).toContain("cannot see your private repositories");
    expect(text).toContain("never stored");
    // And the name it is about to use is editable, pre-filled with the default.
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe(DEFAULT_EXPORT_REPO_NAME);
  });

  it("ships no Open in v0 button, and says why", () => {
    render(<SiteExportPanel attemptId={ATTEMPT} />);
    expect(container.textContent).toContain(V0_NOTE);
    const labels = [...container.querySelectorAll("button, a")].map((n) => n.textContent ?? "");
    expect(labels.some((l) => l.toLowerCase().includes("open in v0"))).toBe(false);
  });

  it("never offers a Vercel deploy before a repository exists to clone", () => {
    render(<SiteExportPanel attemptId={ATTEMPT} />);
    expect(container.textContent).not.toContain("Deploy with Vercel");
  });
});
