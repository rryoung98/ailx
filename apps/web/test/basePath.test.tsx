// @vitest-environment jsdom
/**
 * basePath regression tests.
 *
 * Six modules used to inline `process.env.NEXT_PUBLIC_BASE_PATH ?? ...` with
 * two DIFFERENT defaults ("/ailx" in lib/, "" in app/), so the same media file
 * resolved to two different URLs depending on which module asked. Every asset
 * URL now goes through the one seam, `lib/mode.ts` `assetUrl()`, and this file
 * pins the result under BOTH shipped basePath configurations ("" hosted,
 * "/ailx" Pages export) plus the no-var fallback — and forbids the inline
 * expression from coming back.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";
import { act, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserSources } from "./helpers/browserSources";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Both basePath values `next.config.mjs` can bake, plus "not baked at all". */
const CONFIGS = [
  { name: "Pages export", env: "/ailx", prefix: "/ailx" },
  { name: "hosted build", env: "", prefix: "" },
  { name: "unset (unit-test fallback)", env: undefined, prefix: "/ailx" },
] as const;

function stub(env: string | undefined): void {
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", env as unknown as string);
}

// ---- 1. the seam itself, and every lib/ consumer of it -------------------

describe.each(CONFIGS)("asset URLs under the $name basePath", ({ env, prefix }) => {
  beforeEach(() => {
    vi.resetModules();
    stub(env);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("assetUrl prefixes exactly once, with no double slash", async () => {
    const { assetUrl } = await import("../lib/mode");
    expect(assetUrl("/media/logo.svg")).toBe(`${prefix}/media/logo.svg`);
    expect(assetUrl("/media/logo.svg")).not.toContain("//");
  });

  it("the hosted API base is prefixed too (lib/persistence.ts)", async () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    const { browserApiOptions } = await import("../lib/persistence");
    // In server mode next.config bakes "" unless a basePath is configured.
    const expected = env === undefined ? "" : env;
    expect(browserApiOptions().baseUrl).toBe(`${expected}/api`);
  });

  it("snapshot image items resolve under the basePath (lib/instrument.ts)", async () => {
    const { t2Items } = await import("../lib/instrument");
    // The T2 bank's image items reference real files under public/t2-media.
    const media = t2Items("en")
      .map((i) => String(i.material))
      .filter((m) => m.includes("t2-media/"));
    expect(media.length).toBeGreaterThan(0);
    for (const src of media) {
      expect(src.startsWith(`${prefix}/t2-media/`)).toBe(true);
      expect(src).not.toContain("//");
    }
  });

  it("teaser media resolve under the basePath (lib/demoItems.ts)", async () => {
    const { TEASER_ITEMS } = await import("../lib/demoItems");
    const media = TEASER_ITEMS.filter((i) => i.kind === "media" && i.imgSrc);
    expect(media.length).toBeGreaterThan(0);
    for (const i of media) {
      expect(i.imgSrc!.startsWith(`${prefix}/`)).toBe(true);
      expect(i.imgSrc).not.toContain("//");
    }
  });

  it("track visuals resolve under the basePath (lib/TrackVisuals.tsx)", async () => {
    const { t2VisualMedia } = await import("../lib/TrackVisuals");
    const media = t2VisualMedia();
    expect(media.length).toBeGreaterThan(0);
    for (const m of media) {
      expect(m.src.startsWith(`${prefix}/`)).toBe(true);
      expect(m.src).not.toContain("//");
    }
  });
});

// ---- 2. the three route files, rendered ----------------------------------

let root: Root | null = null;
let host: HTMLElement | null = null;

async function render(el: ReactElement): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(el); });
  return host;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  if (host) host.remove();
  host = null;
  vi.unstubAllEnvs();
});

/** Depth-first walk over a static element tree (server components). */
function* walk(node: ReactNode): Generator<ReactElement> {
  if (Array.isArray(node)) {
    for (const n of node) yield* walk(n);
    return;
  }
  if (!isValidElement(node)) return;
  yield node;
  const props = node.props as { children?: ReactNode };
  if (props && props.children !== undefined) yield* walk(props.children);
}

describe.each(CONFIGS)("route media under the $name basePath", ({ env, prefix }) => {
  beforeEach(() => {
    vi.resetModules();
    stub(env);
  });

  it("the landing page prefixes every local media src", async () => {
    const { default: Home } = await import("../app/page");
    const el = await render(createElement(Home));
    const srcs = [...el.querySelectorAll("img")]
      .map((i) => i.getAttribute("src") ?? "")
      .filter((s) => s.includes("/media/"));
    expect(srcs.length).toBeGreaterThan(0);
    for (const s of srcs) expect(s.startsWith(`${prefix}/media/`)).toBe(true);
    // The campus map is a CSS background, not an <img>.
    const map = el.querySelector<HTMLElement>(".campus-map");
    expect(map?.style.backgroundImage).toContain(`${prefix}/media/campus-map.jpg`);
  });

  it("the methodology page prefixes its hero image", async () => {
    const { default: Methodology } = await import("../app/methodology/page");
    const img = [...walk(Methodology() as ReactElement)].find(
      (e) => e.type === "img" && String((e.props as { src?: string }).src ?? "").includes("/media/"),
    );
    expect((img!.props as { src: string }).src).toBe(`${prefix}/media/pastoral.jpg`);
  });

  it("the validate page prefixes its hero image", async () => {
    const { default: ValidatePage } = await import("../app/validate/page");
    const el = await render(createElement(ValidatePage));
    const img = [...el.querySelectorAll("img")].find((i) => (i.getAttribute("src") ?? "").includes("/media/"));
    expect(img?.getAttribute("src")).toBe(`${prefix}/media/hero-desk.jpg`);
  });
});

// ---- 3. the inline expression may not come back --------------------------

describe("NEXT_PUBLIC_BASE_PATH has exactly one reader", () => {
  it("is read only by lib/mode.ts (and next.config.mjs, which bakes it)", () => {
    const offenders = browserSources(/\.(ts|tsx)$/)
      .filter((f) => readFileSync(f, "utf8").includes("NEXT_PUBLIC_BASE_PATH"))
      .map((f) => relative(webDir, f).split(sep).join("/"));
    expect(offenders).toEqual(["lib/mode.ts"]);
  });
});
