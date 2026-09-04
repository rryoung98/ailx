// @vitest-environment jsdom
/**
 * /gallery — the public wall.
 *
 * The listing rules themselves are proven against real Postgres in
 * packages/backend; what is asserted here is the PAGE: that it renders only
 * what the service gives it, that its filters are still shareable URLs with
 * the right accessible state, that a hostile query string is forwarded to the
 * backend parser rather than trusted, that a card leaks nothing — and, now
 * that the data arrives over HTTP, that it asks the seam for `/gallery`,
 * sends no identity, and says something honest when the call does not land.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import {
  parseGalleryQuery,
  publicEntry,
  type GalleryEntry,
  type GalleryListing,
  type PublicGalleryEntry,
} from "@ailx/contract";
import { ALL_SHARE_SECTIONS, sharePayloadFrom, type SharePayload } from "@ailx/report";
import {
  installMemoryStorage,
  renderClient,
  renderClientPending,
  stubFailingFetch,
  stubHangingFetch,
} from "./helpers/clientPage";

const TOKEN = "g".repeat(43);

const payloadWith = (over: Partial<SharePayload> = {}): SharePayload => ({
  ...sharePayloadFrom({ t1: 88.2, t2: 79.5, t3: 71.1, t4: 66.9 }, "Distinction", {
    instrument: "ailx 2026.1",
    sections: ALL_SHARE_SECTIONS,
    completedOn: "2026-03-01",
    // A per-track row is required: `parseSharePayload` reads a process block
    // with no tracks as no process at all, and the seam now returns what that
    // parser produced rather than the object that arrived.
    process: {
      totalActiveSeconds: 1800,
      tracks: [
        {
          track: "t1",
          activeSeconds: 1800,
          budgetSeconds: 3600,
          timedOut: false,
          iterationRatio: null,
          verificationEvents: 0,
        },
      ],
    },
  }),
  ...over,
});

const payload = payloadWith();

function entry(over: Partial<GalleryEntry> = {}): GalleryEntry {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    token: TOKEN,
    at: "2026-03-01T12:00:00.000Z",
    payload,
    approvedBy: "auto:card",
    ...over,
  };
}

let listing: GalleryListing;
/** What the SERVICE was asked for — the query as it left the browser. */
const seen: Record<string, string | undefined>[] = [];
const urls: string[] = [];
const identity: Array<Record<string, string>> = [];
let status = 200;
/** What `useSearchParams()` returns — the URL the reader is actually on. */
let search = new URLSearchParams();

vi.mock("next/navigation", () => ({ useSearchParams: () => search }));

const { GalleryView } = await import("../features/gallery/GalleryView");
const { metadata } = await import("../app/gallery/page.api");

/** Stand in for GET /gallery: parse the query the way the handler does. */
function stubGalleryService(): void {
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    urls.push(String(url));
    identity.push((init?.headers ?? {}) as Record<string, string>);
    const raw: Record<string, string | undefined> = {};
    const qs = String(url).split("?")[1] ?? "";
    for (const [k, v] of new URLSearchParams(qs)) raw[k] = v;
    seen.push(raw);
    // The service refuses a query it will not act on, so this stub does too:
    // `?limit=1000000000` is a 400 now, not a silently clamped 200
    // (docs/ADR-zod-tanstack.md §4).
    const parsed = parseGalleryQuery(raw);
    if (!parsed.ok) {
      return new Response(JSON.stringify({ error: { code: "bad_request", message: parsed.message } }), {
        status: 400,
      });
    }
    const body =
      status === 200
        ? { gallery: { ...listing, query: parsed.query } }
        : { error: { code: "internal", message: "no" } };
    return new Response(JSON.stringify(body), { status });
  });
}

function defaultQuery() {
  const parsed = parseGalleryQuery();
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.query;
}

function listingOf(entries: PublicGalleryEntry[], over: Partial<GalleryListing> = {}): GalleryListing {
  return {
    entries,
    total: entries.length,
    facets: [{ code: payload.playerType.code, name: payload.playerType.name, count: entries.length }],
    query: defaultQuery(),
    ...over,
  };
}

async function markup(
  query: Record<string, string | string[] | undefined> = {},
): Promise<string> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) params.append(k, one);
  }
  search = params;
  return renderClient(createElement(GalleryView));
}

beforeEach(() => {
  // These pages exist only in the hosted build, whose basePath is "" — the
  // unit-test fallback would otherwise prefix "/ailx" onto every served path
  // through lib/mode.ts (see siteHref).
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
  seen.length = 0;
  urls.length = 0;
  identity.length = 0;
  status = 200;
  listing = listingOf([publicEntry(entry())]);
  stubGalleryService();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the wall", () => {
  it("renders a published card with its type, shape and band", async () => {
    const html = await markup();
    expect(html).toContain(payload.playerType.name);
    expect(html).toContain(payload.playerType.tagline);
    expect(html).toContain("Distinction");
    expect(html).toContain("88.2");
    expect(html.match(/data-testid="gallery-card"/g)).toHaveLength(1);
  });

  it("shows the empty state instead of an empty grid", async () => {
    listing = listingOf([]);
    const html = await markup();
    expect(html).toContain("Nobody has published a card yet");
    expect(html).not.toContain("gallery-card");
    // An empty wall is not a filter miss, and it never says both.
    expect(html).not.toContain("No published card matches this filter");
    // Filters over nothing are chrome that implies content.
    expect(html).not.toContain("gallery-filters");
  });

  it("distinguishes a filter miss from an empty wall, and offers a way out", async () => {
    listing = listingOf([], {
      total: 0,
      facets: [{ code: payload.playerType.code, name: payload.playerType.name, count: 4 }],
    });
    const html = await markup();
    expect(html).toContain("No published card matches this filter");
    expect(html).toContain("Clear the filters");
    expect(html).toContain("all 4 of them");
    expect(html).not.toContain("Nobody has published a card yet");
    // There ARE cards, so the filters stay on screen.
    expect(html).toContain("gallery-filters");
  });

  it("links each card to its own share view, and leaks nothing else", async () => {
    listing = listingOf([publicEntry(entry({ payload: payloadWith({ site: "/api/site/sha256:abc/index.html" }) }))]);
    const html = await markup();
    // The listed card's own capability URL — its owner published it.
    expect(html).toContain(`href="/s/${TOKEN}"`);
    for (const forbidden of ["attemptId", "attempt_id", "participant", "site_digest", "token_sha"]) {
      expect(html, forbidden).not.toContain(forbidden);
    }
  });

  it("shows the sections the owner opted into, and only those", async () => {
    listing = listingOf([publicEntry(entry({ payload: payloadWith({ note: "I built a co-op site." }) }))]);
    expect(await markup()).toContain("I built a co-op site.");
    expect(await markup()).toContain("30 min on task");
    listing = listingOf([publicEntry(entry({ payload: payloadWith({ note: null, process: null }) }))]);
    const bare = await markup();
    expect(bare).not.toContain("min on task");
    expect(bare).not.toContain("co-op site");
  });

  it("links a built site as a same-origin new-tab link, and says so to a screen reader", async () => {
    listing = listingOf([publicEntry(entry({ payload: payloadWith({ site: "/api/site/sha256:abc/index.html" }), approvedBy: "human:ada" }))]);
    const html = await markup();
    expect(html).toContain('href="/api/site/sha256:abc/index.html"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain("(opens in a new tab)");
  });

  it("refuses to render a site path that is not one of ours", async () => {
    listing = listingOf([publicEntry(entry({ payload: payloadWith({ site: "javascript:alert(1)" }) }))]);
    const html = await markup();
    expect(html).not.toContain("javascript:");
    expect(html).toContain("card only");
  });

  it("is indexable and describes itself — this page is the growth loop", () => {
    expect(metadata.title).toContain("gallery");
    expect(metadata.robots).toBeUndefined();
    expect(String(metadata.description)).toMatch(/player-type/i);
  });
});

describe("filters", () => {
  it("marks the active filter with aria-current and links every other state", async () => {
    const html = await markup({ type: payload.playerType.code });
    expect(html).toContain(`href="/gallery?type=${payload.playerType.code}"`);
    expect(html).toMatch(/aria-current="true"/);
    expect(html).toContain('href="/gallery"'); // the "All types" reset
  });

  it("keeps the filter when the sort changes, and drops the page offset", async () => {
    const html = await markup({ type: payload.playerType.code, sort: "type", offset: "24" });
    expect(html).toContain(`href="/gallery?type=${payload.playerType.code}&amp;sort=type"`);
  });

  it("passes a repeated query parameter as its first value, never an array", async () => {
    await markup({ type: ["MSVD", "PTAE"] });
    expect(seen[0]!.type).toBe("MSVD");
  });

  /**
   * The page reads its own URL through the CONTRACT's parser before it asks
   * for anything, so a query the service would refuse costs no round trip and
   * cannot reach the wire. This is the TEN-107 fix from the browser's side:
   * the browser can no longer hold a vocabulary the parser has not heard of.
   */
  it("refuses a hostile query with the contract's own parser, and asks for nothing", async () => {
    const html = await markup({ sort: "id; DROP TABLE share_links", limit: "100000", type: "<script>" });
    expect(seen).toHaveLength(0);
    expect(urls).toHaveLength(0);
    expect(html).not.toContain("DROP TABLE");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("That filter is not one this wall can show");
  });

  /**
   * The exact query staging sent, and the exact 400 it got back (TEN-107).
   * `top` is the /wall vote sort; it has never been a gallery sort and is not
   * being added, and an absent filter is an ABSENT parameter.
   */
  it("never sends sort=top or site=0 — the two spellings the service refused", async () => {
    expect(await markup({ sort: "top", site: "0" })).toContain(
      "That filter is not one this wall can show",
    );
    expect(urls).toHaveLength(0);
    // And the query it DOES send omits the absent site filter rather than
    // spelling it as zero.
    await markup({ type: "MSVD" });
    expect(urls[0]).toContain("type=MSVD");
    expect(urls[0]).not.toContain("site=");
    expect(urls[0]).not.toContain("sort=");
  });

  it("pages forward and back without losing the filter", async () => {
    listing = listingOf([publicEntry(entry())], { total: 60, query: { ...defaultQuery(), offset: 24 } });
    const html = await markup({ offset: "24" });
    expect(html).toContain("offset=48");
    // Back to the first page is `/gallery`, not `/gallery?offset=0`: the
    // contract's writer omits a default rather than spelling it out, so a
    // shareable link carries only what was actually chosen.
    expect(html).toContain('href="/gallery"');
    expect(html).not.toContain("offset=0");
    expect(html).toContain("Showing 25–25 of 60");
  });
});

describe("keyboard and structure", () => {
  it("gives every filter a real link and every card a heading", async () => {
    const html = await markup();
    // Links are focusable by default; nothing here is a div with an onClick.
    expect(html).toMatch(/<nav class="gallery-filters" aria-label="Filter and sort the gallery">/);
    expect(html).toContain("<h3");
    expect(html).toContain('role="group" aria-label="Player type"');
    expect(html).not.toContain("onclick");
  });

  it("labels the radar for assistive technology", async () => {
    const html = await markup();
    expect(html).toMatch(/role="img" aria-label="Track shape: T1 88.2/);
  });
});

describe("how it reads the service", () => {
  it("asks the seam for /gallery and carries the reader's query", async () => {
    await markup({ type: "MSVD", sort: "oldest" });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/\/api\/gallery\?/);
    expect(urls[0]).toContain("type=MSVD");
    expect(urls[0]).toContain("sort=oldest");
  });

  /**
   * A PUBLIC read asks with `identity: "optional"`: it forwards the id this
   * browser already has (every /v1 route is behind auth today) and MINTS
   * none, so a first-time visitor's storage is untouched and the page cannot
   * work only because it invented a caller (TEN-107).
   */
  it("mints no identity for a visitor who has none", async () => {
    const store = installMemoryStorage();
    await markup();
    expect(identity[0]["x-ailx-dev-user"]).toBeUndefined();
    expect(identity[0].authorization).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it("forwards the identity this browser already has", async () => {
    installMemoryStorage().set("ailx:dev-user", "web-abc123");
    await markup();
    expect(identity[0]["x-ailx-dev-user"]).toBe("web-abc123");
  });

  it("carries a trace on the anonymous read too", async () => {
    await markup();
    expect(identity[0].traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
  });

  it("says it is loading before the call lands", async () => {
    stubHangingFetch();
    search = new URLSearchParams();
    const html = await renderClientPending(createElement(GalleryView));
    expect(html).toContain("Loading");
    expect(html).not.toContain("Nobody has published a card yet");
  });

  it("says the service did not answer when the call throws, and never claims the wall is empty", async () => {
    stubFailingFetch();
    const html = await markup();
    expect(html).toContain("did not answer");
    expect(html).not.toContain("Nobody has published a card yet");
    expect(html).not.toContain("gallery-grid");
  });

  /**
   * The three failures are three different facts and get three different
   * sentences (TEN-107). A 500 was REACHED, so the page may not say it was
   * not, and it quotes what the service said rather than paraphrasing it.
   */
  it("says a 500 was reached and refused, and repeats the reason given", async () => {
    status = 500;
    const html = await markup();
    expect(html).toContain("was reached and refused");
    expect(html).toContain("HTTP 500");
    expect(html).toContain("It said: no");
    expect(html).not.toContain("did not answer");
    expect(html).not.toContain("Nobody has published a card yet");
  });

  /**
   * The staging failure a visitor actually saw: a public page told them their
   * connection was at fault when the service had answered 401.
   */
  it("names a 401 on a public wall as our fault, not the reader's connection", async () => {
    status = 401;
    const html = await markup();
    expect(html).toContain("HTTP 401");
    expect(html).toContain("meant to be public");
    expect(html).not.toContain("did not answer");
    expect(html).not.toContain("Check your connection");
  });
});

/**
 * THE SEAM VALIDATES. `useService` is given the route's schema from
 * `API_RESPONSE_SCHEMAS`, so a body that is not the shape `GET /gallery`
 * declares is refused at the boundary and nothing on the page is rendered
 * from it (docs/ADR-zod-tanstack.md §2).
 */
describe("a body that is not the shape the route declares", () => {
  let logged: unknown[][];
  beforeEach(() => {
    logged = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void logged.push(args));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const bad = (over: Record<string, unknown>) =>
    ({ ...listingOf([publicEntry(entry())]), ...over }) as unknown as GalleryListing;

  /**
   * The drift docs/ADR-orpc.md §7 found by reading the code: the browser
   * declared `approvedBy` on a listing entry and the service has never sent
   * one. The type is the schema now, so an entry that DOES carry it is the
   * one refused — nobody's approver reaches a public wall by accident.
   */
  it("refuses an entry carrying the approver", async () => {
    listing = bad({ entries: [entry()] });
    const html = await markup();
    expect(html).not.toContain("gallery-card");
    expect(html).toContain("could not read");
    expect(logged.length).toBe(1);
  });

  it("refuses a wrong type, a missing field and an unknown key", async () => {
    for (const over of [{ total: "1" }, { facets: undefined }, { surprise: true }]) {
      listing = bad(over);
      expect(await markup()).toContain("could not read");
    }
  });

  it("still renders the wall when the body IS the declared shape", async () => {
    listing = listingOf([publicEntry(entry())]);
    const html = await markup();
    expect(html).toContain("gallery-card");
    expect(logged.length).toBe(0);
  });
});
