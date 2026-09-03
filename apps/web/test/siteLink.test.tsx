// @vitest-environment jsdom
/**
 * Live-site link presentation (staging dogfood papercut 2): the raw
 * `/api/site/sha256:…/` path was the visible link text and wrapped over
 * three lines on a phone. The href is owned elsewhere and must not change.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteLink } from "../components/ui/SiteLink";

const URL_PATH = "/api/site/sha256:9f2b7c1d8e4a6b3f0c5d2e1a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c/";

const render = (props: { url: string; label?: string }) =>
  renderToStaticMarkup(createElement(SiteLink, props));

describe("SiteLink", () => {
  it("keeps the href byte-identical to the given url", () => {
    expect(render({ url: URL_PATH })).toContain(`href="${URL_PATH}"`);
  });

  it("shows a short human label, not the digest, as the VISIBLE text", () => {
    const el = document.createElement("div");
    el.innerHTML = render({ url: URL_PATH });
    const text = el.textContent ?? "";
    expect(text).toContain("Open your site");
    expect(text).not.toContain("sha256:");
    // One short line, not a three-line wrapped path.
    expect(text.trim().length).toBeLessThan(24);
  });

  it("keeps the full url discoverable as the title", () => {
    expect(render({ url: URL_PATH })).toContain(`title="${URL_PATH}"`);
  });

  it("opens in a new tab without leaking the opener", () => {
    const html = render({ url: URL_PATH });
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  it("accepts an absolute url and a custom label unchanged", () => {
    const abs = "https://ailx.example/api/site/sha256:abc/index.html";
    const html = render({ url: abs, label: "View the snapshot" });
    expect(html).toContain(`href="${abs}"`);
    expect(html).toContain("View the snapshot");
  });
});
