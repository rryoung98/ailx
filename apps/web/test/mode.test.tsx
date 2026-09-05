// @vitest-environment jsdom
/**
 * Mode-aware copy (staging dogfood F4): the hosted build kept telling users
 * "No network calls. Everything runs in your browser." while it was writing
 * their whole run to the backend.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { accessCopy, assetUrl, eventLogCopy, examAccessCopy, footerModeCopy, isServerMode } from "../lib/mode";
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
    // The copy pass replaced "No network calls. Everything runs in your
    // browser." with one sentence that says the same thing.
    expect(copy).toMatch(/nothing leaves your browser/i);
    expect(copy).toContain("deterministic simulator");
  });

  it("never claims offline in the hosted build", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    const copy = footerModeCopy();
    expect(copy).toContain("hosted build");
    expect(copy).not.toMatch(/no network calls/i);
    expect(copy).not.toMatch(/everything runs in your browser/i);
    expect(copy).not.toMatch(/nothing leaves your browser/i);
    expect(copy).toContain("Foray backend");
  });

  it("promises no simulator for a model call the service will not make", () => {
    // TEN-62 put the key on the exam service, which refuses an unconnected
    // caller. "without one, every model call is a deterministic simulator"
    // described a build that no longer exists.
    //
    // The copy pass cut the footer from 75 words to 29 and moved the two
    // connection clauses to ConnectPanel, which is where the reader decides.
    // So this asserts the INVARIANT — a hosted footer promises no simulator
    // and never implies the browser holds the key — rather than sentences
    // that a later edit would have to keep verbatim to stay green.
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    const copy = footerModeCopy();
    expect(copy).not.toMatch(/simulator/i);
    expect(copy).toMatch(/never in this browser/i);
  });

  it("still names what the hosted build stores", () => {
    // The enumeration is the promise. Shortening it away would leave a
    // vaguer claim, which is the one thing this pass may not do.
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    const copy = footerModeCopy();
    for (const part of ["event log", "answers", "site you published"]) {
      expect(copy, part).toContain(part);
    }
  });

  it("is shorter than the paragraph it replaced, in both builds", () => {
    // The founder's complaint was length, so length is asserted. 40 words is
    // generous headroom over today's 29 and well under the old 75.
    for (const mode of ["", "1"]) {
      vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", mode);
      expect(footerModeCopy().split(/\s+/).length, mode).toBeLessThanOrEqual(40);
    }
  });
});

describe("accessCopy", () => {
  /**
   * Staging switched to Clerk on 2026-09-04 and the hero still said "no
   * account" while the exam service refused an anonymous sitting.
   */
  it("keeps the account-free promise where it is true", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    expect(accessCopy()).toContain("no account");
  });

  it("keeps it in a hosted build that mounts no auth", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    expect(accessCopy()).toContain("no account");
  });

  it("drops it where a sitting needs one, and still says the play is free", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_stub");
    const copy = accessCopy();
    expect(copy).not.toMatch(/no account/i);
    expect(copy).toContain("free to play");
    expect(copy).toContain("needs an account");
  });
});

describe("examAccessCopy", () => {
  /**
   * A SECOND promise, and the one made where it matters most: this line sits
   * beside the start gate. After staging switched to Clerk it still read "no
   * accounts — just play" to a candidate standing at a gate they could not
   * pass (TEN-125). The hero's line is separate and says something else.
   */
  it("asks for a sign-in where a sitting needs one", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_stub");
    expect(examAccessCopy()).toBe("sign in to sit a scored run");
  });

  it("still says no accounts where there are none", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    expect(examAccessCopy()).toBe("no accounts — just play");
  });
});

describe("eventLogCopy", () => {
  it("switches where the log is said to live", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "");
    expect(eventLogCopy()).toContain("stays in this browser");
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    expect(eventLogCopy()).not.toMatch(/stays in this browser/i);
    expect(eventLogCopy()).toContain("Foray backend");
  });
});

describe("footer rendering", () => {
  const render = () =>
    renderToStaticMarkup(createElement(RootLayout, null, null));

  it("renders the static claim in static mode", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "");
    expect(render()).toContain("Nothing leaves your browser");
  });

  it("drops the static claim in server mode", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    const html = render();
    expect(html).not.toContain("Nothing leaves your browser");
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
