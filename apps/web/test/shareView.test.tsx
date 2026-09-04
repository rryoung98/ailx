// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://ailx.example/" }
/**
 * The share VIEW is what a stranger sees, so these tests assert two separate
 * things: that the social preview exists at all (no preview, no loop), and
 * that the page shows the allowlisted payload and NOTHING else — no items,
 * no answers, no identity.
 *
 * The page reads `GET /share/<token>` over HTTP now instead of calling the
 * handler in-process, so it also has to prove that it stays ANONYMOUS (the
 * token is the whole capability), that a withdrawn token still 404s, and that
 * an outage is not dressed as a revocation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import {
  ALL_SHARE_SECTIONS,
  SHARE_NETWORKS,
  shareIntentUrl,
  sharePayloadFrom,
  shareText,
} from "@ailx/report";
import { TRACK_IDS } from "@ailx/session";
import {
  renderClient,
  renderClientPending,
  stubFailingFetch,
  stubHangingFetch,
} from "./helpers/clientPage";

const payload = sharePayloadFrom(
  { t1: 88.2, t2: 79.5, t3: 71.1, t4: 66.9 },
  "Distinction",
  { instrument: "ailx 2026.1" },
);

/** A share with every opt-in section on — the widest thing we ever serve. */
// A MIXED shape on purpose: strengths and watch-outs both need a pole each.
const fullPayload = sharePayloadFrom({ t1: 88.2, t2: 79.5, t3: 5, t4: 4 }, "Merit", {
  instrument: "ailx 2026.1",
  sections: ALL_SHARE_SECTIONS,
  site: "/api/site/sha256:abc/index.html",
  completedOn: "2026-02-03",
  note: "I built a site for a bike-repair co-op.",
  process: {
    totalActiveSeconds: 1800,
    tracks: TRACK_IDS.map((track, i) => ({
      track,
      activeSeconds: 300 + i * 60,
      budgetSeconds: 600,
      timedOut: i === 3,
      iterationRatio: 0.5,
      verificationEvents: i,
    })),
  },
});

const view = {
  status: "unlisted",
  createdAt: "2026-02-03T10:00:00.000Z",
  views: 7,
  payload,
};

let result: { status: number; body: Record<string, unknown> };
const urls: string[] = [];
const identity: Array<Record<string, string>> = [];

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "ailx.example" }),
}));
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
const TOKEN = "b".repeat(43);
vi.mock("next/navigation", () => ({ notFound, useParams: () => ({ token: "b".repeat(43) }) }));

const { ShareView } = await import("../features/share/ShareView");
const { generateMetadata } = await import("../app/s/[token]/page.api");

const params = { params: Promise.resolve({ token: TOKEN }) };

function stubShareService(): void {
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    urls.push(String(url));
    identity.push((init?.headers ?? {}) as Record<string, string>);
    return new Response(JSON.stringify(result.body), { status: result.status });
  });
}

beforeEach(() => {
  // These pages exist only in the hosted build, whose basePath is "" — the
  // unit-test fallback would otherwise prefix "/ailx" onto every served path
  // through lib/mode.ts (see siteHref).
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
  vi.stubEnv("AILX_PUBLIC_ORIGIN", "https://ailx.example");
  urls.length = 0;
  identity.length = 0;
  notFound.mockClear();
  result = { status: 200, body: { share: view } };
  stubShareService();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function markup(): Promise<string> {
  return renderClient(createElement(ShareView));
}

describe("share view metadata", () => {
  it("ships OG and Twitter tags with an image, so the paste previews", async () => {
    const meta = await generateMetadata(params);
    expect(meta.title).toContain(payload.playerType.name);
    expect(meta.openGraph?.title).toContain(payload.playerType.code);
    expect(meta.openGraph?.url).toBe(`https://ailx.example/s/${TOKEN}`);
    const image = (meta.openGraph!.images as { url: string; width: number }[])[0]!;
    expect(image.url).toBe(`https://ailx.example/s/${TOKEN}/card.png`);
    expect(image.width).toBe(1200);
    // Asserted as one object: `Metadata["twitter"]` is a union whose
    // card-less member has no `card` property, so reading `.card` off it
    // needed a cast, and the line below carried a second one that
    // contradicted the type it was casting from.
    expect(meta.twitter).toMatchObject({
      card: "summary_large_image",
      images: [expect.stringContaining("card.png")],
    });
  });

  it("reads the share from the service, absolutely — a server fetch has no origin", async () => {
    await generateMetadata(params);
    expect(urls[0]).toBe(`https://ailx.example/api/share/${TOKEN}`);
  });

  it("is noindex — an unlisted capability URL must never be a search hit", async () => {
    const meta = await generateMetadata(params);
    expect(meta.robots).toMatchObject({ index: false, follow: false });
  });

  it("sends no identity: a scraper is anonymous and stays anonymous", async () => {
    await generateMetadata(params);
    expect(identity[0]?.["x-ailx-dev-user"]).toBeUndefined();
  });

  it("degrades to a plain noindex title for an unknown or revoked token", async () => {
    result = { status: 404, body: {} };
    const meta = await generateMetadata(params);
    expect(meta.title).toContain("not found");
    expect(meta.robots).toMatchObject({ index: false });
    expect(meta.openGraph).toBeUndefined();
  });

  it("degrades the same way when the service cannot be reached at all", async () => {
    stubFailingFetch();
    const meta = await generateMetadata(params);
    expect(meta.title).toContain("not found");
    expect(meta.openGraph).toBeUndefined();
  });
});

describe("reading the share", () => {
  it("asks the seam for /share/<token> and sends no identity", async () => {
    await markup();
    expect(urls[0]).toMatch(new RegExp(`/api/share/${TOKEN}$`));
    expect(identity[0]["x-ailx-dev-user"]).toBeUndefined();
    expect(identity[0].authorization).toBeUndefined();
  });

  it("waits visibly rather than flashing an empty card", async () => {
    stubHangingFetch();
    const html = await renderClientPending(createElement(ShareView));
    expect(html).toContain("Loading");
    expect(html).not.toContain("ptype-letter");
  });

  it("does NOT claim the link was revoked when the service is unreachable", async () => {
    stubFailingFetch();
    const html = await markup();
    expect(html).toContain("did not answer");
    expect(notFound).not.toHaveBeenCalled();
  });

  it("shows the view count the SERVER reports, and never asserts one", async () => {
    // Counting a view is the store's job and always was; the page only ever
    // renders the number it was given. It cannot inflate it from here.
    result = { status: 200, body: { share: { ...view, views: 41 } } };
    expect(await markup()).toContain("41 views");
  });
});

describe("share view page", () => {
  it("makes the player type the hero: name in the h1, code as letters", async () => {
    const html = await markup();
    const el = document.createElement("div");
    el.innerHTML = html;
    expect(el.querySelector("h1")!.textContent).toBe(payload.playerType.name);
    expect(el.querySelectorAll(".ptype-letter")).toHaveLength(4);
    expect(el.querySelector(".ptype-code")!.getAttribute("aria-label")).toContain(
      payload.playerType.code.split("").join(" "),
    );
  });

  it("shows the band and the four-track shape, and no composite number", async () => {
    const html = await markup();
    expect(html).toContain("Distinction");
    for (const v of ["88.2", "79.5", "71.1", "66.9"]) expect(html).toContain(v);
  });

  it("leaks nothing beyond the allowlist", async () => {
    const html = await markup();
    for (const forbidden of [
      "itemId", "item_id", "confidence", "responses", "eventLog", "answerKey",
      "attemptId", "participant", "percentile", "composite", "dev:", "authRef",
    ]) {
      expect(html, forbidden).not.toContain(forbidden);
    }
    // Nothing is smuggled in as embedded data either.
    expect(html).not.toContain("application/json");
    expect(html).not.toContain("__NEXT_DATA__");
  });

  it("stays anonymous: the render sends no identity and no cookie of ours", async () => {
    await markup();
    expect(identity[0]["x-ailx-dev-user"]).toBeUndefined();
    expect(identity[0].cookie).toBeUndefined();
  });

  it("404s a revoked or unknown token instead of rendering an empty card", async () => {
    result = { status: 404, body: {} };
    await expect(markup()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("hides the site section unless the site was shared", async () => {
    expect(await markup()).not.toContain("The thing they actually built");
    result = {
      status: 200,
      body: { share: { ...view, payload: { ...payload, site: "/api/site/sha256:abc/index.html" } } },
    };
    const html = await markup();
    expect(html).toContain("The thing they actually built");
    expect(html).toContain('href="/api/site/sha256:abc/index.html"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain("(opens in a new tab)");
  });

  it("closes the loop with a call to action into the exam", async () => {
    const html = await markup();
    expect(html).toContain('href="/exam"');
    expect(html).toContain("Find your own type");
  });

  it("is honest about what the band is and is not", async () => {
    const html = await markup();
    expect(html).toContain("demo\n          cohort".replace("\n          ", " "));
    expect(html).toMatch(/never an exam item/);
    expect(html).toMatch(/unlisted/);
    expect(html).toContain("7 views");
  });

  it("renders every opted-in section, and only sections that are present", async () => {
    result = { status: 200, body: { share: { ...view, payload: fullPayload } } };
    const html = await markup();
    expect(html).toContain("What they chose to show");
    expect(html).toContain("I built a site for a bike-repair co-op.");
    expect(html).toContain("30 min");
    expect(html).toContain("2026-02-03");
    expect(html).toContain("on the clock");
    expect(html).toContain("What they are good at");
    expect(html).toContain("What to watch");
    // A card-only payload shows none of it.
    result = { status: 200, body: { share: view } };
    const bare = await markup();
    expect(bare).not.toContain("min on task");
    expect(bare).not.toContain("bike-repair");
  });

  it("leaks nothing beyond the allowlist even at full width", async () => {
    result = { status: 200, body: { share: { ...view, payload: fullPayload } } };
    const html = await markup();
    for (const forbidden of [
      "itemId", "item_id", "confidence", "responses", "eventLog", "answerKey",
      "attemptId", "participant", "percentile", "composite", "dev:", "authRef",
      "dPrime", "brier", "verbCounts", "eventCount",
    ]) {
      expect(html, forbidden).not.toContain(forbidden);
    }
  });

  it("uses semantic headings and a labelled radar for assistive tech", async () => {
    const el = document.createElement("div");
    el.innerHTML = await markup();
    expect(el.querySelectorAll("h1")).toHaveLength(1);
    expect(el.querySelectorAll("h2").length).toBeGreaterThanOrEqual(2);
    const radar = el.querySelector('svg[role="img"]')!;
    expect(radar.getAttribute("aria-label")).toContain("T1 88.2");
  });
});


describe("passing the link on", () => {
  it("renders the three network targets and a copy button, third-person", async () => {
    const html = await markup();
    expect(html).toContain("Send this on");
    for (const network of SHARE_NETWORKS) {
      const href = shareIntentUrl(network, payload, `https://ailx.example/s/${TOKEN}`, "theirs");
      // React escapes `&` in attributes; compare against the escaped form.
      expect(html).toContain(href.replace(/&/g, "&amp;"));
    }
    // Never a first-person claim in a reader's mouth, and never the token in
    // anything but the canonical URL it already holds.
    const theirs = shareText(payload, "x", "theirs");
    expect(/\bI\b/.test(theirs)).toBe(false);
  });

  it("shares only the canonical /s/<token> URL — no extra payload in the target", async () => {
    const html = await markup();
    const hrefs = [...html.matchAll(/href="(https:\/\/(x\.com|www\.linkedin\.com|wa\.me)[^"]*)"/g)];
    expect(hrefs).toHaveLength(SHARE_NETWORKS.length);
    for (const [, raw] of hrefs) {
      const decoded = decodeURIComponent(raw.replace(/&amp;/g, "&"));
      expect(decoded).toContain(`https://ailx.example/s/${TOKEN}`);
      expect(decoded).not.toContain(payload.band);
      for (const v of Object.values(payload.tracks)) expect(decoded).not.toContain(v.toFixed(1));
    }
  });
});
