// @vitest-environment jsdom
/**
 * /review — the AILX moderation dashboard.
 *
 * The gate itself is server-side and proven against Postgres in
 * packages/backend; what these tests hold is the PAGE's half of the contract:
 * it renders nothing at all for a caller the server refused (no queue, no
 * site link, not even the page's own copy), it forwards the real request
 * headers to the gate rather than trusting a prop, and each lane shows the
 * operational facts a moderator works from — what was decided, when, by whom
 * and why.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FORBIDDEN_RESULT, parseCaseQuery, type CaseListing, type ModerationCase } from "@ailx/backend";
import { sharePayloadFrom } from "@ailx/report";

const payload = sharePayloadFrom({ t1: 70, t2: 60, t3: 50, t4: 40 }, "Merit", {
  instrument: "ailx 2026.1",
  site: "/api/site/sha256:abc/index.html",
  note: "A co-op site I built in an afternoon.",
});

const CASE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function moderationCase(over: Partial<ModerationCase> = {}): ModerationCase {
  return {
    entry: { id: CASE_ID, token: "r".repeat(43), at: "2026-03-02T09:00:00.000Z", payload, approvedBy: null },
    status: "submitted",
    submittedAt: "2026-03-02T09:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    rejectReason: null,
    appealOpen: false,
    comments: 0,
    ...over,
  };
}

let result: { status: number; body: Record<string, unknown> };
const seenHeaders: Record<string, string>[] = [];
const seenQuery: Record<string, string | undefined>[] = [];

vi.mock("../lib/server/api", () => ({
  withApiContext: async (fn: (ctx: unknown) => Promise<unknown>) => fn({ db: {}, auth: {} }),
  requestHeaderMap: async () => ({ "x-ailx-dev-user": "reviewer-1", host: "ailx.example" }),
}));
vi.mock("@ailx/backend", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@ailx/backend");
  return {
    ...actual,
    handleModerationCases: async (
      _ctx: unknown,
      headers: Record<string, string>,
      raw: Record<string, string | undefined>,
    ) => {
      seenHeaders.push(headers);
      seenQuery.push(raw);
      return result;
    },
  };
});
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound, useRouter: () => ({ refresh: vi.fn() }) }));

const { default: ModerationPage, metadata } = await import("../app/review/page.api");

function listingOf(cases: ModerationCase[], raw: Record<string, string> = {}): CaseListing {
  return {
    cases,
    total: cases.length,
    query: parseCaseQuery(raw),
    counts: { pending: cases.length, appeals: 0, decided: 0 },
  };
}

const markup = async (search: Record<string, string | string[] | undefined> = {}): Promise<string> =>
  renderToStaticMarkup(await ModerationPage({ searchParams: Promise.resolve(search) }));

beforeEach(() => {
  seenHeaders.length = 0;
  seenQuery.length = 0;
  notFound.mockClear();
  result = { status: 200, body: { listing: listingOf([moderationCase()]) } };
});

describe("the gate", () => {
  it("renders nothing for a non-reviewer — a 403 from the gate is a 404 page", async () => {
    result = FORBIDDEN_RESULT;
    await expect(markup()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("renders nothing for an anonymous caller either", async () => {
    result = { status: 401, body: { error: { code: "unauthorized", message: "authentication required" } } };
    await expect(markup()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("hands the REQUEST headers to the server gate, lower-cased", async () => {
    await markup();
    expect(seenHeaders[0]!["x-ailx-dev-user"]).toBe("reviewer-1");
  });

  it("is never indexed — the dashboard holds sites nobody has vetted", () => {
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });
});

describe("the waiting queue", () => {
  it("shows each waiting submission as the card the public would see", async () => {
    const html = await markup();
    expect(html).toContain(payload.playerType.name);
    expect(html).toContain('href="/api/site/sha256:abc/index.html"');
    expect(html.match(/data-testid="gallery-card"/g)).toHaveLength(1);
  });

  it("offers approve and reject as real buttons, named for a screen reader", async () => {
    const html = await markup();
    expect(html).toContain("Approve");
    expect(html).toContain("Reject");
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain(`<span class="sr-only"> ${payload.playerType.name}</span>`);
    expect(html).toContain('role="alert"');
  });

  it("gives the refusal a required, labelled reason field", async () => {
    const el = document.createElement("div");
    el.innerHTML = await markup();
    const input = el.querySelector<HTMLInputElement>('input[type="text"]')!;
    const label = el.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`)!;
    expect(label.textContent).toMatch(/reason/i);
    expect(input.getAttribute("maxlength")).toBe("500");
  });

  it("links each queued card to its share view and to its case", async () => {
    const html = await markup();
    expect(html).toContain('href="/s/rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr"');
    expect(html).toContain(`href="/review/${CASE_ID}"`);
  });

  it("says the queue is empty rather than rendering an empty grid", async () => {
    result = { status: 200, body: { listing: listingOf([]) } };
    const html = await markup();
    expect(html).toContain("The queue is empty.");
    expect(html).not.toContain("gallery-card");
  });

  it("tells the moderator what approving and refusing actually do", async () => {
    const html = await markup();
    expect(html).toMatch(/stamp your identity/);
    expect(html).toContain("stores your reason");
    expect(html).toContain("the candidate is shown");
  });
});

describe("the lanes", () => {
  it("offers all three lanes with their counts, and marks the current one", async () => {
    result = {
      status: 200,
      body: {
        listing: {
          ...listingOf([], { lane: "appeals" }),
          counts: { pending: 4, appeals: 2, decided: 37 },
        },
      },
    };
    const html = await markup({ lane: "appeals" });
    expect(html).toContain('href="/review"');
    expect(html).toContain('href="/review?lane=decided"');
    expect(html).toMatch(/Answered back <span class="mono">2<\/span>/);
    expect(html).toMatch(/History <span class="mono">37<\/span>/);
    expect(html).toMatch(/aria-current="page"[^>]*>Answered back/);
  });

  it("passes the query string to the backend parser instead of trusting it", async () => {
    await markup({ lane: ["decided", "pending"], offset: "25" });
    expect(seenQuery[0]).toEqual({ lane: "decided", offset: "25" });
  });

  it("shows a decided case as a dense row: state, date, who and why", async () => {
    result = {
      status: 200,
      body: {
        listing: {
          ...listingOf(
            [
              moderationCase({
                status: "rejected",
                decidedAt: "2026-03-03T11:30:00.000Z",
                decidedBy: "dev:reviewer-2",
                rejectReason: "The site embeds a third-party tracker.",
                comments: 3,
              }),
            ],
            { lane: "decided" },
          ),
          counts: { pending: 0, appeals: 0, decided: 1 },
        },
      },
    };
    const html = await markup({ lane: "decided" });
    expect(html).toContain("rejected");
    expect(html).toContain("2026-03-03");
    expect(html).toContain("dev:reviewer-2");
    expect(html).toContain("The site embeds a third-party tracker.");
    expect(html).toContain("<table");
    // The history is a record, not a queue: no decision buttons on it.
    expect(html).not.toContain("<button");
  });

  it("flags an open appeal on the row it belongs to", async () => {
    result = {
      status: 200,
      body: {
        listing: {
          ...listingOf(
            [moderationCase({ status: "rejected", decidedBy: "dev:reviewer-1", appealOpen: true })],
            { lane: "appeals" },
          ),
          counts: { pending: 0, appeals: 1, decided: 1 },
        },
      },
    };
    const html = await markup({ lane: "appeals" });
    expect(html).toContain("appeal open");
    expect(html).toContain("The refusal itself stands");
  });

  it("offers the auto-published cards as an explicit opt-in, off by default", async () => {
    result = {
      status: 200,
      body: { listing: { ...listingOf([], { lane: "decided" }), counts: { pending: 0, appeals: 0, decided: 0 } } },
    };
    const html = await markup({ lane: "decided" });
    expect(html).toContain('href="/review?lane=decided&amp;auto=1"');
    expect(html).toContain("Include auto-published cards");
  });

  it("pages a long lane forwards and back", async () => {
    result = {
      status: 200,
      body: {
        listing: {
          ...listingOf([moderationCase()], { lane: "decided", offset: "25", limit: "25" }),
          total: 80,
          counts: { pending: 0, appeals: 0, decided: 80 },
        },
      },
    };
    const html = await markup({ lane: "decided", offset: "25" });
    expect(html).toContain("offset=50");
    expect(html).toContain("offset=0");
  });
});
