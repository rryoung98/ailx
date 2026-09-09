// @vitest-environment jsdom
/**
 * Mode-aware copy (staging dogfood F4): the hosted build kept telling users
 * "No network calls. Everything runs in your browser." while it was writing
 * their whole run to the backend.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { accessCopy, assetUrl, eventLogCopy, examAccessCopy, footerModeCopy, isServerMode } from "../lib/mode";
import RootLayout from "../app/layout";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

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
  it("says the simulator is the default and runs locally, with nothing connected", () => {
    // TEN-121. The unconditional "Nothing leaves your browser" was FALSE in
    // the same build: `foray:llm-base-url` can point the T1 and T4 runners at
    // the shared demo proxy, and the static footer went on promising silence
    // while the browser posted a candidate's prompts to a third party. The
    // claim is now conditioned on the slot the runners actually read.
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "");
    const copy = footerModeCopy(null);
    expect(copy).toContain("static demo build");
    expect(copy).toContain("deterministic simulator");
    expect(copy).toMatch(/runs in this browser/i);
  });

  it("names the origin the browser will send prompts to once one is connected", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "");
    const copy = footerModeCopy("https://ailx-shared-demo.vercel.app/api/v1");
    expect(copy).toContain("static demo build");
    // The ORIGIN, named — not the word "somewhere", and not a promise of
    // silence that this build cannot keep.
    expect(copy).toContain("https://ailx-shared-demo.vercel.app");
    expect(copy).not.toMatch(/nothing leaves your browser/i);
    expect(copy).not.toMatch(/no network calls/i);
    expect(copy).toMatch(/simulator is the default/i);
  });

  it("names a local endpoint too, and keeps the sentence to one origin", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "");
    expect(footerModeCopy("http://localhost:11434/v1")).toContain("http://localhost:11434");
  });

  it("ignores a slot value that is not an absolute http(s) endpoint", () => {
    // A junk slot is not a network call. Naming "null" as an origin would be
    // a worse lie than the one this replaces.
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "");
    for (const junk of ["", "   ", "not a url", "javascript:alert(1)", "/api/v1"]) {
      expect(footerModeCopy(junk), junk).toBe(footerModeCopy(null));
    }
  });

  it("ignores the slot entirely in the hosted build", () => {
    // The hosted build's own sentence is about the backend, and TEN-62 put
    // the model key there: a browser slot cannot change what it stores.
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    expect(footerModeCopy("https://ailx-shared-demo.vercel.app/api/v1")).toBe(footerModeCopy(null));
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
  it("asks for a sign-in where a sitting needs one, and the reader has not", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_stub");
    expect(examAccessCopy("anonymous")).toBe("sign in to sit a scored run");
  });

  it("never asks a signed-in candidate to do the thing they just did", () => {
    // TEN-151: the line was unconditional on a Clerk build, so it was on
    // screen for the candidate who had already signed in.
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_stub");
    expect(examAccessCopy("signed-in")).not.toMatch(/sign in/i);
    expect(examAccessCopy("signed-in")).toMatch(/scored run/i);
  });

  it("asks for nothing while Clerk is still answering", () => {
    // The first paint of a hosted page is `pending`. Telling everybody to
    // sign in until the session resolves is the same bug, one render early.
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_stub");
    expect(examAccessCopy("pending")).not.toMatch(/sign in/i);
    expect(examAccessCopy("pending")).toBe("a scored run needs an account");
  });

  it("still says no accounts where there are none, whoever is reading", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    for (const status of ["pending", "anonymous", "asserted", "signed-in"] as const) {
      expect(examAccessCopy(status), status).toBe("no accounts — just play");
    }
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
    expect(render()).toContain("runs in this browser");
  });

  it("drops the static claim in server mode", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    const html = render();
    expect(html).not.toContain("runs in this browser");
    expect(html).toContain("hosted build");
  });

  /**
   * The slot lives in the browser, so the SERVER tree cannot know about it:
   * the prerendered footer is the unconnected sentence and the effect
   * replaces it after mount. Hydrating the connected sentence directly would
   * be a mismatch in the static export, which is prerendered once for
   * everybody.
   */
  it("names the connected origin after mount, and prerenders the local claim", async () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "");
    const { FooterMode } = await import("../components/FooterMode");
    expect(renderToStaticMarkup(createElement(FooterMode))).toContain("runs in this browser");

    const slot = new Map<string, string>([
      ["foray:llm-base-url", "https://ailx-shared-demo.vercel.app/api/v1"],
    ]);
    Object.defineProperty(window, "localStorage", {
      value: { getItem: (k: string) => slot.get(k) ?? null },
      configurable: true,
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(FooterMode)));
    expect(host.textContent).toContain("https://ailx-shared-demo.vercel.app");
    await act(async () => root.unmount());
    host.remove();
  });

  it("reads the very slot the runners read", async () => {
    // The footer's claim is only true if it looks where T1 and T4 look. The
    // component spells the key rather than importing it (bundle cost — see
    // the comment there), so the two are pinned equal HERE, where importing
    // the track package costs nothing.
    const { LLM_BASE_URL_STORAGE } = await import("@ailx/track-t1");
    const { MODEL_ENDPOINT_SLOT } = await import("../components/FooterMode");
    expect(MODEL_ENDPOINT_SLOT).toBe(LLM_BASE_URL_STORAGE);
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
