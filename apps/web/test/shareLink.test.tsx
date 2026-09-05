// @vitest-environment jsdom
/**
 * The share UI is the consent surface for the whole growth loop, so the
 * things asserted here are promises to the candidate: nothing exists until
 * they press the button, the site is a SECOND consent, revoke really calls
 * revoke, and the static demo shows no button it cannot honour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  ALL_SHARE_SECTIONS,
  DEFAULT_SHARE_SECTIONS,
  SHARE_NETWORKS,
  shareIntentUrl,
  sharePayloadFrom,
} from "@ailx/report";
import { ShareLink } from "../features/report/ShareLink";
import { syncKey } from "../lib/data/persistence";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// This vitest/jsdom combo exposes no window.localStorage (see
// test/connectPanel.test.tsx) — same in-memory shim, same reason.
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

const ATTEMPT = "11111111-1111-4111-8111-111111111111";
const TOKEN = "a".repeat(43);

let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;

const PAYLOAD = sharePayloadFrom({ t1: 88.2, t2: 79.5, t3: 71.1, t4: 66.9 }, "Distinction", {
  instrument: "ailx 2026.1",
});

function serverShare(overrides: Record<string, unknown> = {}) {
  return {
    status: "unlisted",
    views: 3,
    id: "s1",
    token: TOKEN,
    payload: PAYLOAD,
    rejectedBy: null,
    rejectReason: null,
    ...overrides,
  };
}

async function render(): Promise<void> {
  await act(async () => {
    createRoot(container).render(createElement(ShareLink, { attemptId: ATTEMPT }));
  });
}

const byName = (role: string, name: RegExp): HTMLElement | undefined =>
  [...container.querySelectorAll<HTMLElement>("button, a, input, label")].find(
    (el) =>
      (role === "button" ? el.tagName === "BUTTON" : true) &&
      name.test(el.textContent ?? el.getAttribute("aria-label") ?? ""),
  );

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
  window.localStorage.clear();
  window.localStorage.setItem("foray:dev-user", "tester");
  container = document.createElement("div");
  document.body.append(container);
  fetchMock = vi.fn(async () => new Response("{}", { status: 404 }));
  vi.stubGlobal("fetch", fetchMock);
  window.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  container.remove();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("ShareLink in the static export", () => {
  it("renders nothing — no dead button that cannot work", async () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "");
    await render();
    expect(container.textContent).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("publishing to the gallery", () => {
  const liveShare = (overrides: Record<string, unknown> = {}) =>
    fetchMock.mockImplementation(async (_url: string, init: { method: string }) =>
      init.method === "GET"
        ? new Response(JSON.stringify({ share: serverShare(overrides) }), { status: 200 })
        : new Response("{}", { status: 500 }),
    );

  it("offers the publish control on a live link, and says a card lists immediately", async () => {
    liveShare();
    await render();
    expect(byName("button", /Publish to the gallery/)).toBeTruthy();
    expect(container.querySelector('[data-testid="publish-state"]')!.textContent).toContain(
      "listed as soon as you press this",
    );
  });

  it("POSTs to the publish route with NO body — the server decides, not the client", async () => {
    const calls: { url: string; init: { method: string; body?: string } }[] = [];
    fetchMock.mockImplementation(async (url: string, init: { method: string; body?: string }) => {
      calls.push({ url: String(url), init });
      if (init.method === "GET") {
        return new Response(JSON.stringify({ share: serverShare() }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          status: "published",
          awaitingApproval: false,
          share: serverShare({ status: "published" }),
        }),
        { status: 200 },
      );
    });
    await render();
    await act(async () => {
      byName("button", /Publish to the gallery/)!.click();
    });
    const post = calls.find((c) => c.init.method === "POST")!;
    expect(post.url).toBe(`/api/attempts/${ATTEMPT}/share/publish`);
    expect(post.init.body).toBeUndefined();
    // The new state is read off the row that came back.
    const state = container.querySelector('[data-testid="publish-state"]')!.textContent ?? "";
    expect(state).toContain("Listed in the");
    expect(byName("button", /Publish to the gallery/)).toBeUndefined();
  });

  it("warns that an authored card waits for a human BEFORE it is submitted", async () => {
    liveShare({
      payload: sharePayloadFrom({ t1: 1, t2: 1, t3: 1, t4: 1 }, "Pass", {
        instrument: "ailx 2026.1",
        sections: { ...DEFAULT_SHARE_SECTIONS, site: true },
        site: "/api/site/x/index.html",
      }),
    });
    await render();
    expect(container.querySelector('[data-testid="publish-state"]')!.textContent).toContain(
      "a person reads it before it is listed",
    );
    expect(byName("button", /Publish to the gallery/)).toBeTruthy();
  });

  it("shows a submitted share as waiting for a human, with no button to press again", async () => {
    liveShare({ status: "submitted" });
    await render();
    const state = container.querySelector('[data-testid="publish-state"]')!.textContent ?? "";
    expect(state).toContain("Waiting for a human");
    expect(byName("button", /Publish to the gallery/)).toBeUndefined();
  });

  it("offers no publish control on a refused share — a refusal is terminal", async () => {
    liveShare({ status: "rejected", rejectReason: "no" });
    await render();
    expect(container.querySelector('[data-testid="publish-state"]')).toBeNull();
  });

  it("survives a failed publish without touching the link", async () => {
    fetchMock.mockImplementation(async (_url: string, init: { method: string }) => {
      if (init.method === "GET") {
        return new Response(JSON.stringify({ share: serverShare() }), { status: 200 });
      }
      throw new Error("Failed to fetch");
    });
    await render();
    await act(async () => {
      byName("button", /Publish to the gallery/)!.click();
    });
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("Your link is untouched");
    expect(alert.textContent).not.toContain("Failed to fetch");
    // The link itself is still there, and still publishable.
    expect(container.querySelector<HTMLInputElement>("#share-url")!.value).toContain(TOKEN);
    expect(byName("button", /Publish to the gallery/)).toBeTruthy();
  });
});

describe("ShareLink in server mode", () => {
  it("offers creation and shares nothing until asked", async () => {
    await render();
    expect(byName("button", /Create a share link/)).toBeTruthy();
    expect(container.textContent).toContain("private until you say so");
    // The only call so far is the READ that discovered there is no link.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
  });

  it("states what is and is not in the card", async () => {
    await render();
    const copy = container.textContent ?? "";
    expect(copy).toContain("four-track shape");
    expect(copy).toContain("never");
    expect(copy).toMatch(/not indexed/);
    expect(copy).toMatch(/revoke/i);
  });

  it("creates a link, shows its url and copies it", async () => {
    const copied: string[] = [];
    Object.assign(navigator, {
      clipboard: { writeText: async (t: string) => void copied.push(t) },
    });
    fetchMock.mockImplementation(async (_url: string, init: { method: string }) =>
      init.method === "POST"
        ? new Response(JSON.stringify({ share: serverShare({ token: TOKEN, views: 0 }) }), { status: 201 })
        : new Response("{}", { status: 404 }),
    );
    await render();
    await act(async () => {
      byName("button", /Create a share link/)!.click();
    });
    const input = container.querySelector<HTMLInputElement>("#share-url")!;
    expect(input.value).toBe(`${window.location.origin}/s/${TOKEN}`);
    await act(async () => {
      byName("button", /Copy link/)!.click();
    });
    expect(copied).toEqual([input.value]);
  });

  it("disables the site opt-in when there is no built site, and says why", async () => {
    await render();
    const box = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].pop()!;
    const siteBox = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[3]!;
    expect(siteBox.disabled).toBe(true);
    expect(siteBox.checked).toBe(false);
    expect(container.textContent).toContain("You did not submit a site in this run.");
    expect(box).toBeTruthy();
  });

  it("offers one checkbox per section, with the authored ones off by default", async () => {
    await render();
    const boxes = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes).toHaveLength(5);
    expect(boxes.map((b) => b.checked)).toEqual([true, true, true, false, false]);
    expect(container.textContent).toContain("How you worked");
    expect(container.textContent).toContain("The day you finished");
  });

  it("sends the exact section selection, and never a payload", async () => {
    const bodies: Record<string, unknown>[] = [];
    fetchMock.mockImplementation(async (_url: string, init: { method: string; body?: string }) => {
      if (init.method === "POST") {
        bodies.push(JSON.parse(init.body!));
        return new Response(JSON.stringify({ share: serverShare() }), { status: 201 });
      }
      return new Response("{}", { status: 404 });
    });
    await render();
    const boxes = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    await act(async () => {
      boxes[0]!.click(); // turn "profile" off
    });
    await act(async () => {
      byName("button", /Create a share link/)!.click();
    });
    expect(bodies).toEqual([
      { sections: { ...DEFAULT_SHARE_SECTIONS, profile: false, site: false }, note: "" },
    ]);
    expect(Object.keys(bodies[0]!).sort()).toEqual(["note", "sections"]);
  });

  it("carries the candidate's note only when they turned that section on", async () => {
    const bodies: Record<string, unknown>[] = [];
    fetchMock.mockImplementation(async (_url: string, init: { method: string; body?: string }) => {
      if (init.method === "POST") {
        bodies.push(JSON.parse(init.body!));
        return new Response(JSON.stringify({ share: serverShare() }), { status: 201 });
      }
      return new Response("{}", { status: 404 });
    });
    await render();
    expect(container.querySelector("#share-note")).toBeNull();
    const boxes = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    await act(async () => {
      boxes[4]!.click();
    });
    const note = container.querySelector<HTMLTextAreaElement>("#share-note")!;
    await act(async () => {
      // React tracks the DOM value, so a controlled field needs the native setter.
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        note,
        "I built a co-op site.",
      );
      note.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      byName("button", /Create a share link/)!.click();
    });
    expect(bodies[0]!.note).toBe("I built a co-op site.");
  });

  it("shows the refusal reason, verbatim, when a reviewer said no", async () => {
    fetchMock.mockImplementation(async () =>
      new Response(
        JSON.stringify({
          share: serverShare({
            status: "rejected",
            rejectedBy: "dev:reviewer-1",
            rejectReason: "The site loads a third-party tracker.",
          }),
        }),
        { status: 200 },
      ),
    );
    await render();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      "The site loads a third-party tracker.",
    );
    // Never the reviewer's identity — the candidate gets the reason, not a name.
    expect(container.textContent).not.toContain("reviewer-1");
  });

  it("asks for the site as a SECOND, separate consent, defaulted off", async () => {
    window.localStorage.setItem(
      `foray:site:v1:${ATTEMPT}`,
      JSON.stringify({ digest: "sha256:x", url: "/api/site/sha256:x/index.html" }),
    );
    const bodies: unknown[] = [];
    fetchMock.mockImplementation(async (_url: string, init: { method: string; body?: string }) => {
      if (init.method === "POST") {
        bodies.push(JSON.parse(init.body!));
        return new Response(JSON.stringify({ share: serverShare({ token: TOKEN }) }), { status: 201 });
      }
      return new Response("{}", { status: 404 });
    });
    await render();
    const siteBox = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[3]!;
    expect(siteBox.disabled).toBe(false);
    expect(siteBox.checked).toBe(false);
    await act(async () => {
      byName("button", /Create a share link/)!.click();
    });
    expect((bodies[0] as { sections: Record<string, boolean> }).sections.site).toBe(false);
    await act(async () => {
      siteBox.click();
    });
  });

  it("shows a live link with its anonymous view count", async () => {
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ share: serverShare({ views: 12 }) }), { status: 200 }),
    );
    await render();
    expect(container.textContent).toContain("12 views");
    expect(container.querySelector<HTMLInputElement>("#share-url")!.value).toBe(
      `${window.location.origin}/s/${TOKEN}`,
    );
  });

  it("recovers the url from the server on a browser that never created it", async () => {
    // No localStorage entry at all: the token comes back with the owner read.
    window.localStorage.clear();
    window.localStorage.setItem("foray:dev-user", "tester");
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ share: serverShare() }), { status: 200 }),
    );
    await render();
    expect(container.querySelector<HTMLInputElement>("#share-url")!.value).toContain(TOKEN);
    expect(container.textContent).not.toMatch(/only ever shown once/);
    expect(byName("button", /Copy link/)).toBeTruthy();
  });

  it("says which sections a live link actually carries", async () => {
    fetchMock.mockImplementation(async () =>
      new Response(
        JSON.stringify({
          share: serverShare({
            payload: sharePayloadFrom({ t1: 1, t2: 1, t3: 1, t4: 1 }, "Pass", {
              instrument: "ailx 2026.1",
              sections: ALL_SHARE_SECTIONS,
              completedOn: "2026-03-01",
              note: "a note",
              site: "/api/site/x/index.html",
              process: { totalActiveSeconds: 60, tracks: [] },
            }),
          }),
        }),
        { status: 200 },
      ),
    );
    await render();
    const copy = container.textContent ?? "";
    expect(copy).toContain("This link carries");
    expect(copy).toContain("how you worked");
    expect(copy).toContain("the site you built in t1");
    expect(copy).toContain("revoke it and");
  });

  it("revokes: calls DELETE, forgets the url, and offers a fresh link", async () => {
    const methods: string[] = [];
    fetchMock.mockImplementation(async (_url: string, init: { method: string }) => {
      methods.push(init.method);
      return init.method === "DELETE"
        ? new Response(JSON.stringify({ revoked: true }), { status: 200 })
        : new Response(JSON.stringify({ share: serverShare() }), { status: 200 });
    });
    await render();
    await act(async () => {
      byName("button", /Revoke link/)!.click();
    });
    expect(methods).toContain("DELETE");
    expect(container.querySelector("#share-url")).toBeNull();
    expect(byName("button", /Create a share link/)).toBeTruthy();
  });

  it("posts against the SERVER attempt id, not the client one", async () => {
    const serverId = "22222222-2222-4222-8222-222222222222";
    window.localStorage.setItem(
      syncKey(ATTEMPT),
      JSON.stringify({ serverAttemptId: serverId, syncedThrough: 3, finalized: true }),
    );
    await render();
    expect(String(fetchMock.mock.calls[0][0])).toBe(`/api/attempts/${serverId}/share`);
  });

  it("survives a backend failure without losing the run", async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error("offline");
    });
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Your run is saved");
  });

  it("labels every control for assistive tech", async () => {
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ share: serverShare() }), { status: 200 }),
    );
    await render();
    const input = container.querySelector<HTMLInputElement>("#share-url")!;
    const label = container.querySelector<HTMLLabelElement>('label[for="share-url"]')!;
    expect(label.textContent).toMatch(/link/i);
    expect(input.readOnly).toBe(true);
    // Section is named by its heading, and the heading is a real h2.
    const section = container.querySelector("section")!;
    expect(section.getAttribute("aria-labelledby")).toBe("share-heading");
    expect(container.querySelector("#share-heading")!.tagName).toBe("H2");
    // Status text is announced, never only coloured.
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it("offers the network targets on a live link, in the owner's own voice", async () => {
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ share: serverShare() }), { status: 200 }),
    );
    await render();
    const url = `${window.location.origin}/s/${TOKEN}`;
    for (const network of SHARE_NETWORKS) {
      const el = container.querySelector<HTMLAnchorElement>(`[data-testid="share-${network}"]`)!;
      expect(el.getAttribute("href")).toBe(shareIntentUrl(network, PAYLOAD, url, "mine"));
    }
    // Copy link survives as the always-works fallback, and revoke still sits
    // in the same row.
    expect(container.querySelector('[data-testid="share-copy"]')).toBeTruthy();
    expect(byName("button", /Revoke link/)).toBeTruthy();
  });
});
