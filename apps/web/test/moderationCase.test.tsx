// @vitest-environment jsdom
/**
 * The moderation CASE — /review/<id> — and the two sides of its thread.
 *
 * What is asserted here is the audience boundary, in the place a leak would
 * actually happen: the rendered HTML. The moderator sees the whole trail,
 * including internal notes, superseded rows and who wrote them. The candidate
 * sees the messages sent to them and NOTHING that names a reviewer — asserted
 * against the exact payload the server sends and against the DOM it produces.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { FORBIDDEN_RESULT, type ModerationCaseDetail, type ModerationComment } from "@ailx/backend";
import { sharePayloadFrom } from "@ailx/report";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const store = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
  },
});

const CASE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ATTEMPT = "11111111-1111-4111-8111-111111111111";
const REVIEWER = "dev:reviewer-1";

const payload = sharePayloadFrom({ t1: 70, t2: 60, t3: 50, t4: 40 }, "Merit", {
  instrument: "ailx 2026.1",
  site: "/api/site/sha256:abc/index.html",
});

function comment(over: Partial<ModerationComment> = {}): ModerationComment {
  return {
    id: 1,
    role: "reviewer",
    visibility: "internal",
    author: REVIEWER,
    body: "Third submission from this participant; watch it.",
    at: "2026-03-03T11:30:00.000Z",
    supersedesId: null,
    current: true,
    retracted: false,
    ...over,
  };
}

function detail(over: Partial<ModerationCaseDetail> = {}): ModerationCaseDetail {
  return {
    entry: { id: CASE_ID, token: "r".repeat(43), at: "2026-03-02T09:00:00.000Z", payload, approvedBy: null },
    status: "rejected",
    submittedAt: "2026-03-02T09:00:00.000Z",
    decidedAt: "2026-03-03T11:00:00.000Z",
    decidedBy: REVIEWER,
    rejectReason: "The site embeds a third-party tracker.",
    appealOpen: true,
    comments: 1,
    trail: [comment()],
    ...over,
  };
}

let result: { status: number; body: Record<string, unknown> };

vi.mock("../lib/server/api", () => ({
  withApiContext: async (fn: (ctx: unknown) => Promise<unknown>) => fn({ db: {}, auth: {} }),
  requestHeaderMap: async () => ({ "x-ailx-dev-user": "reviewer-1" }),
}));
vi.mock("@ailx/backend", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@ailx/backend");
  return { ...actual, handleModerationCase: async () => result };
});
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound, useRouter: () => ({ refresh: vi.fn() }) }));

const { default: CasePage } = await import("../app/review/[id]/page.api");
const { CandidateThread } = await import("../lib/Moderation");

const markup = async (): Promise<string> =>
  renderToStaticMarkup(await CasePage({ params: Promise.resolve({ id: CASE_ID }) }));

beforeEach(() => {
  notFound.mockClear();
  result = { status: 200, body: { case: detail() } };
});

describe("the case gate", () => {
  it("404s a non-moderator instead of confirming the case exists", async () => {
    result = FORBIDDEN_RESULT;
    await expect(markup()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("404s an anonymous caller too", async () => {
    result = { status: 401, body: {} };
    await expect(markup()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("what a moderator sees", () => {
  it("shows the decision on the record: state, when, by whom and why", async () => {
    const html = await markup();
    expect(html).toContain("rejected");
    expect(html).toContain(REVIEWER);
    expect(html).toContain("The site embeds a third-party tracker.");
    expect(html).toContain("2026-03-03 11:00");
    expect(html).toContain("appeal open");
  });

  it("shows an INTERNAL note, marked as internal, with its author", async () => {
    const html = await markup();
    expect(html).toContain("Third submission from this participant; watch it.");
    expect(html).toContain("internal note");
    expect(html).toContain(REVIEWER);
  });

  it("keeps a superseded row on screen, marked as replaced", async () => {
    result = {
      status: 200,
      body: {
        case: detail({
          trail: [
            comment({ id: 1, body: "Looks fine.", current: false }),
            comment({ id: 2, body: "Actually it does not.", supersedesId: 1 }),
          ],
        }),
      },
    };
    const html = await markup();
    expect(html).toContain("Looks fine.");
    expect(html).toContain("replaced, kept on the record");
    expect(html).toContain("Actually it does not.");
  });

  it("shows a retraction as withdrawn rather than as a blank", async () => {
    result = {
      status: 200,
      body: { case: detail({ trail: [comment({ body: "", retracted: true, supersedesId: 1 })] }) },
    };
    expect(await markup()).toContain("Withdrawn by its author.");
  });

  it("defaults the composer to an internal note, and says the trail is append-only", async () => {
    const html = await markup();
    expect(html).toContain("Save internal note");
    expect(html).toContain("every comment is an insert");
    expect(html).toContain("Send this to the candidate (they never see who wrote it)");
    const el = document.createElement("div");
    el.innerHTML = html;
    const box = el.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box.hasAttribute("checked")).toBe(false);
    const area = el.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(el.querySelector(`label[for="${area.id}"]`)).toBeTruthy();
    expect(area.getAttribute("maxlength")).toBe("2000");
  });

  it("offers the decision buttons only while the case is undecided", async () => {
    expect(await markup()).not.toContain("Approve");
    result = { status: 200, body: { case: detail({ status: "submitted", decidedAt: null, decidedBy: null, rejectReason: null, appealOpen: false }) } };
    const html = await markup();
    expect(html).toContain("Approve");
    expect(html).toContain("Reject");
  });

  it("says a decision is final, so the conversation is about the NEXT share", async () => {
    expect(await markup()).toContain("A decision is final for this share");
  });
});

describe("what the candidate sees", () => {
  let container: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  const thread = (over: Record<string, unknown> = {}) => ({
    thread: {
      status: "rejected",
      rejectReason: "The site embeds a third-party tracker.",
      canReply: true,
      comments: [
        { id: 7, role: "reviewer", body: "Remove the tracker and share again.", at: "2026-03-03T12:00:00.000Z" },
      ],
      ...over,
    },
  });

  const render = async (): Promise<void> => {
    await act(async () => {
      createRoot(container).render(createElement(CandidateThread, { attemptId: ATTEMPT }));
    });
  };

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
    window.localStorage.clear();
    window.localStorage.setItem("ailx:dev-user", "tester");
    container = document.createElement("div");
    document.body.append(container);
    fetchMock = vi.fn(async () => new Response(JSON.stringify(thread()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    window.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    container.remove();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("renders nothing in the static export — there is no case to have", async () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "");
    await render();
    expect(container.textContent).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads its own attempt's case, and only that", async () => {
    await render();
    expect(String(fetchMock.mock.calls[0][0])).toContain(`/attempts/${ATTEMPT}/moderation`);
  });

  it("shows the moderator's message without ever naming the moderator", async () => {
    await render();
    const html = container.innerHTML;
    expect(html).toContain("Remove the tracker and share again.");
    expect(html).toContain("AILX moderator");
    for (const forbidden of [REVIEWER, "reviewer-1", "internal", "author", "visibility"]) {
      expect(html, forbidden).not.toContain(forbidden);
    }
    expect(container.textContent).toContain("never who decided it");
  });

  it("sends a response to its own attempt endpoint and reloads the thread", async () => {
    await render();
    const area = container.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      // React tracks the DOM value, so a controlled field needs the native setter.
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        area,
        "The script is my own, self-hosted.",
      );
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST")!;
    expect(String(post[0])).toContain(`/attempts/${ATTEMPT}/moderation`);
    expect(JSON.parse(post[1].body)).toEqual({ body: "The script is my own, self-hosted." });
  });

  it("never posts an empty response", async () => {
    await render();
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(fetchMock.mock.calls.filter((c) => c[1]?.method === "POST")).toHaveLength(0);
  });

  it("closes the composer, and says why, while a moderator has the turn", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(thread({ canReply: false })), { status: 200 }));
    await render();
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).toContain("once they answer");
  });

  it("renders nothing at all before a decision exists", async () => {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify(thread({ status: "submitted", comments: [], canReply: false })), { status: 200 }),
    );
    await render();
    expect(container.textContent).toBe("");
  });

  it("renders nothing when the server refuses the read", async () => {
    fetchMock.mockImplementation(async () => new Response("{}", { status: 404 }));
    await render();
    expect(container.textContent).toBe("");
  });
});
