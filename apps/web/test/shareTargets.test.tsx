// @vitest-environment jsdom
/**
 * SHARE TARGETS — the last step of the growth loop, so the things asserted
 * here are the ones that decide whether a link ever leaves the device.
 *
 * Four properties: every target builds a correct, encoded URL; the Web Share
 * API is used when the browser has it and is invisible when it does not;
 * nothing outside the allowlisted payload can reach a share text or URL
 * (docs/SHARING.md §1); and every control has an accessible name and a real
 * tap target (FRONTEND.md a11y rules).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ALL_SHARE_SECTIONS,
  SHARE_NETWORKS,
  shareIntentUrl,
  sharePayloadFrom,
  shareText,
  shareTitle,
} from "@ailx/report";
import { ShareTargets } from "../components/ShareTargets";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const URL_UNDER_TEST = `https://ailx.example/s/${"a".repeat(43)}`;
const PAYLOAD = sharePayloadFrom({ t1: 88.2, t2: 79.5, t3: 71.1, t4: 66.9 }, "Distinction", {
  instrument: "ailx 2026.1",
  sections: ALL_SHARE_SECTIONS,
  site: "/api/site/abc123/index.html",
  note: "I built a portfolio for a bike-repair co-op.",
  completedOn: "2026-08-30",
});

let container: HTMLDivElement;
let root: Root;

async function render(props: Record<string, unknown> = {}): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(ShareTargets, { url: URL_UNDER_TEST, payload: PAYLOAD, ...props }));
  });
}

const target = (name: string): HTMLElement =>
  container.querySelector<HTMLElement>(`[data-testid="share-${name}"]`)!;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the network targets", () => {
  it("renders one real link per network, opening safely in a new tab", async () => {
    await render();
    for (const network of SHARE_NETWORKS) {
      const el = target(network) as HTMLAnchorElement;
      expect(el.tagName).toBe("A");
      expect(el.getAttribute("href")).toBe(shareIntentUrl(network, PAYLOAD, URL_UNDER_TEST, "mine"));
      expect(el.getAttribute("target")).toBe("_blank");
      expect(el.getAttribute("rel")).toContain("noreferrer");
    }
  });

  it("encodes the text and the link — no raw space, no double encoding", async () => {
    await render();
    for (const network of SHARE_NETWORKS) {
      const href = target(network).getAttribute("href")!;
      expect(href).not.toMatch(/[ \n"'<>]/);
      expect(href).not.toContain("%25");
      const parsed = new URL(href);
      const text = decodeURIComponent(parsed.search);
      expect(text).toContain(PAYLOAD.playerType.name);
      expect(text).toContain(URL_UNDER_TEST);
      // The link is in the composer exactly once, whichever field carries it.
      expect(href.split(encodeURIComponent(URL_UNDER_TEST)).length - 1).toBe(1);
    }
  });

  it("switches to third-person copy on a link someone else is passing on", async () => {
    await render({ perspective: "theirs" });
    const href = target("x").getAttribute("href")!;
    expect(new URL(href).searchParams.get("text")).toBe(shareText(PAYLOAD, "x", "theirs"));
  });
});

describe("the Web Share API", () => {
  it("is absent when the browser has no navigator.share — no dead button", async () => {
    await render();
    expect(target("native")).toBeNull();
    expect(target("copy")).toBeTruthy();
  });

  it("opens the OS sheet with the title, the text and the URL when it exists", async () => {
    const share = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { share }));
    await render();
    await act(async () => target("native").click());
    expect(share).toHaveBeenCalledWith({
      title: shareTitle(PAYLOAD),
      text: shareText(PAYLOAD, "native", "mine"),
      url: URL_UNDER_TEST,
    });
  });

  it("says nothing when the reader cancels the sheet", async () => {
    const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal(
      "navigator",
      Object.assign(Object.create(navigator), {
        share: vi.fn(async () => { throw abort; }),
        clipboard: { writeText },
      }),
    );
    await render();
    await act(async () => target("native").click());
    expect(writeText).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("copied");
  });

  it("falls back to copying when the sheet itself fails", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal(
      "navigator",
      Object.assign(Object.create(navigator), {
        share: vi.fn(async () => { throw new Error("not allowed"); }),
        clipboard: { writeText },
      }),
    );
    await render();
    await act(async () => target("native").click());
    expect(writeText).toHaveBeenCalledWith(URL_UNDER_TEST);
  });
});

describe("copy link — the target that always works", () => {
  it("writes the URL and confirms it, in text a screen reader hears", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { clipboard: { writeText } }));
    await render();
    await act(async () => target("copy").click());
    expect(writeText).toHaveBeenCalledWith(URL_UNDER_TEST);
    expect(container.querySelector('[role="status"]')!.textContent).toContain("copied");
  });

  it("stays quiet when the clipboard is denied", async () => {
    vi.stubGlobal(
      "navigator",
      Object.assign(Object.create(navigator), {
        clipboard: { writeText: vi.fn(async () => { throw new Error("denied"); }) },
      }),
    );
    await render();
    await act(async () => target("copy").click());
    expect(container.textContent).not.toContain("copied \u2713");
  });
});

describe("privacy — a share cannot say more than the payload", () => {
  it("puts no id, token-adjacent field, band or track number in any target", async () => {
    await render();
    const hrefs = SHARE_NETWORKS.map((n) => decodeURIComponent(target(n).getAttribute("href")!));
    for (const href of hrefs) {
      const composer = href.slice(href.indexOf("?"));
      expect(composer).not.toContain(PAYLOAD.band);
      for (const v of Object.values(PAYLOAD.tracks)) expect(composer).not.toContain(v.toFixed(1));
      for (const leak of ["dPrime", "brier", "participant", "attempt", "item"]) {
        expect(composer.toLowerCase()).not.toContain(leak.toLowerCase());
      }
      // The note is the owner's words on the CARD, not prose we paste for them.
      expect(composer).not.toContain("bike-repair");
    }
  });

  it("adds no third-party script, iframe or tracking pixel", async () => {
    await render();
    expect(container.querySelector("script,iframe,img")).toBeNull();
  });
});

describe("a11y and touch", () => {
  it("gives every control a visible, spoken name — no bare icon", async () => {
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { share: vi.fn() }));
    await render();
    const controls = [...container.querySelectorAll<HTMLElement>("a,button")];
    expect(controls).toHaveLength(SHARE_NETWORKS.length + 2);
    for (const el of controls) {
      const name = (el.textContent ?? "").trim() || el.getAttribute("aria-label") || "";
      expect(name.length, el.outerHTML).toBeGreaterThan(2);
      // Keyboard reachable: real <a href> / <button>, never a clickable div.
      expect(["A", "BUTTON"]).toContain(el.tagName);
      if (el.tagName === "A") expect(el.getAttribute("href")).toBeTruthy();
      // The 44px tap target and the focus ring come from `.btn` in
      // globals.css, so the contract is the class being present.
      expect(el.className).toContain("btn");
    }
  });

  it("groups the targets under one spoken label", async () => {
    await render();
    const group = container.querySelector('[role="group"]')!;
    expect(group.getAttribute("aria-label")).toBe("Share this card");
  });

  it("renders extra controls passed as children inside the same row", async () => {
    await render({ children: createElement("button", { type: "button" }, "Revoke link") });
    expect(container.textContent).toContain("Revoke link");
  });
});
