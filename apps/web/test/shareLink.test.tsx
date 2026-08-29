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
import { ShareLink } from "../lib/ShareLink";
import { syncKey } from "../lib/persistence";

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

function serverShare(overrides: Record<string, unknown> = {}) {
  return { status: "unlisted", views: 3, id: "s1", ...overrides };
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
  window.localStorage.setItem("ailx:dev-user", "tester");
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

  it("creates a link, stores the url once, and copies it", async () => {
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
    expect(window.localStorage.getItem(`ailx:share:v1:${ATTEMPT}`)).toBe(input.value);
    await act(async () => {
      byName("button", /Copy link/)!.click();
    });
    expect(copied).toEqual([input.value]);
  });

  it("does not offer the site opt-in when there is no built site", async () => {
    await render();
    expect(byName("label", /Also share the site/)).toBeUndefined();
  });

  it("asks for the site as a SECOND, separate consent, defaulted off", async () => {
    window.localStorage.setItem(
      `ailx:site:v1:${ATTEMPT}`,
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
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(false);
    await act(async () => {
      byName("button", /Create a share link/)!.click();
    });
    expect(bodies).toEqual([{ includeSite: false }]);
  });

  it("shows a live link with its anonymous view count", async () => {
    window.localStorage.setItem(`ailx:share:v1:${ATTEMPT}`, `https://ailx.test/s/${TOKEN}`);
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ share: serverShare({ views: 12 }) }), { status: 200 }),
    );
    await render();
    expect(container.textContent).toContain("12 views");
    expect(container.querySelector<HTMLInputElement>("#share-url")!.value).toBe(
      `https://ailx.test/s/${TOKEN}`,
    );
  });

  it("explains itself when the link exists but this browser lost the url", async () => {
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ share: serverShare() }), { status: 200 }),
    );
    await render();
    expect(container.querySelector("#share-url")).toBeNull();
    expect(container.textContent).toContain("only ever shown once");
    expect(byName("button", /Revoke link/)).toBeTruthy();
  });

  it("revokes: calls DELETE, forgets the url, and offers a fresh link", async () => {
    window.localStorage.setItem(`ailx:share:v1:${ATTEMPT}`, `https://ailx.test/s/${TOKEN}`);
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
    expect(window.localStorage.getItem(`ailx:share:v1:${ATTEMPT}`)).toBeNull();
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
    window.localStorage.setItem(`ailx:share:v1:${ATTEMPT}`, `https://ailx.test/s/${TOKEN}`);
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
});
