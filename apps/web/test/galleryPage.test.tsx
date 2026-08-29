// @vitest-environment jsdom
/**
 * /gallery — the public wall.
 *
 * The listing rules themselves are proven against real Postgres in
 * packages/backend; what is asserted here is the PAGE: that it renders only
 * what the handler gives it, that its filters are shareable URLs with the
 * right accessible state, that a hostile query string is normalized by the
 * backend parser rather than trusted, and that a card leaks nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseGalleryQuery, type GalleryEntry, type GalleryListing } from "@ailx/backend";
import { sharePayloadFrom } from "@ailx/report";

const payload = sharePayloadFrom({ t1: 88.2, t2: 79.5, t3: 71.1, t4: 66.9 }, "Distinction", {
  instrument: "ailx 2026.1",
});

function entry(over: Partial<GalleryEntry> = {}): GalleryEntry {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    at: "2026-03-01T12:00:00.000Z",
    instrument: payload.instrument,
    playerType: payload.playerType,
    band: payload.band,
    tracks: payload.tracks,
    site: null,
    approvedBy: "auto:card",
    ...over,
  };
}

let listing: GalleryListing;
const seen: Record<string, string | undefined>[] = [];

vi.mock("../lib/server/api", () => ({
  withApiContext: async (fn: (ctx: unknown) => Promise<unknown>) => fn({ db: {} }),
}));
vi.mock("@ailx/backend", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@ailx/backend");
  return {
    ...actual,
    handleListGallery: async (_ctx: unknown, raw: Record<string, string | undefined>) => {
      seen.push(raw);
      return { status: 200, body: { gallery: { ...listing, query: parseGalleryQuery(raw) } } };
    },
  };
});

const { default: GalleryPage, metadata } = await import("../app/gallery/page.api");

function listingOf(entries: GalleryEntry[], over: Partial<GalleryListing> = {}): GalleryListing {
  return {
    entries,
    total: entries.length,
    facets: [{ code: payload.playerType.code, name: payload.playerType.name, count: entries.length }],
    query: parseGalleryQuery(),
    ...over,
  };
}

async function markup(search: Record<string, string | string[] | undefined> = {}): Promise<string> {
  return renderToStaticMarkup(await GalleryPage({ searchParams: Promise.resolve(search) }));
}

beforeEach(() => {
  seen.length = 0;
  listing = listingOf([entry()]);
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
    expect(html).toContain("Nothing published yet.");
    expect(html).not.toContain("gallery-card");
  });

  it("carries no token, attempt, participant or site digest", async () => {
    listing = listingOf([entry({ site: "/api/site/sha256:abc/index.html" })]);
    const html = await markup();
    for (const forbidden of ["token", "attemptId", "attempt_id", "participant", "site_digest"]) {
      expect(html, forbidden).not.toContain(forbidden);
    }
  });

  it("links a built site as a same-origin new-tab link, and says so to a screen reader", async () => {
    listing = listingOf([entry({ site: "/api/site/sha256:abc/index.html", approvedBy: "human:ada" })]);
    const html = await markup();
    expect(html).toContain('href="/api/site/sha256:abc/index.html"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain("(opens in a new tab)");
  });

  it("refuses to render a site path that is not one of ours", async () => {
    listing = listingOf([entry({ site: "javascript:alert(1)" })]);
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

  it("hands a hostile query to the backend parser, which normalizes it", async () => {
    const html = await markup({ sort: "id; DROP TABLE share_links", limit: "100000", type: "<script>" });
    expect(seen[0]!.sort).toBe("id; DROP TABLE share_links"); // untouched on the way in
    expect(html).not.toContain("DROP TABLE");
    expect(html).not.toContain("<script>alert");
  });

  it("pages forward and back without losing the filter", async () => {
    listing = listingOf([entry()], { total: 60, query: parseGalleryQuery({ offset: "24" }) });
    const html = await markup({ offset: "24" });
    expect(html).toContain("offset=48");
    expect(html).toContain("offset=0");
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
