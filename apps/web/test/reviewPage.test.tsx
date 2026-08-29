// @vitest-environment jsdom
/**
 * /review — the reviewer surface.
 *
 * The gate itself is server-side and proven in packages/backend; what these
 * tests hold is the PAGE's half of the contract: it renders nothing at all
 * for a caller the server refused (no queue, no site link, not even the
 * page's own copy), it forwards the real request headers to the gate rather
 * than trusting a prop, and a reviewer gets the same card the public sees
 * plus two real buttons.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FORBIDDEN_RESULT, type GalleryEntry } from "@ailx/backend";
import { sharePayloadFrom } from "@ailx/report";

const payload = sharePayloadFrom({ t1: 70, t2: 60, t3: 50, t4: 40 }, "Merit", {
  instrument: "ailx 2026.1",
  site: "/api/site/sha256:abc/index.html",
  note: "A co-op site I built in an afternoon.",
});

const SUBMISSION: GalleryEntry = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  token: "r".repeat(43),
  at: "2026-03-02T09:00:00.000Z",
  payload,
  approvedBy: null,
};

let result: { status: number; body: Record<string, unknown> };
const seenHeaders: Record<string, string>[] = [];

vi.mock("../lib/server/api", () => ({
  withApiContext: async (fn: (ctx: unknown) => Promise<unknown>) => fn({ db: {}, auth: {} }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-ailx-dev-user": "reviewer-1", host: "ailx.example" }),
}));
vi.mock("@ailx/backend", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@ailx/backend");
  return {
    ...actual,
    handleReviewQueue: async (_ctx: unknown, headers: Record<string, string>) => {
      seenHeaders.push(headers);
      return result;
    },
  };
});
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound, useRouter: () => ({ refresh: vi.fn() }) }));

const { default: ReviewPage, metadata } = await import("../app/review/page.api");

const markup = async (): Promise<string> => renderToStaticMarkup(await ReviewPage());

beforeEach(() => {
  seenHeaders.length = 0;
  notFound.mockClear();
  result = { status: 200, body: { submissions: [SUBMISSION] } };
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

  it("is never indexed — the queue holds sites nobody has vetted", () => {
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });
});

describe("the queue", () => {
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
    // The live region exists before it has anything to say (role="alert").
    expect(html).toContain('role="alert"');
  });

  it("says the queue is empty rather than rendering an empty grid", async () => {
    result = { status: 200, body: { submissions: [] } };
    const html = await markup();
    expect(html).toContain("The queue is empty.");
    expect(html).not.toContain("gallery-card");
  });

  it("tells the reviewer what approving and refusing actually do", async () => {
    const html = await markup();
    expect(html).toMatch(/stamp your\s+identity/);
    expect(html).toContain("stores your reason");
    expect(html).toContain("the candidate is shown");
  });

  it("gives the refusal a required, labelled reason field", async () => {
    const el = document.createElement("div");
    el.innerHTML = await markup();
    const input = el.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(input).toBeTruthy();
    const label = el.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`)!;
    expect(label.textContent).toMatch(/reason/i);
    expect(input.getAttribute("maxlength")).toBe("500");
  });

  it("links each queued card to the share view the public would get", async () => {
    expect(await markup()).toContain(`href="/s/${SUBMISSION.token}"`);
  });
});
