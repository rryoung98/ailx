// @vitest-environment jsdom
/**
 * Mode-aware copy (staging dogfood F4): the hosted build kept telling users
 * "No network calls. Everything runs in your browser." while it was writing
 * their whole run to the backend.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { assetUrl, eventLogCopy, footerModeCopy, isServerMode } from "../lib/mode";
import RootLayout from "../app/layout";

afterEach(() => vi.unstubAllEnvs());

describe("isServerMode", () => {
  it("is true only for the exact opt-in value", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    expect(isServerMode()).toBe(true);
    for (const v of ["", "0", "true", "yes"]) {
      vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", v);
      expect(isServerMode(), v).toBe(false);
    }
  });

  it("defaults to static when the var is absent", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", undefined as unknown as string);
    expect(isServerMode()).toBe(false);
  });
});

describe("footerModeCopy", () => {
  it("keeps the offline claim in the static build", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "");
    const copy = footerModeCopy();
    expect(copy).toContain("static demo build");
    expect(copy).toContain("No network calls");
  });

  it("never claims offline in the hosted build", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    const copy = footerModeCopy();
    expect(copy).toContain("hosted build");
    expect(copy).not.toMatch(/no network calls/i);
    expect(copy).not.toMatch(/everything runs in your browser/i);
    expect(copy).toContain("AILX backend");
  });
});

describe("eventLogCopy", () => {
  it("switches where the log is said to live", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "");
    expect(eventLogCopy()).toContain("stays in this browser");
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    expect(eventLogCopy()).not.toMatch(/stays in this browser/i);
    expect(eventLogCopy()).toContain("AILX backend");
  });
});

describe("footer rendering", () => {
  const render = () =>
    renderToStaticMarkup(createElement(RootLayout, { children: null }));

  it("renders the static claim in static mode", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "");
    expect(render()).toContain("No network calls");
  });

  it("drops the static claim in server mode", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    const html = render();
    expect(html).not.toContain("No network calls");
    expect(html).toContain("hosted build");
  });
});

describe("assetUrl", () => {
  it("prefixes the baked basePath in each build mode", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/ailx"); // Pages export
    expect(assetUrl("/media/logo.svg")).toBe("/ailx/media/logo.svg");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", ""); // hosted build, root-mounted
    expect(assetUrl("/media/logo.svg")).toBe("/media/logo.svg");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/x");
    expect(assetUrl("/media/logo.svg")).toBe("/x/media/logo.svg");
  });

  it("falls back to the Pages basePath when the var is absent", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", undefined as unknown as string);
    expect(assetUrl("/media/logo.svg")).toBe("/ailx/media/logo.svg");
  });
});
